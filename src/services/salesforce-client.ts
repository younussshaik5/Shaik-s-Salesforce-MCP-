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
  private authPromise: Promise<void> | null = null; // mutex — prevent concurrent auth

  // Axios timeout: 30s for normal calls, 120s for bulk/deploy
  private readonly TIMEOUT_MS = 30_000;
  private readonly BULK_TIMEOUT_MS = 120_000;

  constructor(config: SalesforceConfig) {
    this.config = config;
  }

  // ─── Auth: Password Flow ───────────────────────────────────────────────────
  private async authenticatePassword(): Promise<void> {
    if (!this.config.clientSecret || !this.config.password) {
      throw new Error(
        "Password auth requires SF_CLIENT_SECRET and SF_PASSWORD.\n" +
        "Also ensure: Salesforce Setup → OAuth and OpenID Connect Settings → Allow OAuth Username-Password Flows is ON."
      );
    }
    const params = {
      grant_type: "password",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password + (this.config.securityToken ?? ""),
    };
    try {
      const response = await axios.post(
        `${this.config.loginUrl}/services/oauth2/token`,
        qs.stringify(params),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: this.TIMEOUT_MS,
        }
      );
      this.setAuth(response.data);
    } catch (err) {
      throw this.formatAuthError(err);
    }
  }

  // ─── Auth: JWT Bearer Flow ─────────────────────────────────────────────────
  private async authenticateJWT(): Promise<void> {
    let privateKey: string;
    if (this.config.privateKey) {
      // Support both \\n (env var escaped) and real newlines
      privateKey = this.config.privateKey.replace(/\\n/g, "\n");
    } else if (this.config.privateKeyFile) {
      // Normalize path separators for Windows
      const keyPath = this.config.privateKeyFile.replace(/\\/g, "/");
      if (!fs.existsSync(keyPath)) {
        throw new Error(
          `Private key file not found: ${keyPath}\n` +
          `Set SF_PRIVATE_KEY_FILE to the absolute path of your .key or .pem file.`
        );
      }
      privateKey = fs.readFileSync(keyPath, "utf8");
    } else {
      throw new Error(
        "JWT auth requires SF_PRIVATE_KEY (PEM string) or SF_PRIVATE_KEY_FILE (path to .key/.pem)\n\n" +
        "Generate a key pair:\n" +
        "  openssl genrsa -out server.key 2048\n" +
        "  openssl req -new -x509 -key server.key -out server.crt -days 3650\n" +
        "Upload server.crt to your Connected App → Use digital signatures."
      );
    }

    // Validate PEM format
    if (!privateKey.includes("-----BEGIN")) {
      throw new Error(
        "Private key does not appear to be a valid PEM file. " +
        "It should start with -----BEGIN RSA PRIVATE KEY----- or -----BEGIN PRIVATE KEY-----"
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: this.config.clientId,
      sub: this.config.username,
      aud: this.config.loginUrl,
      exp: now + 300,
    };

    let signedJwt: string;
    try {
      signedJwt = jwt.sign(claim, privateKey, { algorithm: "RS256" });
    } catch (err) {
      throw new Error(
        `Failed to sign JWT: ${err instanceof Error ? err.message : String(err)}\n` +
        "Ensure your private key is a valid RSA key (2048-bit minimum)."
      );
    }

    try {
      const response = await axios.post(
        `${this.config.loginUrl}/services/oauth2/token`,
        qs.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: signedJwt,
        }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: this.TIMEOUT_MS,
        }
      );
      this.setAuth(response.data);
    } catch (err) {
      throw this.formatAuthError(err);
    }
  }

  // ─── Auth error messages ───────────────────────────────────────────────────
  private formatAuthError(err: unknown): Error {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as Record<string, string> | undefined;
      const code = data?.error ?? "";
      const desc = data?.error_description ?? err.message;

      const hints: Record<string, string> = {
        invalid_client:
          "Consumer Key (SF_CLIENT_ID) is wrong. Check your Connected App in Salesforce Setup → App Manager.",
        invalid_client_credentials:
          "Consumer Key or Secret is wrong. Check SF_CLIENT_ID and SF_CLIENT_SECRET.",
        invalid_grant:
          "Wrong username, password, or security token. " +
          "Also check: Setup → OAuth and OpenID Connect Settings → Allow OAuth Username-Password Flows is ON.",
        unsupported_grant_type:
          "Username-Password flow is not enabled. " +
          "Go to Salesforce Setup → OAuth and OpenID Connect Settings → Allow OAuth Username-Password Flows → ON.",
        inactive_user: "This Salesforce user is inactive. Activate the user in Setup → Users.",
        inactive_org: "This Salesforce org is inactive or suspended.",
      };

      const hint = hints[code] ?? "";
      return new Error(
        `Salesforce authentication failed: ${desc}${hint ? `\n\nFix: ${hint}` : ""}`
      );
    }
    if (err instanceof Error && err.message.includes("ENOTFOUND")) {
      return new Error(
        `Cannot reach ${this.config.loginUrl}. Check your internet connection and SF_LOGIN_URL.\n` +
        "For sandbox orgs use https://test.salesforce.com, for production use https://login.salesforce.com"
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // ─── Token management ──────────────────────────────────────────────────────
  private isTokenExpiring(): boolean {
    if (!this.auth) return true;
    // Refresh if within 5 minutes of expiry
    return this.auth.expiresAt < Date.now() + 5 * 60 * 1000;
  }

  private setAuth(data: { access_token: string; instance_url: string; token_type: string }): void {
    this.auth = {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
      tokenType: data.token_type,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2h default
    };
    this.http = axios.create({
      baseURL: `${this.auth.instanceUrl}/services/data/${this.config.apiVersion}`,
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: this.TIMEOUT_MS,
    });
  }

  async authenticate(): Promise<void> {
    // Mutex: if auth is already in progress, wait for it instead of firing a second request
    if (this.authPromise) {
      await this.authPromise;
      return;
    }
    this.authPromise = (
      this.config.authMode === "jwt" ? this.authenticateJWT() : this.authenticatePassword()
    ).finally(() => {
      this.authPromise = null;
    });
    await this.authPromise;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.auth || this.isTokenExpiring()) {
      await this.authenticate();
    }
  }

  // ─── HTTP with auto-retry on 401 ──────────────────────────────────────────
  // If a token expires mid-session, refresh once and retry the request.
  private async httpGet<T>(url: string, params?: Record<string, unknown>, timeout?: number): Promise<T> {
    await this.ensureAuth();
    try {
      const response = await this.http!.get<T>(url, {
        params,
        ...(timeout ? { timeout } : {}),
      });
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        // Token expired — force refresh and retry once
        this.auth = null;
        await this.authenticate();
        const response = await this.http!.get<T>(url, { params });
        return response.data;
      }
      throw err;
    }
  }

  private async httpPost<T>(url: string, body: unknown, headers?: Record<string, string>, timeout?: number): Promise<T> {
    await this.ensureAuth();
    try {
      const response = await this.http!.post<T>(url, body, {
        ...(headers ? { headers } : {}),
        ...(timeout ? { timeout } : {}),
      });
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        this.auth = null;
        await this.authenticate();
        const response = await this.http!.post<T>(url, body, headers ? { headers } : {});
        return response.data;
      }
      throw err;
    }
  }

  private async httpPatch<T>(url: string, body: unknown): Promise<T> {
    await this.ensureAuth();
    try {
      const response = await this.http!.patch<T>(url, body);
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        this.auth = null;
        await this.authenticate();
        const response = await this.http!.patch<T>(url, body);
        return response.data;
      }
      throw err;
    }
  }

  private async httpDelete(url: string): Promise<void> {
    await this.ensureAuth();
    try {
      await this.http!.delete(url);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        this.auth = null;
        await this.authenticate();
        await this.http!.delete(url);
        return;
      }
      throw err;
    }
  }

  getInstanceUrl(): string {
    return this.auth?.instanceUrl ?? "";
  }

  getAuthMode(): string {
    return this.config.authMode;
  }

  // ─── SOQL Query ────────────────────────────────────────────────────────────
  async query<T = Record<string, unknown>>(soql: string): Promise<QueryResult<T>> {
    try {
      return await this.httpGet<QueryResult<T>>("/query", { q: soql });
    } catch (err) {
      throw this.formatError(err, "SOQL query");
    }
  }

  async queryAll<T = Record<string, unknown>>(soql: string, maxRecords = 2000): Promise<QueryResult<T>> {
    const first = await this.query<T>(soql);
    let allRecords = [...first.records];
    let nextUrl = first.nextRecordsUrl;
    while (nextUrl && allRecords.length < maxRecords) {
      try {
        const resp = await this.httpGet<QueryResult<T>>(nextUrl);
        allRecords = allRecords.concat(resp.records);
        nextUrl = resp.nextRecordsUrl;
      } catch { break; }
    }
    return { ...first, records: allRecords.slice(0, maxRecords), done: !nextUrl };
  }

  // ─── SOSL Search ───────────────────────────────────────────────────────────
  async search(sosl: string): Promise<Record<string, unknown>> {
    try {
      return await this.httpGet<Record<string, unknown>>("/search", { q: sosl });
    } catch (err) {
      throw this.formatError(err, "SOSL search");
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────
  async getRecord(sobject: string, id: string, fields?: string[]): Promise<Record<string, unknown>> {
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
      throw new Error(`Invalid record ID: "${id}". Salesforce IDs are 15 or 18 alphanumeric characters.`);
    }
    try {
      const params = fields?.length ? { fields: fields.join(",") } : {};
      return await this.httpGet<Record<string, unknown>>(`/sobjects/${sobject}/${id}`, params);
    } catch (err) {
      throw this.formatError(err, `get ${sobject} record`);
    }
  }

  async createRecord(sobject: string, data: Record<string, unknown>): Promise<{ id: string; success: boolean; errors: unknown[] }> {
    try {
      return await this.httpPost<{ id: string; success: boolean; errors: unknown[] }>(`/sobjects/${sobject}`, data);
    } catch (err) {
      throw this.formatError(err, `create ${sobject}`);
    }
  }

  async updateRecord(sobject: string, id: string, data: Record<string, unknown>): Promise<void> {
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
      throw new Error(`Invalid record ID: "${id}". Salesforce IDs are 15 or 18 alphanumeric characters.`);
    }
    try {
      await this.httpPatch(`/sobjects/${sobject}/${id}`, data);
    } catch (err) {
      throw this.formatError(err, `update ${sobject} ${id}`);
    }
  }

  async deleteRecord(sobject: string, id: string): Promise<void> {
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
      throw new Error(`Invalid record ID: "${id}". Salesforce IDs are 15 or 18 alphanumeric characters.`);
    }
    try {
      await this.httpDelete(`/sobjects/${sobject}/${id}`);
    } catch (err) {
      throw this.formatError(err, `delete ${sobject} ${id}`);
    }
  }

  async upsertRecord(sobject: string, externalIdField: string, externalId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      return await this.httpPatch<Record<string, unknown>>(
        `/sobjects/${sobject}/${externalIdField}/${encodeURIComponent(externalId)}`,
        data
      ) ?? { success: true };
    } catch (err) {
      throw this.formatError(err, `upsert ${sobject}`);
    }
  }

  // ─── Metadata / Describe ───────────────────────────────────────────────────
  async describeSObject(sobject: string): Promise<SObjectDescribe> {
    try {
      return await this.httpGet<SObjectDescribe>(`/sobjects/${sobject}/describe`);
    } catch (err) {
      throw this.formatError(err, `describe ${sobject}`);
    }
  }

  async listSObjects(): Promise<Array<{ name: string; label: string; labelPlural: string; keyPrefix: string; createable: boolean; queryable: boolean }>> {
    try {
      const resp = await this.httpGet<{ sobjects: Array<{ name: string; label: string; labelPlural: string; keyPrefix: string; createable: boolean; queryable: boolean }> }>("/sobjects");
      return resp.sobjects;
    } catch (err) {
      throw this.formatError(err, "list sobjects");
    }
  }

  // ─── Error Helper ──────────────────────────────────────────────────────────
  private formatError(err: unknown, context: string): Error {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data;
      const status = err.response?.status;
      if (Array.isArray(data) && data.length > 0) {
        const msgs = data.map((e: { errorCode?: string; message?: string }) =>
          `[${e.errorCode}] ${e.message}`).join("; ");
        return new Error(`Salesforce error during ${context}: ${msgs}`);
      }
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (d.errorCode) return new Error(`Salesforce error during ${context}: [${d.errorCode}] ${d.message}`);
        if (d.error) return new Error(`Salesforce error during ${context}: ${d.error_description ?? d.error}`);
      }
      if (err.code === "ECONNABORTED") return new Error(`Request timed out during ${context}. Try adding a LIMIT or WHERE clause.`);
      if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") return new Error(`Cannot reach Salesforce during ${context}. Check internet connection and SF_LOGIN_URL.`);
      return new Error(`Salesforce HTTP ${status} during ${context}: ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
