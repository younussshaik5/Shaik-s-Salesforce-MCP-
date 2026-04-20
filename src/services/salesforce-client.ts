import axios, { AxiosInstance } from "axios";
import qs from "qs";
import fs from "fs";
import jwt from "jsonwebtoken";

// ─── Auth Modes ────────────────────────────────────────────────────────────────
// Mode 1: Username + Password (SF_AUTH_MODE=password or default)
//   Requires: SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN
//
// Mode 2: JWT Bearer Token (SF_AUTH_MODE=jwt)
//   Requires: SF_LOGIN_URL, SF_CLIENT_ID, SF_USERNAME, SF_PRIVATE_KEY or SF_PRIVATE_KEY_FILE
//   No password, no security token, no interactive login — production-grade server-to-server auth
//   Connected App must have "Use digital signatures" enabled with the matching public key uploaded

export type AuthMode = "password" | "jwt";

export interface SalesforceConfig {
  loginUrl: string;
  clientId: string;
  username: string;
  apiVersion: string;
  authMode: AuthMode;
  // Password auth
  clientSecret?: string;
  password?: string;
  securityToken?: string;
  // JWT auth
  privateKey?: string;        // PEM string directly
  privateKeyFile?: string;    // Path to .key or .pem file
}

export interface SalesforceAuth {
  accessToken: string;
  instanceUrl: string;
  tokenType: string;
  expiresAt: number; // epoch ms — for token refresh
}

export interface QueryResult<T = Record<string, unknown>> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SObjectDescribe {
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string;
  fields: FieldDescribe[];
  urls: Record<string, string>;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  queryable: boolean;
  searchable: boolean;
}

export interface FieldDescribe {
  name: string;
  label: string;
  type: string;
  length: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  referenceTo: string[];
  picklistValues: Array<{ value: string; label: string; active: boolean }>;
}

export class SalesforceClient {
  private auth: SalesforceAuth | null = null;
  private http!: AxiosInstance;
  private config: SalesforceConfig;

  constructor(config: SalesforceConfig) {
    this.config = config;
  }

  // ─── Auth: Password Flow ───────────────────────────────────────────────────
  private async authenticatePassword(): Promise<void> {
    if (!this.config.clientSecret || !this.config.password) {
      throw new Error("Password auth requires SF_CLIENT_SECRET and SF_PASSWORD");
    }
    const params = {
      grant_type: "password",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password + (this.config.securityToken ?? ""),
    };
    const response = await axios.post(
      `${this.config.loginUrl}/services/oauth2/token`,
      qs.stringify(params),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    this.setAuth(response.data);
  }

  // ─── Auth: JWT Bearer Flow ─────────────────────────────────────────────────
  private async authenticateJWT(): Promise<void> {
    // Load private key — from env string or file path
    let privateKey: string;
    if (this.config.privateKey) {
      privateKey = this.config.privateKey.replace(/\\n/g, "\n");
    } else if (this.config.privateKeyFile) {
      privateKey = fs.readFileSync(this.config.privateKeyFile, "utf8");
    } else {
      throw new Error(
        "JWT auth requires SF_PRIVATE_KEY (PEM string) or SF_PRIVATE_KEY_FILE (path to .key/.pem)"
      );
    }

    // Build JWT claim set
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: this.config.clientId,
      sub: this.config.username,
      aud: this.config.loginUrl,
      exp: now + 300, // 5 min expiry (Salesforce max)
    };

    const signedJwt = jwt.sign(claim, privateKey, { algorithm: "RS256" });

    const params = {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    };

    const response = await axios.post(
      `${this.config.loginUrl}/services/oauth2/token`,
      qs.stringify(params),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    this.setAuth(response.data);
  }

  // ─── Auth: Token Refresh ───────────────────────────────────────────────────
  // JWT tokens expire after ~2 hours. Auto-refresh if within 5 min of expiry.
  private isTokenExpiring(): boolean {
    if (!this.auth) return true;
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    return this.auth.expiresAt < fiveMinFromNow;
  }

  private setAuth(data: { access_token: string; instance_url: string; token_type: string }): void {
    this.auth = {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
      tokenType: data.token_type,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours default
    };
    this.http = axios.create({
      baseURL: `${this.auth.instanceUrl}/services/data/${this.config.apiVersion}`,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  async authenticate(): Promise<void> {
    if (this.config.authMode === "jwt") {
      await this.authenticateJWT();
    } else {
      await this.authenticatePassword();
    }
  }

  private async ensureAuth(): Promise<void> {
    if (!this.auth || this.isTokenExpiring()) {
      await this.authenticate();
    }
  }

  getInstanceUrl(): string {
    return this.auth?.instanceUrl ?? "";
  }

  getAuthMode(): string {
    return this.config.authMode;
  }

  // ─── SOQL Query ────────────────────────────────────────────────────────────
  async query<T = Record<string, unknown>>(
    soql: string
  ): Promise<QueryResult<T>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<QueryResult<T>>("/query", {
        params: { q: soql },
      });
      return response.data;
    } catch (err) {
      throw this.formatError(err, "SOQL query");
    }
  }

  async queryAll<T = Record<string, unknown>>(
    soql: string,
    maxRecords = 2000
  ): Promise<QueryResult<T>> {
    await this.ensureAuth();
    const first = await this.query<T>(soql);
    let allRecords = [...first.records];
    let nextUrl = first.nextRecordsUrl;

    while (nextUrl && allRecords.length < maxRecords) {
      const resp = await this.http!.get<QueryResult<T>>(nextUrl);
      allRecords = allRecords.concat(resp.data.records);
      nextUrl = resp.data.nextRecordsUrl;
    }

    return { ...first, records: allRecords, done: !nextUrl };
  }

  // ─── SOSL Search ───────────────────────────────────────────────────────────
  async search(sosl: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get("/search", {
        params: { q: sosl },
      });
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, "SOSL search");
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────
  async getRecord(
    sobject: string,
    id: string,
    fields?: string[]
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const url = `/sobjects/${sobject}/${id}`;
      const params = fields ? { fields: fields.join(",") } : {};
      const response = await this.http!.get<Record<string, unknown>>(url, { params });
      return response.data;
    } catch (err) {
      throw this.formatError(err, `get ${sobject} record`);
    }
  }

  async createRecord(
    sobject: string,
    data: Record<string, unknown>
  ): Promise<{ id: string; success: boolean; errors: unknown[] }> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post(`/sobjects/${sobject}`, data);
      return response.data as { id: string; success: boolean; errors: unknown[] };
    } catch (err) {
      throw this.formatError(err, `create ${sobject}`);
    }
  }

  async updateRecord(
    sobject: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.ensureAuth();
    try {
      await this.http!.patch(`/sobjects/${sobject}/${id}`, data);
    } catch (err) {
      throw this.formatError(err, `update ${sobject} ${id}`);
    }
  }

  async deleteRecord(sobject: string, id: string): Promise<void> {
    await this.ensureAuth();
    try {
      await this.http!.delete(`/sobjects/${sobject}/${id}`);
    } catch (err) {
      throw this.formatError(err, `delete ${sobject} ${id}`);
    }
  }

  async upsertRecord(
    sobject: string,
    externalIdField: string,
    externalId: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.patch(
        `/sobjects/${sobject}/${externalIdField}/${externalId}`,
        data
      );
      return (response.data as Record<string, unknown>) ?? { success: true };
    } catch (err) {
      throw this.formatError(err, `upsert ${sobject}`);
    }
  }

  // ─── Metadata / Describe ───────────────────────────────────────────────────
  async describeSObject(sobject: string): Promise<SObjectDescribe> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<SObjectDescribe>(
        `/sobjects/${sobject}/describe`
      );
      return response.data;
    } catch (err) {
      throw this.formatError(err, `describe ${sobject}`);
    }
  }

  async listSObjects(): Promise<Array<{ name: string; label: string; labelPlural: string; keyPrefix: string; createable: boolean; queryable: boolean }>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<{ sobjects: Array<{ name: string; label: string; labelPlural: string; keyPrefix: string; createable: boolean; queryable: boolean }> }>("/sobjects");
      return response.data.sobjects;
    } catch (err) {
      throw this.formatError(err, "list sobjects");
    }
  }

  // ─── Apex Execute ──────────────────────────────────────────────────────────
  async executeApex(
    apexBody: string
  ): Promise<{ success: boolean; compileProblem?: string; exceptionMessage?: string; logs?: string }> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post<{ success: boolean; compileProblem?: string; exceptionMessage?: string }>(
        "/tooling/executeAnonymous",
        null,
        { params: { anonymousBody: apexBody } }
      );
      return response.data;
    } catch (err) {
      throw this.formatError(err, "execute Apex");
    }
  }

  // ─── Flows ─────────────────────────────────────────────────────────────────
  async listFlows(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, ApiName, Label, Status, ProcessType, TriggerType FROM FlowDefinitionView ORDER BY Label LIMIT 200"
    );
    return result.records;
  }

  async invokeFlow(
    flowApiName: string,
    inputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post(
        `/actions/custom/flow/${flowApiName}`,
        { inputs: [inputs] }
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `invoke flow ${flowApiName}`);
    }
  }

  // ─── Bulk Operations ───────────────────────────────────────────────────────
  async bulkCreateRecords(
    sobject: string,
    records: Record<string, unknown>[]
  ): Promise<{ results: Array<{ id?: string; success: boolean; errors: unknown[] }> }> {
    await this.ensureAuth();
    // Use composite API for batches up to 200
    const chunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < records.length; i += 200) {
      chunks.push(records.slice(i, i + 200));
    }

    const results: Array<{ id?: string; success: boolean; errors: unknown[] }> = [];
    for (const chunk of chunks) {
      const body = {
        allOrNone: false,
        records: chunk.map((r) => ({ attributes: { type: sobject }, ...r })),
      };
      const resp = await this.http!.post<Array<{ id?: string; success: boolean; errors: unknown[] }>>(
        "/composite/sobjects",
        body
      );
      results.push(...resp.data);
    }
    return { results };
  }

  // ─── Reports ───────────────────────────────────────────────────────────────
  async listReports(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, Name, DeveloperName, FolderName, LastRunDate FROM Report ORDER BY Name LIMIT 100"
    );
    return result.records;
  }

  async runReport(reportId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/analytics/reports/${reportId}?includeDetails=true`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `run report ${reportId}`);
    }
  }

  // ─── User / Org Info ───────────────────────────────────────────────────────
  async getCurrentUser(): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<Record<string, unknown>>("/chatter/users/me");
      return response.data;
    } catch (err) {
      throw this.formatError(err, "get current user");
    }
  }

  async getOrgLimits(): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<Record<string, unknown>>("/limits");
      return response.data;
    } catch (err) {
      throw this.formatError(err, "get org limits");
    }
  }

  // ─── Custom Metadata Types ─────────────────────────────────────────────────
  async listCustomMetadataTypes(): Promise<Record<string, unknown>[]> {
    // CustomMetadata types are queryable via Tooling API
    await this.ensureAuth();
    try {
      const response = await this.http!.get<{ records: Record<string, unknown>[] }>(
        "/tooling/query",
        { params: { q: "SELECT Id, DeveloperName, Label, Description FROM CustomObject WHERE ManageableState = 'unmanaged' AND DeveloperName LIKE '%__mdt'" } }
      );
      return response.data.records ?? [];
    } catch {
      // Fallback: describe global and filter mdt
      const all = await this.listSObjects();
      return all.filter((o) => o.name.endsWith("__mdt")).map((o) => ({
        name: o.name,
        label: o.label,
        labelPlural: o.labelPlural,
      }));
    }
  }

  async queryCustomMetadata(mdtApiName: string, fields?: string[]): Promise<QueryResult> {
    const fieldList = fields && fields.length > 0 ? fields.join(", ") : "Id, DeveloperName, Label, MasterLabel";
    return this.queryAll(`SELECT ${fieldList} FROM ${mdtApiName} LIMIT 200`);
  }

  // ─── Custom Settings ───────────────────────────────────────────────────────
  async listCustomSettings(): Promise<Record<string, unknown>[]> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<{ records: Record<string, unknown>[] }>(
        "/tooling/query",
        { params: { q: "SELECT Id, DeveloperName, Label, SetupDefinitionName, Visibility FROM CustomObject WHERE CustomSettingType != null" } }
      );
      return response.data.records ?? [];
    } catch {
      const all = await this.listSObjects();
      return all.filter((o) => o.name.endsWith("__c")).map((o) => ({
        name: o.name,
        label: o.label,
      }));
    }
  }

  async getCustomSetting(settingName: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const describe = await this.describeSObject(settingName);
      const fieldNames = describe.fields.map((f) => f.name).join(", ");
      const result = await this.query(`SELECT ${fieldNames} FROM ${settingName} LIMIT 200`);
      return { describe: { name: describe.name, label: describe.label }, records: result.records, totalSize: result.totalSize };
    } catch (err) {
      throw this.formatError(err, `get custom setting ${settingName}`);
    }
  }

  // ─── Platform Events ───────────────────────────────────────────────────────
  async listPlatformEvents(): Promise<Record<string, unknown>[]> {
    const all = await this.listSObjects();
    return all.filter((o) => o.name.endsWith("__e")).map((o) => ({
      name: o.name,
      label: o.label,
      labelPlural: o.labelPlural,
    }));
  }

  async publishPlatformEvent(
    eventName: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post(`/sobjects/${eventName}`, payload);
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `publish platform event ${eventName}`);
    }
  }

  // ─── Dashboards ────────────────────────────────────────────────────────────
  async listDashboards(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, Title, DeveloperName, FolderId, FolderName, LastRefreshDate, LastModifiedDate, LastModifiedById FROM Dashboard ORDER BY Title LIMIT 200"
    );
    return result.records;
  }

  async getDashboard(dashboardId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/analytics/dashboards/${dashboardId}`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get dashboard ${dashboardId}`);
    }
  }

  async getDashboardResults(dashboardId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/analytics/dashboards/${dashboardId}/results`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get dashboard results ${dashboardId}`);
    }
  }

  async refreshDashboard(dashboardId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.put(
        `/analytics/dashboards/${dashboardId}`
      );
      return (response.data as Record<string, unknown>) ?? { success: true, refreshed: dashboardId };
    } catch (err) {
      throw this.formatError(err, `refresh dashboard ${dashboardId}`);
    }
  }

  // ─── Reports (extended) ────────────────────────────────────────────────────
  async runReportFiltered(
    reportId: string,
    filters: Array<{ column: string; operator: string; value: string }>
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const body = {
        reportMetadata: {
          reportFilters: filters.map((f) => ({
            column: f.column,
            operator: f.operator,
            value: f.value,
          })),
        },
      };
      const response = await this.http!.post(
        `/analytics/reports/${reportId}?includeDetails=true`,
        body
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `run filtered report ${reportId}`);
    }
  }

  async getReportMetadata(reportId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/analytics/reports/${reportId}/describe`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get report metadata ${reportId}`);
    }
  }

  // ─── Tooling API ───────────────────────────────────────────────────────────
  async toolingQuery(soql: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<Record<string, unknown>>(
        "/tooling/query",
        { params: { q: soql } }
      );
      return response.data;
    } catch (err) {
      throw this.formatError(err, "tooling query");
    }
  }

  async listValidationRules(sobject?: string): Promise<Record<string, unknown>[]> {
    const filter = sobject ? ` AND EntityDefinition.QualifiedApiName = '${sobject}'` : "";
    const result = await this.toolingQuery(
      `SELECT Id, Active, Description, ErrorConditionFormula, ErrorMessage, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE Active = true${filter} LIMIT 200`
    ) as { records?: Record<string, unknown>[] };
    return result.records ?? [];
  }

  async listWorkflowRules(sobject?: string): Promise<Record<string, unknown>[]> {
    const filter = sobject ? ` AND TableEnumOrId = '${sobject}'` : "";
    const result = await this.toolingQuery(
      `SELECT Id, Name, Active, Description, TriggerType, TableEnumOrId FROM WorkflowRule WHERE Active = true${filter} LIMIT 200`
    ) as { records?: Record<string, unknown>[] };
    return result.records ?? [];
  }

  async listApexClasses(filter?: string): Promise<Record<string, unknown>[]> {
    const where = filter ? ` WHERE Name LIKE '%${filter}%'` : "";
    const result = await this.toolingQuery(
      `SELECT Id, Name, Status, IsValid, LengthWithoutComments, LastModifiedDate FROM ApexClass${where} ORDER BY Name LIMIT 200`
    ) as { records?: Record<string, unknown>[] };
    return result.records ?? [];
  }

  async listApexTriggers(sobject?: string): Promise<Record<string, unknown>[]> {
    const filter = sobject ? ` WHERE TableEnumOrId = '${sobject}'` : "";
    const result = await this.toolingQuery(
      `SELECT Id, Name, TableEnumOrId, Status, IsValid, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete FROM ApexTrigger${filter} LIMIT 200`
    ) as { records?: Record<string, unknown>[] };
    return result.records ?? [];
  }

  async getApexClassBody(classId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<Record<string, unknown>>(
        `/tooling/sobjects/ApexClass/${classId}`
      );
      return response.data;
    } catch (err) {
      throw this.formatError(err, `get apex class ${classId}`);
    }
  }

  // ─── Permission Sets & Profiles ────────────────────────────────────────────
  async listPermissionSets(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, Name, Label, Description, IsCustom, ProfileId FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Name LIMIT 200"
    );
    return result.records;
  }

  async listProfiles(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, Name, Description, UserType FROM Profile ORDER BY Name LIMIT 200"
    );
    return result.records;
  }

  async getPermissionSetAssignments(permSetId: string): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      `SELECT Id, AssigneeId, Assignee.Name, Assignee.Email FROM PermissionSetAssignment WHERE PermissionSetId = '${permSetId}'`
    );
    return result.records;
  }

  // ─── Approval Processes ────────────────────────────────────────────────────
  async listApprovalProcesses(): Promise<Record<string, unknown>[]> {
    const result = await this.toolingQuery(
      "SELECT Id, DeveloperName, TableEnumOrId, ProcessOrder, Active, Description FROM ProcessDefinition WHERE Type = 'Approval' ORDER BY DeveloperName LIMIT 200"
    ) as { records?: Record<string, unknown>[] };
    return result.records ?? [];
  }

  async submitForApproval(
    recordId: string,
    comments?: string,
    submitterId?: string
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const body: Record<string, unknown> = {
        actionType: "Submit",
        contextId: recordId,
        ...(comments && { comments }),
        ...(submitterId && { nextApproverIds: [submitterId] }),
      };
      const response = await this.http!.post("/process/approvals", body);
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `submit ${recordId} for approval`);
    }
  }

  async approveRejectRecord(
    workItemId: string,
    action: "Approve" | "Reject",
    comments?: string
  ): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const body: Record<string, unknown> = {
        actionType: action,
        contextId: workItemId,
        ...(comments && { comments }),
      };
      const response = await this.http!.post("/process/approvals", body);
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `${action} work item ${workItemId}`);
    }
  }

  async getPendingApprovals(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, TargetObjectId, ActorId, Actor.Name, ProcessInstance.TargetObject.Name, CreatedDate, ElapsedTimeInDays FROM ProcessInstanceWorkitem ORDER BY CreatedDate DESC LIMIT 100"
    );
    return result.records;
  }

  // ─── User Management ───────────────────────────────────────────────────────
  async listUsers(activeOnly = true): Promise<Record<string, unknown>[]> {
    const filter = activeOnly ? "WHERE IsActive = true" : "";
    const result = await this.query<Record<string, unknown>>(
      `SELECT Id, Name, Email, Username, ProfileId, Profile.Name, UserRole.Name, IsActive, LastLoginDate FROM User ${filter} ORDER BY Name LIMIT 200`
    );
    return result.records;
  }

  async getUserById(userId: string): Promise<Record<string, unknown>> {
    return this.getRecord("User", userId, [
      "Id", "Name", "Email", "Username", "ProfileId", "Profile.Name",
      "UserRole.Name", "IsActive", "LastLoginDate", "Department", "Title"
    ]);
  }

  // ─── Scheduled Jobs / Async Apex ──────────────────────────────────────────
  async listScheduledJobs(): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      "SELECT Id, JobType, Status, ApexClass.Name, CronExpression, NextFireTime, PreviousFireTime, State FROM CronTrigger ORDER BY NextFireTime LIMIT 100"
    );
    return result.records;
  }

  async listAsyncApexJobs(status?: string): Promise<Record<string, unknown>[]> {
    const filter = status ? ` WHERE Status = '${status}'` : "";
    const result = await this.query<Record<string, unknown>>(
      `SELECT Id, ApexClass.Name, Status, JobType, NumberOfErrors, TotalJobItems, JobItemsProcessed, CreatedDate, CompletedDate FROM AsyncApexJob${filter} ORDER BY CreatedDate DESC LIMIT 100`
    );
    return result.records;
  }

  // ─── Chatter / Feed ────────────────────────────────────────────────────────
  async getRecordFeed(recordId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/chatter/feeds/record/${recordId}/feed-elements`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get feed for ${recordId}`);
    }
  }

  async postChatterFeed(recordId: string, message: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const body = {
        feedElementType: "FeedItem",
        subjectId: recordId,
        body: { messageSegments: [{ type: "Text", text: message }] },
      };
      const response = await this.http!.post("/chatter/feed-elements", body);
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `post chatter on ${recordId}`);
    }
  }

  // ─── Files & Attachments ──────────────────────────────────────────────────
  async listAttachments(recordId: string): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      `SELECT Id, Name, ContentType, BodyLength, Description, CreatedDate FROM Attachment WHERE ParentId = '${recordId}' ORDER BY CreatedDate DESC`
    );
    return result.records;
  }

  async listContentDocuments(recordId: string): Promise<Record<string, unknown>[]> {
    const result = await this.query<Record<string, unknown>>(
      `SELECT Id, ContentDocumentId, ContentDocument.Title, ContentDocument.FileType, ContentDocument.ContentSize, ContentDocument.LastModifiedDate FROM ContentDocumentLink WHERE LinkedEntityId = '${recordId}' ORDER BY ContentDocument.LastModifiedDate DESC`
    );
    return result.records;
  }

  // ─── 1. Apex Tests (Tooling API async) ────────────────────────────────────
  async runApexTests(params: {
    classNames?: string[];
    testLevel?: string;
    suiteNames?: string[];
  }): Promise<{ testRunId: string }> {
    await this.ensureAuth();
    try {
      const body: Record<string, unknown> = {
        testLevel: params.testLevel ?? "RunSpecifiedTests",
        ...(params.classNames?.length && { classNames: params.classNames }),
        ...(params.suiteNames?.length && { suiteNames: params.suiteNames }),
      };
      const response = await this.http!.post<string>(
        "/tooling/runTestsAsynchronous",
        body
      );
      // response.data is the test run ID string
      return { testRunId: String(response.data) };
    } catch (err) {
      throw this.formatError(err, "run apex tests");
    }
  }

  async getApexTestResults(testRunId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      // Get the overall test run status
      const runResult = await this.toolingQuery(
        `SELECT Id, Status, StartTime, EndTime, TestTime, MethodsEnqueued, MethodsCompleted, MethodsFailed FROM ApexTestRun WHERE AsyncApexJobId = '${testRunId}'`
      ) as { records?: Record<string, unknown>[] };

      // Get individual test results
      const testResults = await this.toolingQuery(
        `SELECT Id, Outcome, ApexClass.Name, MethodName, Message, StackTrace, RunTime FROM ApexTestResult WHERE AsyncApexJobId = '${testRunId}' ORDER BY Outcome, ApexClass.Name, MethodName`
      ) as { records?: Record<string, unknown>[] };

      // Code coverage summary
      let coverage: Record<string, unknown> = {};
      try {
        const covResult = await this.toolingQuery(
          `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate ORDER BY NumLinesCovered DESC LIMIT 50`
        ) as { records?: Record<string, unknown>[] };
        coverage = { records: covResult.records ?? [] };
      } catch {
        coverage = { note: "Coverage data not available" };
      }

      const results = testResults.records ?? [];
      const passed = results.filter((r) => r["Outcome"] === "Pass").length;
      const failed = results.filter((r) => r["Outcome"] === "Fail").length;
      const skipped = results.filter((r) => r["Outcome"] === "Skip").length;

      return {
        testRunId,
        summary: { total: results.length, passed, failed, skipped },
        run: runResult.records?.[0] ?? {},
        results,
        coverage,
      };
    } catch (err) {
      throw this.formatError(err, `get apex test results for ${testRunId}`);
    }
  }

  // ─── 2. Metadata Deploy (REST-based) ───────────────────────────────────────
  async deployMetadata(params: {
    zipBase64: string;
    options?: {
      allowMissingFiles?: boolean;
      autoUpdatePackage?: boolean;
      checkOnly?: boolean;
      ignoreWarnings?: boolean;
      purgeOnDelete?: boolean;
      rollbackOnError?: boolean;
      testLevel?: string;
      runTests?: string[];
    };
  }): Promise<{ deployId: string; status: string }> {
    await this.ensureAuth();
    try {
      const deployOptions = {
        allowMissingFiles: false,
        autoUpdatePackage: false,
        checkOnly: false,
        ignoreWarnings: false,
        purgeOnDelete: false,
        rollbackOnError: true,
        testLevel: "NoTestRun",
        ...params.options,
      };

      // Use the Metadata REST API deploy endpoint
      const response = await this.http!.post(
        `/metadata/deployRequest`,
        {
          deployOptions,
          zipFile: params.zipBase64,
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      const data = response.data as { id?: string; deployResult?: { id?: string; status?: string } };
      const deployId = data?.id ?? (data?.deployResult?.id ?? "");
      return { deployId, status: "Queued" };
    } catch (err) {
      throw this.formatError(err, "deploy metadata");
    }
  }

  async getDeployStatus(deployId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/metadata/deployRequest/${deployId}?includeDetails=true`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get deploy status ${deployId}`);
    }
  }

  // ─── 3. Metadata Retrieve ──────────────────────────────────────────────────
  async retrieveMetadata(params: {
    apiVersion?: string;
    packageNames?: string[];
    specificTypes?: Array<{ name: string; members: string[] }>;
    singlePackage?: boolean;
  }): Promise<{ retrieveId: string }> {
    await this.ensureAuth();
    try {
      const body = {
        retrieveRequest: {
          apiVersion: params.apiVersion ?? this.config.apiVersion.replace("v", ""),
          singlePackage: params.singlePackage ?? false,
          ...(params.packageNames?.length && { packageNames: params.packageNames }),
          ...(params.specificTypes?.length && {
            unpackaged: {
              types: params.specificTypes,
              version: params.apiVersion ?? this.config.apiVersion.replace("v", ""),
            },
          }),
        },
      };

      const response = await this.http!.post("/metadata/retrieveRequest", body);
      const data = response.data as { id?: string };
      return { retrieveId: data?.id ?? "" };
    } catch (err) {
      throw this.formatError(err, "retrieve metadata");
    }
  }

  async getRetrieveStatus(retrieveId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(
        `/metadata/retrieveRequest/${retrieveId}`
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get retrieve status ${retrieveId}`);
    }
  }

  // ─── 4. Assign Permission Set ──────────────────────────────────────────────
  async assignPermissionSet(params: {
    userId: string;
    permissionSetName: string;
  }): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      // Find the permission set ID by name
      const psResult = await this.query<{ Id: string; Name: string }>(
        `SELECT Id, Name FROM PermissionSet WHERE Name = '${params.permissionSetName}' LIMIT 1`
      );

      if (!psResult.records.length) {
        throw new Error(`Permission Set '${params.permissionSetName}' not found`);
      }

      const permSetId = psResult.records[0]["Id"] as string;

      // Check if already assigned
      const existing = await this.query(
        `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${params.userId}' AND PermissionSetId = '${permSetId}' LIMIT 1`
      );

      if (existing.records.length > 0) {
        return { success: true, message: "Permission Set already assigned", alreadyAssigned: true };
      }

      // Create the assignment
      const result = await this.createRecord("PermissionSetAssignment", {
        AssigneeId: params.userId,
        PermissionSetId: permSetId,
      });

      return { ...result, permissionSetName: params.permissionSetName, userId: params.userId };
    } catch (err) {
      throw this.formatError(err, `assign permission set ${params.permissionSetName}`);
    }
  }

  async revokePermissionSet(params: {
    userId: string;
    permissionSetName: string;
  }): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const psResult = await this.query<{ Id: string }>(
        `SELECT Id FROM PermissionSet WHERE Name = '${params.permissionSetName}' LIMIT 1`
      );
      if (!psResult.records.length) throw new Error(`Permission Set '${params.permissionSetName}' not found`);
      const permSetId = psResult.records[0]["Id"] as string;

      const assignment = await this.query<{ Id: string }>(
        `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${params.userId}' AND PermissionSetId = '${permSetId}' LIMIT 1`
      );
      if (!assignment.records.length) return { success: true, message: "Not assigned — nothing to revoke" };

      await this.deleteRecord("PermissionSetAssignment", assignment.records[0]["Id"] as string);
      return { success: true, revoked: params.permissionSetName, userId: params.userId };
    } catch (err) {
      throw this.formatError(err, `revoke permission set ${params.permissionSetName}`);
    }
  }

  // ─── 5. Async Operation Poller ─────────────────────────────────────────────
  async pollAsyncOperation(params: {
    operationType: "apexTest" | "deploy" | "retrieve" | "apexJob";
    operationId: string;
    maxPollSeconds?: number;
    pollIntervalSeconds?: number;
  }): Promise<Record<string, unknown>> {
    const maxMs = (params.maxPollSeconds ?? 120) * 1000;
    const intervalMs = (params.pollIntervalSeconds ?? 5) * 1000;
    const start = Date.now();

    const terminalStatuses = {
      apexTest: ["Completed", "Failed", "Aborted"],
      deploy: ["Succeeded", "Failed", "Canceled", "SucceededPartial"],
      retrieve: ["Succeeded", "Failed"],
      apexJob: ["Completed", "Failed", "Aborted"],
    };

    while (Date.now() - start < maxMs) {
      let status: Record<string, unknown> = {};

      if (params.operationType === "apexTest") {
        status = await this.getApexTestResults(params.operationId);
        const runStatus = (status["run"] as Record<string, unknown>)?.["Status"] as string;
        if (!runStatus || terminalStatuses.apexTest.includes(runStatus)) {
          return { ...status, completed: true };
        }
      } else if (params.operationType === "deploy") {
        status = await this.getDeployStatus(params.operationId);
        const s = (status["deployResult"] as Record<string, unknown>)?.["status"] as string ?? status["status"];
        if (terminalStatuses.deploy.includes(String(s))) return { ...status, completed: true };
      } else if (params.operationType === "retrieve") {
        status = await this.getRetrieveStatus(params.operationId);
        const s = status["status"] as string;
        if (terminalStatuses.retrieve.includes(s)) return { ...status, completed: true };
      } else {
        const jobs = await this.listAsyncApexJobs();
        const job = jobs.find((j) => j["Id"] === params.operationId);
        if (!job) return { error: "Job not found", operationId: params.operationId };
        if (terminalStatuses.apexJob.includes(job["Status"] as string)) return { ...job, completed: true };
        status = job;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return {
      completed: false,
      timedOut: true,
      operationId: params.operationId,
      operationType: params.operationType,
      message: `Operation did not complete within ${params.maxPollSeconds ?? 120}s. Call sf_resume_operation to check again.`,
    };
  }

  // ─── 6. Agent Tests (Agentforce) ──────────────────────────────────────────
  async listAgentTestSuites(): Promise<Record<string, unknown>[]> {
    try {
      const result = await this.toolingQuery(
        "SELECT Id, DeveloperName, MasterLabel, Description FROM BotVersion LIMIT 100"
      ) as { records?: Record<string, unknown>[] };
      return result.records ?? [];
    } catch {
      // Fall back to querying AiEvaluationDefinition
      try {
        const result = await this.toolingQuery(
          "SELECT Id, DeveloperName, MasterLabel FROM AiEvaluationDefinition LIMIT 100"
        ) as { records?: Record<string, unknown>[] };
        return result.records ?? [];
      } catch {
        return [];
      }
    }
  }

  async runAgentTest(params: {
    agentTestSuiteId: string;
    botId?: string;
  }): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post(
        "/einstein/ai-evaluation/runs",
        {
          evaluationDefinitionId: params.agentTestSuiteId,
          ...(params.botId && { subjectId: params.botId }),
        }
      );
      return response.data as Record<string, unknown>;
    } catch (err) {
      // Try alternate endpoint
      try {
        const response = await this.http!.post(
          `/aiAssistant/run`,
          { testSuiteId: params.agentTestSuiteId }
        );
        return response.data as Record<string, unknown>;
      } catch {
        throw this.formatError(err, `run agent test ${params.agentTestSuiteId}`);
      }
    }
  }

  async getAgentTestResults(runId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get(`/einstein/ai-evaluation/runs/${runId}`);
      return response.data as Record<string, unknown>;
    } catch (err) {
      throw this.formatError(err, `get agent test results ${runId}`);
    }
  }

  // ─── 7. Code Analysis (Tooling API based) ─────────────────────────────────
  async runCodeAnalysis(params: {
    classNames?: string[];
    triggerNames?: string[];
    rules?: string[];
  }): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    try {
      // Compile check via Tooling API ContainerAsyncRequest
      const container = await this.http!.post<{ id: string }>(
        "/tooling/sobjects/MetadataContainer",
        { Name: `CodeAnalysis_${Date.now()}` }
      );
      const containerId = container.data.id;

      const results: Record<string, unknown>[] = [];

      // Add apex members to container and check compilation
      for (const className of (params.classNames ?? [])) {
        const classResult = await this.toolingQuery(
          `SELECT Id, Name, Body FROM ApexClass WHERE Name = '${className}' LIMIT 1`
        ) as { records?: Array<{ Id: string; Body: string }> };

        if (classResult.records?.length) {
          const cls = classResult.records[0];
          try {
            await this.http!.post("/tooling/sobjects/ApexClassMember", {
              MetadataContainerId: containerId,
              ContentEntityId: cls.Id,
              Body: cls.Body,
            });
          } catch (e) {
            results.push({ className, error: String(e) });
          }
        }
      }

      // Queue compilation check
      let compileResult: Record<string, unknown> = {};
      try {
        const asyncReq = await this.http!.post<{ id: string }>(
          "/tooling/sobjects/ContainerAsyncRequest",
          { MetadataContainerId: containerId, IsCheckOnly: true }
        );
        // Poll for completion
        let attempts = 0;
        while (attempts < 10) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await this.http!.get(
            `/tooling/sobjects/ContainerAsyncRequest/${asyncReq.data.id}`
          );
          const s = status.data as { State?: string; CompilerErrors?: string; ErrorMsg?: string };
          if (s.State === "Completed" || s.State === "Failed" || s.State === "Error") {
            compileResult = s as Record<string, unknown>;
            break;
          }
          attempts++;
        }
      } catch (e) {
        compileResult = { note: "Compile check skipped", error: String(e) };
      }

      // Cleanup container
      try { await this.http!.delete(`/tooling/sobjects/MetadataContainer/${containerId}`); } catch { /* ignore */ }

      // Get any existing symbol table issues
      const symbolIssues: Record<string, unknown>[] = [];
      for (const className of (params.classNames ?? [])) {
        try {
          const sym = await this.toolingQuery(
            `SELECT Id, SymbolTable FROM ApexClass WHERE Name = '${className}' LIMIT 1`
          ) as { records?: Record<string, unknown>[] };
          if (sym.records?.length) symbolIssues.push({ className, symbolTable: sym.records[0]["SymbolTable"] });
        } catch { /* skip */ }
      }

      return {
        summary: `Analyzed ${params.classNames?.length ?? 0} class(es), ${params.triggerNames?.length ?? 0} trigger(s)`,
        compileCheck: compileResult,
        symbolAnalysis: symbolIssues,
        results,
      };
    } catch (err) {
      throw this.formatError(err, "run code analysis");
    }
  }

  // ─── 8. Apex Antipattern Scanner ──────────────────────────────────────────
  async scanApexAntipatterns(params: {
    classNames: string[];
  }): Promise<Record<string, unknown>> {
    const antipatternResults: Record<string, unknown>[] = [];

    for (const className of params.classNames) {
      const classResult = await this.toolingQuery(
        `SELECT Id, Name, Body, LengthWithoutComments FROM ApexClass WHERE Name = '${className}' LIMIT 1`
      ) as { records?: Array<{ Id: string; Name: string; Body: string; LengthWithoutComments: number }> };

      if (!classResult.records?.length) {
        antipatternResults.push({ className, error: "Class not found" });
        continue;
      }

      const cls = classResult.records[0];
      const body = cls.Body || "";
      const issues: Array<{ severity: string; line?: number; pattern: string; description: string; recommendation: string }> = [];

      const lines = body.split("\n");

      // Detect patterns line by line
      let inLoop = false;
      let loopDepth = 0;
      let soqlInLoop = 0;
      let dmlInLoop = 0;

      const loopPatterns = [/\bfor\s*\(/, /\bwhile\s*\(/, /\bdo\s*\{/];
      const soqlPattern = /\[\s*SELECT\s+/i;
      const dmlPatterns = /\b(insert|update|delete|upsert|merge|undelete)\s+/i;
      const limitlessQueryPattern = /\[\s*SELECT\b(?![^[]*LIMIT\s+\d)/i;
      const hardcodedIdPattern = /['"][a-zA-Z0-9]{15,18}['"]/;
      const debugPattern = /System\.debug\s*\(/i;
      const catchEmptyPattern = /\}\s*catch\s*\([^)]+\)\s*\{\s*\}/;
      const withoutSharingPattern = /class\s+\w+\s+without\s+sharing/i;
      const futureMethodHttpPattern = /@future\s*\(\s*callout\s*=\s*true\s*\)/i;

      lines.forEach((line, i) => {
        const lineNum = i + 1;
        const trimmed = line.trim();

        // Track loop depth
        if (loopPatterns.some((p) => p.test(trimmed))) { inLoop = true; loopDepth++; }
        if (inLoop) {
          const opens = (trimmed.match(/\{/g) || []).length;
          const closes = (trimmed.match(/\}/g) || []).length;
          loopDepth += opens - closes;
          if (loopDepth <= 0) { inLoop = false; loopDepth = 0; }
        }

        // SOQL in loop
        if (inLoop && soqlPattern.test(trimmed)) {
          soqlInLoop++;
          issues.push({ severity: "CRITICAL", line: lineNum, pattern: "SOQL_IN_LOOP", description: "SOQL query inside a loop — risks hitting governor limits (max 100 queries)", recommendation: "Move SOQL outside the loop. Collect IDs first, then query in bulk." });
        }

        // DML in loop
        if (inLoop && dmlPatterns.test(trimmed)) {
          dmlInLoop++;
          issues.push({ severity: "CRITICAL", line: lineNum, pattern: "DML_IN_LOOP", description: "DML operation inside a loop — risks hitting DML governor limit (150 statements)", recommendation: "Collect records in a List, then perform a single DML outside the loop." });
        }

        // SOQL without LIMIT
        if (!inLoop && limitlessQueryPattern.test(trimmed)) {
          issues.push({ severity: "WARNING", line: lineNum, pattern: "SOQL_NO_LIMIT", description: "SOQL query without a LIMIT clause", recommendation: "Add LIMIT clause or use queryAll with controlled pagination." });
        }

        // Hardcoded IDs
        if (hardcodedIdPattern.test(trimmed) && !trimmed.startsWith("//")) {
          issues.push({ severity: "WARNING", line: lineNum, pattern: "HARDCODED_ID", description: "Potential hardcoded Salesforce ID in code", recommendation: "Use Custom Metadata, Custom Labels, or Custom Settings to store IDs." });
        }

        // Excessive System.debug (performance)
        if (debugPattern.test(trimmed)) {
          issues.push({ severity: "INFO", line: lineNum, pattern: "SYSTEM_DEBUG", description: "System.debug() found — remove from production code", recommendation: "Remove debug statements before deploying to production." });
        }

        // Empty catch block
        if (catchEmptyPattern.test(trimmed)) {
          issues.push({ severity: "HIGH", line: lineNum, pattern: "EMPTY_CATCH", description: "Empty catch block swallows exceptions silently", recommendation: "Log the exception or re-throw. Never silently ignore exceptions." });
        }

        // Without sharing
        if (withoutSharingPattern.test(trimmed)) {
          issues.push({ severity: "HIGH", line: lineNum, pattern: "WITHOUT_SHARING", description: "Class declared 'without sharing' bypasses field/record security", recommendation: "Use 'with sharing' unless there is a documented business reason." });
        }

        // Future callout
        if (futureMethodHttpPattern.test(trimmed)) {
          issues.push({ severity: "INFO", line: lineNum, pattern: "FUTURE_CALLOUT", description: "@future(callout=true) found — consider using Queueable for better control", recommendation: "Queueable Apex supports callouts and provides job chaining and monitoring." });
        }
      });

      antipatternResults.push({
        className,
        classId: cls.Id,
        linesOfCode: cls.LengthWithoutComments,
        totalIssues: issues.length,
        critical: issues.filter((i) => i.severity === "CRITICAL").length,
        high: issues.filter((i) => i.severity === "HIGH").length,
        warning: issues.filter((i) => i.severity === "WARNING").length,
        info: issues.filter((i) => i.severity === "INFO").length,
        issues,
      });
    }

    const totalCritical = antipatternResults.reduce((sum, r) => sum + ((r["critical"] as number) || 0), 0);
    const totalIssues = antipatternResults.reduce((sum, r) => sum + ((r["totalIssues"] as number) || 0), 0);

    return {
      summary: {
        classesScanned: params.classNames.length,
        totalIssues,
        totalCritical,
        recommendation: totalCritical > 0
          ? "🚨 Critical governor limit violations found. Fix SOQL/DML in loops before deploying."
          : totalIssues > 0
          ? "⚠️ Issues found. Review warnings before production deployment."
          : "✅ No major antipatterns detected.",
      },
      results: antipatternResults,
    };
  }

  // ─── 9 & 10. SFDX CLI bridge (scratch orgs + list orgs) ──────────────────
  async checkSfdxAvailable(): Promise<boolean> {
    const { execSync } = await import("child_process");
    try {
      execSync("sf version --json", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      try {
        execSync("sfdx version --json", { stdio: "pipe", timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  async listAllOrgs(): Promise<Record<string, unknown>> {
    const { execSync } = await import("child_process");
    const available = await this.checkSfdxAvailable();
    if (!available) {
      return {
        error: "Salesforce CLI (sf) not installed or not in PATH",
        suggestion: "Install with: npm install -g @salesforce/cli",
        alternative: "Use SF_USERNAME environment variable to connect to a specific org via REST",
      };
    }

    try {
      const output = execSync("sf org list --json", { stdio: "pipe", timeout: 15000 }).toString();
      const parsed = JSON.parse(output);
      return { success: true, orgs: parsed.result ?? parsed };
    } catch (err) {
      return { error: `sf org list failed: ${String(err)}` };
    }
  }

  async createScratchOrg(params: {
    devHubAlias?: string;
    alias: string;
    definitionFile?: string;
    durationDays?: number;
    edition?: string;
    noNamespace?: boolean;
  }): Promise<Record<string, unknown>> {
    const { execSync } = await import("child_process");
    const available = await this.checkSfdxAvailable();
    if (!available) {
      return {
        error: "Salesforce CLI (sf) not installed or not in PATH",
        suggestion: "Install with: npm install -g @salesforce/cli",
        docs: "https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm",
      };
    }

    try {
      const cmd = [
        "sf org create scratch",
        params.devHubAlias ? `--target-dev-hub ${params.devHubAlias}` : "",
        `--alias ${params.alias}`,
        params.definitionFile ? `--definition-file ${params.definitionFile}` : `--edition ${params.edition ?? "developer"}`,
        `--duration-days ${params.durationDays ?? 7}`,
        params.noNamespace ? "--no-namespace" : "",
        "--json",
      ].filter(Boolean).join(" ");

      const output = execSync(cmd, { stdio: "pipe", timeout: 120000 }).toString();
      const parsed = JSON.parse(output);
      return { success: true, org: parsed.result ?? parsed };
    } catch (err) {
      const errStr = String(err);
      return {
        success: false,
        error: errStr,
        hint: errStr.includes("not authorized") ? "Run 'sf org login web --set-default-dev-hub' first" : undefined,
      };
    }
  }

  async deleteScratchOrg(aliasOrUsername: string): Promise<Record<string, unknown>> {
    const { execSync } = await import("child_process");
    const available = await this.checkSfdxAvailable();
    if (!available) return { error: "Salesforce CLI not available" };

    try {
      const output = execSync(
        `sf org delete scratch --target-org ${aliasOrUsername} --no-prompt --json`,
        { stdio: "pipe", timeout: 30000 }
      ).toString();
      return { success: true, result: JSON.parse(output) };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async openOrg(aliasOrUsername?: string): Promise<Record<string, unknown>> {
    const { execSync } = await import("child_process");
    const available = await this.checkSfdxAvailable();
    if (!available) {
      // Fall back to returning login URL
      await this.ensureAuth();
      return {
        loginUrl: this.auth?.instanceUrl,
        message: "Salesforce CLI not available. Open the URL above in your browser.",
      };
    }

    try {
      const target = aliasOrUsername ? `--target-org ${aliasOrUsername}` : "";
      const output = execSync(`sf org open ${target} --url-only --json`, {
        stdio: "pipe",
        timeout: 15000,
      }).toString();
      const parsed = JSON.parse(output);
      return { success: true, url: parsed.result?.url ?? parsed };
    } catch {
      await this.ensureAuth();
      return {
        loginUrl: this.auth?.instanceUrl,
        message: "Could not open via CLI. Use the URL above.",
      };
    }
  }

  // ─── BULK 2.0 API ──────────────────────────────────────────────────────────
  // Handles millions of records via CSV. Three job types:
  //   ingest: insert | update | upsert | delete | hardDelete
  //   query:  SOQL queries returning large result sets

  private getBulkBaseUrl(): string {
    return `${this.auth!.instanceUrl}/services/data/${this.config.apiVersion}`;
  }

  private getBulkHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.auth!.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  // Convert array of objects → CSV string
  private recordsToCsv(records: Record<string, unknown>[]): string {
    if (!records.length) return "";
    const headers = Object.keys(records[0]);
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows = records.map((r) => headers.map((h) => escape(r[h])).join(","));
    return [headers.join(","), ...rows].join("\n");
  }

  // Parse CSV string → array of objects
  private csvToRecords(csv: string): Record<string, unknown>[] {
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map((line) => {
      const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? [];
      const record: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        record[h] = (values[i] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"');
      });
      return record;
    });
  }

  // ─── Bulk 2.0 Ingest (insert/update/upsert/delete/hardDelete) ─────────────
  async bulkIngestCreate(params: {
    sobject: string;
    operation: "insert" | "update" | "upsert" | "delete" | "hardDelete";
    externalIdFieldName?: string; // required for upsert
    lineEnding?: "LF" | "CRLF";
  }): Promise<{ jobId: string; state: string; contentUrl: string }> {
    await this.ensureAuth();
    const body: Record<string, unknown> = {
      object: params.sobject,
      operation: params.operation,
      contentType: "CSV",
      lineEnding: params.lineEnding ?? "LF",
      ...(params.operation === "upsert" && params.externalIdFieldName
        ? { externalIdFieldName: params.externalIdFieldName }
        : {}),
    };
    const response = await axios.post(
      `${this.getBulkBaseUrl()}/jobs/ingest`,
      body,
      { headers: this.getBulkHeaders() }
    );
    const d = response.data as { id: string; state: string; contentUrl: string };
    return { jobId: d.id, state: d.state, contentUrl: d.contentUrl };
  }

  async bulkIngestUpload(jobId: string, csvData: string): Promise<void> {
    await this.ensureAuth();
    await axios.put(
      `${this.getBulkBaseUrl()}/jobs/ingest/${jobId}/batches`,
      csvData,
      {
        headers: {
          Authorization: `Bearer ${this.auth!.accessToken}`,
          "Content-Type": "text/csv",
          Accept: "application/json",
        },
      }
    );
  }

  async bulkIngestClose(jobId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    const response = await axios.patch(
      `${this.getBulkBaseUrl()}/jobs/ingest/${jobId}`,
      { state: "UploadComplete" },
      { headers: this.getBulkHeaders() }
    );
    return response.data as Record<string, unknown>;
  }

  async bulkIngestAbort(jobId: string): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    const response = await axios.patch(
      `${this.getBulkBaseUrl()}/jobs/ingest/${jobId}`,
      { state: "Aborted" },
      { headers: this.getBulkHeaders() }
    );
    return response.data as Record<string, unknown>;
  }

  async bulkIngestDelete(jobId: string): Promise<void> {
    await this.ensureAuth();
    await axios.delete(
      `${this.getBulkBaseUrl()}/jobs/ingest/${jobId}`,
      { headers: this.getBulkHeaders() }
    );
  }

  // Full ingest flow: create job → upload CSV → close → return jobId
  async bulkIngest(params: {
    sobject: string;
    operation: "insert" | "update" | "upsert" | "delete" | "hardDelete";
    records: Record<string, unknown>[];
    externalIdFieldName?: string;
  }): Promise<{ jobId: string; recordCount: number; state: string; message: string }> {
    if (!params.records.length) throw new Error("No records provided");

    // Create job
    const job = await this.bulkIngestCreate({
      sobject: params.sobject,
      operation: params.operation,
      externalIdFieldName: params.externalIdFieldName,
    });

    // Upload CSV
    const csv = this.recordsToCsv(params.records);
    await this.bulkIngestUpload(job.jobId, csv);

    // Close (signals upload complete, Salesforce begins processing)
    await this.bulkIngestClose(job.jobId);

    return {
      jobId: job.jobId,
      recordCount: params.records.length,
      state: "UploadComplete",
      message: `Bulk ${params.operation} job created for ${params.records.length} ${params.sobject} records. Use sf_get_bulk_job_status with jobId "${job.jobId}" to track progress.`,
    };
  }

  // ─── Bulk 2.0 Job Status ───────────────────────────────────────────────────
  async getBulkJobStatus(jobId: string, jobType: "ingest" | "query" = "ingest"): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    const response = await axios.get(
      `${this.getBulkBaseUrl()}/jobs/${jobType}/${jobId}`,
      { headers: this.getBulkHeaders() }
    );
    const d = response.data as Record<string, unknown>;
    // Add human-readable summary
    return {
      ...d,
      summary: {
        jobId,
        state: d["state"],
        object: d["object"],
        operation: d["operation"],
        totalProcessed: d["numberRecordsProcessed"],
        failed: d["numberRecordsFailed"],
        succeeded: (Number(d["numberRecordsProcessed"]) || 0) - (Number(d["numberRecordsFailed"]) || 0),
        createdDate: d["createdDate"],
      },
    };
  }

  async listBulkJobs(jobType: "ingest" | "query" = "ingest"): Promise<Record<string, unknown>> {
    await this.ensureAuth();
    const response = await axios.get(
      `${this.getBulkBaseUrl()}/jobs/${jobType}`,
      { headers: this.getBulkHeaders() }
    );
    return response.data as Record<string, unknown>;
  }

  // ─── Bulk 2.0 Ingest Results ───────────────────────────────────────────────
  async getBulkJobResults(params: {
    jobId: string;
    resultType: "successfulResults" | "failedResults" | "unprocessedrecords";
    maxRecords?: number;
  }): Promise<{ records: Record<string, unknown>[]; count: number; resultType: string }> {
    await this.ensureAuth();
    const response = await axios.get(
      `${this.getBulkBaseUrl()}/jobs/ingest/${params.jobId}/${params.resultType}`,
      {
        headers: {
          Authorization: `Bearer ${this.auth!.accessToken}`,
          Accept: "text/csv",
        },
        responseType: "text",
      }
    );
    const records = this.csvToRecords(response.data as string);
    const limited = params.maxRecords ? records.slice(0, params.maxRecords) : records;
    return { records: limited, count: limited.length, resultType: params.resultType };
  }

  // ─── Bulk 2.0 Query ────────────────────────────────────────────────────────
  async bulkQueryCreate(soql: string): Promise<{ jobId: string; state: string }> {
    await this.ensureAuth();
    const response = await axios.post(
      `${this.getBulkBaseUrl()}/jobs/query`,
      { operation: "query", query: soql },
      { headers: this.getBulkHeaders() }
    );
    const d = response.data as { id: string; state: string };
    return { jobId: d.id, state: d.state };
  }

  async getBulkQueryResults(params: {
    jobId: string;
    maxRecords?: number;
    locator?: string; // for pagination of massive result sets
  }): Promise<{ records: Record<string, unknown>[]; count: number; nextLocator?: string; done: boolean }> {
    await this.ensureAuth();
    const urlParams = new URLSearchParams();
    if (params.maxRecords) urlParams.set("maxRecords", String(params.maxRecords));
    if (params.locator && params.locator !== "null") urlParams.set("locator", params.locator);

    const response = await axios.get(
      `${this.getBulkBaseUrl()}/jobs/query/${params.jobId}/results?${urlParams}`,
      {
        headers: {
          Authorization: `Bearer ${this.auth!.accessToken}`,
          Accept: "text/csv",
        },
        responseType: "text",
      }
    );

    const nextLocator = response.headers["sforce-locator"] as string | undefined;
    const records = this.csvToRecords(response.data as string);

    return {
      records,
      count: records.length,
      nextLocator: nextLocator && nextLocator !== "null" ? nextLocator : undefined,
      done: !nextLocator || nextLocator === "null",
    };
  }

  // Full bulk query flow: create job → poll until complete → return results
  async bulkQuery(params: {
    soql: string;
    maxRecords?: number;
    pollIntervalSeconds?: number;
    maxPollSeconds?: number;
  }): Promise<{ jobId: string; records: Record<string, unknown>[]; count: number; done: boolean; truncated: boolean }> {
    const { jobId } = await this.bulkQueryCreate(params.soql);

    // Poll until complete
    const maxMs = (params.maxPollSeconds ?? 120) * 1000;
    const intervalMs = (params.pollIntervalSeconds ?? 5) * 1000;
    const start = Date.now();
    let state = "UploadComplete";

    while (Date.now() - start < maxMs) {
      const status = await this.getBulkJobStatus(jobId, "query");
      state = status["state"] as string;
      if (state === "JobComplete" || state === "Failed" || state === "Aborted") break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    if (state !== "JobComplete") {
      return {
        jobId,
        records: [],
        count: 0,
        done: false,
        truncated: false,
      };
    }

    // Get results
    const results = await this.getBulkQueryResults({
      jobId,
      maxRecords: params.maxRecords ?? 10000,
    });

    return {
      jobId,
      records: results.records,
      count: results.count,
      done: results.done,
      truncated: !results.done,
    };
  }

  // ─── Error Helper ──────────────────────────────────────────────────────────
  private formatError(err: unknown, context: string): Error {
    if (axios.isAxiosError(err)) {
      const sfErrors = err.response?.data;
      if (Array.isArray(sfErrors) && sfErrors.length > 0) {
        const msg = sfErrors.map((e: { errorCode?: string; message?: string }) =>
          `[${e.errorCode}] ${e.message}`
        ).join("; ");
        return new Error(`Salesforce error during ${context}: ${msg}`);
      }
      return new Error(
        `Salesforce HTTP ${err.response?.status} during ${context}: ${err.message}`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
