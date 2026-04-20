import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  DeployMetadataSchema,
  DeployIdSchema,
  RetrieveMetadataSchema,
  RetrieveIdSchema,
  AssignPermSetSchema,
  CreateScratchOrgSchema,
  OrgAliasSchema,
} from "../schemas/tools.js";

export function registerDevOpsTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── 2. Deploy Metadata ────────────────────────────────────────────────────
  server.registerTool(
    "sf_deploy_metadata",
    {
      title: "Deploy Metadata",
      description: `Deploy Salesforce metadata (Apex, Flows, Objects, Fields, Layouts, etc.) to an org using the Metadata API.

Accepts a base64-encoded ZIP file in MDAPI format. Returns a deployId immediately — use sf_get_deploy_status or sf_resume_operation to track completion.

Args:
  - zip_base64 (string): Base64-encoded ZIP of metadata in MDAPI format
  - check_only (boolean): Validate without committing changes (default: false)
  - test_level: NoTestRun | RunSpecifiedTests | RunLocalTests | RunAllTestsInOrg
  - run_tests (string[]): Specific test classes if test_level = RunSpecifiedTests
  - ignore_warnings (boolean): Continue even with warnings (default: false)
  - rollback_on_error (boolean): Roll back all on any failure (default: true)

Returns: { deployId } — use with sf_resume_operation to wait for result.

MDAPI ZIP structure:
  package.xml
  classes/
    AccountService.cls
    AccountService.cls-meta.xml
  flows/
    My_Flow.flow-meta.xml

Examples:
  - Validate-only: { zip_base64: "...", check_only: true, test_level: "RunLocalTests" }
  - Full deploy: { zip_base64: "...", test_level: "NoTestRun" }`,
      inputSchema: DeployMetadataSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ zip_base64, check_only, test_level, run_tests, ignore_warnings, rollback_on_error }) => {
      const result = await client.deployMetadata({
        zipBase64: zip_base64,
        options: {
          checkOnly: check_only,
          testLevel: test_level,
          runTests: run_tests,
          ignoreWarnings: ignore_warnings,
          rollbackOnError: rollback_on_error,
        },
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            next_step: `Call sf_resume_operation with { operation_type: "deploy", operation_id: "${result.deployId}" } to wait for completion, or sf_get_deploy_status to check immediately.`,
          }, null, 2),
        }],
        structuredContent: result,
      };
    }
  );

  // ─── Get Deploy Status ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_deploy_status",
    {
      title: "Get Deploy Status",
      description: `Get the current status of a metadata deploy operation.

Args:
  - deploy_id (string): Deploy request ID from sf_deploy_metadata

Returns: Full deploy result including status, component successes/failures, test results, and error details.

Status values: Queued → InProgress → Succeeded | Failed | Canceled | SucceededPartial`,
      inputSchema: DeployIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ deploy_id }) => {
      const result = await client.getDeployStatus(deploy_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 3. Retrieve Metadata ──────────────────────────────────────────────────
  server.registerTool(
    "sf_retrieve_metadata",
    {
      title: "Retrieve Metadata",
      description: `Retrieve Salesforce metadata from an org to inspect or back up. Returns a retrieveId — use sf_get_retrieve_status to get the zip when done.

Args:
  - specific_types (array): Metadata types and members to retrieve:
    - name: Metadata type (e.g. "ApexClass", "Flow", "CustomObject", "Layout", "PermissionSet")
    - members: Component names — use "*" for all, or specific names
  - package_names (string[]): Installed package names to retrieve
  - api_version (string): Override API version (e.g. "60.0")

Returns: { retrieveId } — use with sf_resume_operation or sf_get_retrieve_status.

Common metadata types: ApexClass, ApexTrigger, AuraDefinitionBundle, CustomApplication, CustomField,
CustomLabel, CustomObject, CustomTab, Flow, Layout, LightningComponentBundle, PermissionSet,
Profile, Queue, Report, ReportType, Role, SharingRules, ValidationRule, Workflow

Examples:
  - Get all Apex classes: { specific_types: [{ name: "ApexClass", members: ["*"] }] }
  - Get specific flow + object: { specific_types: [{ name: "Flow", members: ["My_Approval_Flow"] }, { name: "CustomObject", members: ["Deal__c"] }] }
  - Get permission sets: { specific_types: [{ name: "PermissionSet", members: ["*"] }] }`,
      inputSchema: RetrieveMetadataSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ specific_types, package_names, api_version }) => {
      const result = await client.retrieveMetadata({
        specificTypes: specific_types,
        packageNames: package_names,
        apiVersion: api_version,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            next_step: `Call sf_resume_operation with { operation_type: "retrieve", operation_id: "${result.retrieveId}" } to wait for completion, then sf_get_retrieve_status to get the base64 ZIP.`,
          }, null, 2),
        }],
        structuredContent: result,
      };
    }
  );

  // ─── Get Retrieve Status ───────────────────────────────────────────────────
  server.registerTool(
    "sf_get_retrieve_status",
    {
      title: "Get Retrieve Status & Download",
      description: `Get the current status of a metadata retrieve. When complete, returns the base64-encoded ZIP.

Args:
  - retrieve_id (string): Retrieve request ID from sf_retrieve_metadata

Returns: Status and, when Succeeded, a zipFile (base64) containing all retrieved metadata.`,
      inputSchema: RetrieveIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ retrieve_id }) => {
      const result = await client.getRetrieveStatus(retrieve_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 4. Assign Permission Set ──────────────────────────────────────────────
  server.registerTool(
    "sf_assign_permission_set",
    {
      title: "Assign Permission Set to User",
      description: `Assign a Permission Set to a Salesforce user. Safe to call if already assigned (returns early).

Args:
  - user_id (string): Salesforce User ID
  - permission_set_name (string): API name of the Permission Set (not label), e.g. 'Sales_Manager_Permissions'

Returns: Success confirmation with assignment details.

Examples:
  - { user_id: "0051a00000XYZ", permission_set_name: "Sales_Manager_Permissions" }
  - { user_id: "0051a00000XYZ", permission_set_name: "API_Access" }

Use sf_list_permission_sets to find valid permission set names.`,
      inputSchema: AssignPermSetSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, permission_set_name }) => {
      const result = await client.assignPermissionSet({ userId: user_id, permissionSetName: permission_set_name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Revoke Permission Set ─────────────────────────────────────────────────
  server.registerTool(
    "sf_revoke_permission_set",
    {
      title: "Revoke Permission Set from User",
      description: `Remove a Permission Set assignment from a user.

Args:
  - user_id (string): Salesforce User ID
  - permission_set_name (string): API name of the Permission Set to revoke

Returns: Success confirmation.`,
      inputSchema: AssignPermSetSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, permission_set_name }) => {
      const result = await client.revokePermissionSet({ userId: user_id, permissionSetName: permission_set_name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 9. List All Orgs ──────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_all_orgs",
    {
      title: "List All Authorized Orgs",
      description: `List all Salesforce orgs authorized on this machine via the Salesforce CLI.

Requires: Salesforce CLI (sf) installed and orgs authenticated via 'sf org login web'.

No args required.

Returns: All authorized orgs (scratch orgs, sandboxes, production orgs) with aliases, usernames, and expiry dates.

If CLI is not installed, returns installation instructions and the current connected org's URL as fallback.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = await client.listAllOrgs();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 10. Create Scratch Org ────────────────────────────────────────────────
  server.registerTool(
    "sf_create_scratch_org",
    {
      title: "Create Scratch Org",
      description: `Create a new Salesforce scratch org via the Salesforce CLI.

Requires: Salesforce CLI (sf) installed + a Dev Hub org authorized locally.

Args:
  - alias (string): Short alias for the scratch org, e.g. 'feature-branch-42'
  - edition: developer | enterprise | group | professional | partner-developer (default: developer)
  - duration_days (number): Lifetime in days, 1-30 (default: 7)
  - dev_hub_alias (string, optional): Dev Hub alias (uses default if not set)
  - definition_file (string, optional): Path to scratch org definition JSON (overrides edition)
  - no_namespace (boolean): Create without namespace (default: false)

Returns: Scratch org details including username, instance URL, and org ID.

If CLI is not installed, returns installation instructions.

Example:
  { alias: "sprint-47-dev", edition: "developer", duration_days: 14 }`,
      inputSchema: CreateScratchOrgSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ alias, edition, duration_days, dev_hub_alias, definition_file, no_namespace }) => {
      const result = await client.createScratchOrg({
        alias,
        edition,
        durationDays: duration_days,
        devHubAlias: dev_hub_alias,
        definitionFile: definition_file,
        noNamespace: no_namespace,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Delete Scratch Org ────────────────────────────────────────────────────
  server.registerTool(
    "sf_delete_scratch_org",
    {
      title: "Delete Scratch Org",
      description: `Delete a Salesforce scratch org by alias or username.

Requires Salesforce CLI.

Args:
  - alias_or_username (string): Org alias or username to delete

⚠️ Permanent. The scratch org and all its data will be deleted.`,
      inputSchema: OrgAliasSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ alias_or_username }) => {
      if (!alias_or_username) return { content: [{ type: "text", text: JSON.stringify({ error: "alias_or_username is required" }) }] };
      const result = await client.deleteScratchOrg(alias_or_username);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Open Org in Browser ───────────────────────────────────────────────────
  server.registerTool(
    "sf_open_org",
    {
      title: "Open Org in Browser / Get Login URL",
      description: `Get the browser login URL for a Salesforce org. Opens via CLI if available, otherwise returns the instance URL.

Args:
  - alias_or_username (string, optional): Org alias or username (uses current connected org if not specified)

Returns: Login URL for the org.`,
      inputSchema: OrgAliasSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ alias_or_username }) => {
      const result = await client.openOrg(alias_or_username);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
