import { toolHandler, ok } from "../utils/errors.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SalesforceClient } from "../services/salesforce-client.js";
import { ExecuteApexSchema, InvokeFlowSchema, RunReportSchema } from "../schemas/tools.js";
import { z } from "zod";

export function registerAdvancedTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── Execute Anonymous Apex ─────────────────────────────────────────────────
  server.registerTool(
    "sf_execute_apex",
    {
      title: "Execute Anonymous Apex",
      description: `Execute anonymous Apex code in the Salesforce org.

Use for complex data operations, mass updates, or custom logic that can't be done via standard CRUD.

Args:
  - apex_code (string): Valid Apex code to execute anonymously

Returns: { success, compileProblem, exceptionMessage }

Examples:
  - Debug org info: "System.debug(UserInfo.getOrganizationName() + ' | ' + UserInfo.getName());"
  - Mass update: "List<Account> accs = [SELECT Id FROM Account WHERE Rating = null LIMIT 100]; for(Account a : accs) a.Rating = 'Warm'; update accs;"
  - Count records: "System.debug([SELECT COUNT() FROM Lead WHERE IsConverted = false]);"

⚠️ Note: Executes with the authenticated user's permissions. Use with care in production.`,
      inputSchema: ExecuteApexSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ apex_code }) => {
      const result = await client.executeApex(apex_code);
      const text = result.success
        ? `✅ Apex executed successfully`
        : `❌ Apex failed\nCompile error: ${result.compileProblem ?? "none"}\nException: ${result.exceptionMessage ?? "none"}`;
      return {
        content: [{ type: "text", text: JSON.stringify({ ...result, summary: text }, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── List Flows ─────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_flows",
    {
      title: "List Salesforce Flows",
      description: `List all active Flows in the Salesforce org, including their API names, type, and status.

No args required.

Returns: Array of flows with Id, ApiName, Label, Status, ProcessType, TriggerType.

Use this to discover Flow API names before calling sf_invoke_flow.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const flows = await client.listFlows();
      const result = { count: flows.length, flows };
      return ok(result);
    }
  );

  // ─── Invoke Flow ────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_invoke_flow",
    {
      title: "Invoke Salesforce Flow",
      description: `Invoke an autolaunched Salesforce Flow by its API name.

Args:
  - flow_api_name (string): API name of the Flow (use sf_list_flows to find it)
  - inputs (object): Input variables required by the Flow as key-value pairs

Returns: Flow output variables.

Example:
  { flow_api_name: "Send_Welcome_Email_Flow", inputs: { "ContactId": "0031a00000XYZ", "TemplateName": "Welcome" } }`,
      inputSchema: InvokeFlowSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ flow_api_name, inputs }) => {
      const result = await client.invokeFlow(flow_api_name, inputs);
      return ok(result);
    }
  );

  // ─── List Reports ───────────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_reports",
    {
      title: "List Salesforce Reports",
      description: `List all Salesforce Reports available in the org.

No args required.

Returns: Array of reports with Id, Name, DeveloperName, FolderName, LastRunDate.

Use report IDs from here to call sf_run_report.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const reports = await client.listReports();
      const result = { count: reports.length, reports };
      return ok(result);
    }
  );

  // ─── Run Report ─────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_run_report",
    {
      title: "Run Salesforce Report",
      description: `Execute a Salesforce Report and return the results including data, groupings, and aggregates.

Args:
  - report_id (string): Report ID (15 or 18 chars — get from sf_list_reports)

Returns: Full report results including column headers, rows, and aggregate values.

Example: { report_id: "00O1a00000XYZ" }`,
      inputSchema: RunReportSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ report_id }) => {
      const result = await client.runReport(report_id);
      return ok(result);
    }
  );

  // ─── Org Limits ─────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_org_limits",
    {
      title: "Get Org API Limits",
      description: `Get current Salesforce org API limits and usage — how many API calls remain, data storage, etc.

No args required.

Returns: Object with limit names, Max values, and Remaining values.

Useful for: checking API headroom, storage usage, async Apex queue limits.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = await client.getOrgLimits();
      return ok(result);
    }
  );

  // ─── Get Current User ───────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_current_user",
    {
      title: "Get Current Salesforce User",
      description: `Get information about the currently authenticated Salesforce user — name, ID, role, profile, locale.

No args required.

Returns: User record with id, name, email, role, profile, and org details.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = await client.getCurrentUser();
      return ok(result);
    }
  );
}
