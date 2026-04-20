import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  DashboardIdSchema,
  RunReportFilteredSchema,
  SubmitApprovalSchema,
  ApproveRejectSchema,
  ListUsersSchema,
  UserIdSchema,
  PermSetIdSchema,
  AsyncJobStatusSchema,
  ChatterFeedSchema,
  PostChatterSchema,
  RecordFilesSchema,
} from "../schemas/tools.js";

export function registerOrgTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── Dashboards ────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_dashboards",
    {
      title: "List Salesforce Dashboards",
      description: `List all Dashboards in the org with metadata.

No args required.

Returns: Dashboard ID, Title, Folder, LastRefreshDate, LastModifiedDate.

Use dashboard IDs here to call sf_get_dashboard or sf_refresh_dashboard.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const dashboards = await client.listDashboards();
      const result = { count: dashboards.length, dashboards };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_get_dashboard",
    {
      title: "Get Dashboard Metadata",
      description: `Get full metadata for a Salesforce Dashboard — components, filters, layout.

Args:
  - dashboard_id (string): Salesforce Dashboard ID (from sf_list_dashboards)

Returns: Dashboard definition with all components and filters.`,
      inputSchema: DashboardIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ dashboard_id }) => {
      const result = await client.getDashboard(dashboard_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_get_dashboard_results",
    {
      title: "Get Dashboard Data/Results",
      description: `Get the actual data and results rendered in a Salesforce Dashboard.

Args:
  - dashboard_id (string): Salesforce Dashboard ID

Returns: Dashboard component data, chart values, metrics, and table results.`,
      inputSchema: DashboardIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ dashboard_id }) => {
      const result = await client.getDashboardResults(dashboard_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_refresh_dashboard",
    {
      title: "Refresh Dashboard",
      description: `Trigger a refresh of a Salesforce Dashboard to pull latest data.

Args:
  - dashboard_id (string): Salesforce Dashboard ID

Returns: Refresh confirmation.`,
      inputSchema: DashboardIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ dashboard_id }) => {
      const result = await client.refreshDashboard(dashboard_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Reports (Extended) ────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_report_metadata",
    {
      title: "Get Report Metadata",
      description: `Get the full metadata for a Salesforce Report — columns, filters, groupings, chart settings.

Args:
  - report_id (string): Salesforce Report ID

Returns: Report schema, available columns, current filters, and grouping config.

Use this to understand a report's structure before running it with custom filters via sf_run_report_filtered.`,
      inputSchema: z.object({ report_id: z.string().min(15) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ report_id }) => {
      const result = await client.getReportMetadata(report_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_run_report_filtered",
    {
      title: "Run Report with Custom Filters",
      description: `Execute a Salesforce Report with runtime filter overrides — without modifying the saved report.

Args:
  - report_id (string): Salesforce Report ID
  - filters (array): Runtime filters to apply, each with:
    - column: API column name (get from sf_get_report_metadata)
    - operator: equals | notEqual | lessThan | greaterThan | lessOrEqual | greaterOrEqual | contains | notContain | startsWith | includes | excludes
    - value: filter value as string

Returns: Full filtered report results.

Examples:
  - Run pipeline report for specific owner: filters: [{ column: "OWNER", operator: "equals", value: "John Smith" }]
  - Run revenue report for Q3: filters: [{ column: "CLOSE_DATE", operator: "equals", value: "THIS_QUARTER" }]
  - Run support report for Priority = High: filters: [{ column: "PRIORITY", operator: "equals", value: "High" }]`,
      inputSchema: RunReportFilteredSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ report_id, filters }) => {
      const result = await client.runReportFiltered(report_id, filters);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Approval Processes ────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_approval_processes",
    {
      title: "List Approval Processes",
      description: `List all Approval Processes defined in the org.

No args required.

Returns: Approval process names, target objects, and order.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const processes = await client.listApprovalProcesses();
      const result = { count: processes.length, approvalProcesses: processes };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_submit_for_approval",
    {
      title: "Submit Record for Approval",
      description: `Submit a Salesforce record into an Approval Process.

Args:
  - record_id (string): ID of the record to submit
  - comments (string, optional): Submission comments
  - next_approver_id (string, optional): User ID to assign as next approver

Returns: Submission result with new process instance ID.

Example:
  { record_id: "0061a00000XYZ", comments: "Submitting Q4 enterprise deal for Director approval" }`,
      inputSchema: SubmitApprovalSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ record_id, comments, next_approver_id }) => {
      const result = await client.submitForApproval(record_id, comments, next_approver_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_approve_reject",
    {
      title: "Approve or Reject Work Item",
      description: `Approve or reject a pending approval work item.

Args:
  - work_item_id (string): ProcessInstanceWorkitem ID (from sf_get_pending_approvals)
  - action (string): "Approve" or "Reject"
  - comments (string, optional): Approval/rejection reason

Returns: Result of the approval action.`,
      inputSchema: ApproveRejectSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ work_item_id, action, comments }) => {
      const result = await client.approveRejectRecord(work_item_id, action, comments);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_get_pending_approvals",
    {
      title: "Get Pending Approval Work Items",
      description: `Get all pending approval work items across the org — who's waiting for what to be approved.

No args required.

Returns: Work items with target record, actor (approver), elapsed time, and created date.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const items = await client.getPendingApprovals();
      const result = { count: items.length, pendingApprovals: items };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Users & Permissions ───────────────────────────────────────────────────
  server.registerTool(
    "sf_list_users",
    {
      title: "List Salesforce Users",
      description: `List users in the org with profile, role, and login info.

Args:
  - active_only (boolean): Return only active users (default: true)

Returns: Users with ID, name, email, username, profile, role, and last login date.`,
      inputSchema: ListUsersSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ active_only }) => {
      const users = await client.listUsers(active_only);
      const result = { count: users.length, users };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_get_user",
    {
      title: "Get User Detail",
      description: `Get detailed info for a specific Salesforce user.

Args:
  - user_id (string): Salesforce User ID

Returns: Full user record with profile, role, department, title, and login history.`,
      inputSchema: UserIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id }) => {
      const result = await client.getUserById(user_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_list_permission_sets",
    {
      title: "List Permission Sets",
      description: `List all custom Permission Sets in the org.

No args required.

Returns: Permission sets with ID, name, label, and description.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const permSets = await client.listPermissionSets();
      const result = { count: permSets.length, permissionSets: permSets };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_list_profiles",
    {
      title: "List Profiles",
      description: `List all Profiles in the org.

No args required.

Returns: Profiles with ID, name, description, and user type.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const profiles = await client.listProfiles();
      const result = { count: profiles.length, profiles };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_get_permission_set_assignments",
    {
      title: "Get Permission Set Assignments",
      description: `See which users are assigned to a specific Permission Set.

Args:
  - permission_set_id (string): Permission Set ID (from sf_list_permission_sets)

Returns: Users assigned to this permission set.`,
      inputSchema: PermSetIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ permission_set_id }) => {
      const assignments = await client.getPermissionSetAssignments(permission_set_id);
      const result = { count: assignments.length, assignments };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Scheduled & Async Jobs ────────────────────────────────────────────────
  server.registerTool(
    "sf_list_scheduled_jobs",
    {
      title: "List Scheduled Apex Jobs",
      description: `List all scheduled Apex jobs (CronTrigger) in the org.

No args required.

Returns: Scheduled jobs with Apex class name, cron expression, next fire time, previous fire time, and state.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const jobs = await client.listScheduledJobs();
      const result = { count: jobs.length, scheduledJobs: jobs };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_list_async_apex_jobs",
    {
      title: "List Async Apex Jobs",
      description: `List Async Apex jobs (Batch Apex, Queueable, Future) with status.

Args:
  - status (string, optional): Filter by status: Queued | Holding | Preparing | Processing | Aborted | Completed | Failed

Returns: Async jobs with class name, status, error count, items processed, and timestamps.

Examples:
  - {} → all recent async jobs
  - { status: "Failed" } → only failed jobs
  - { status: "Processing" } → jobs currently running`,
      inputSchema: AsyncJobStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      const jobs = await client.listAsyncApexJobs(status);
      const result = { count: jobs.length, asyncJobs: jobs };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Chatter & Collaboration ───────────────────────────────────────────────
  server.registerTool(
    "sf_get_record_feed",
    {
      title: "Get Record Chatter Feed",
      description: `Get Chatter posts and comments on a Salesforce record.

Args:
  - record_id (string): Any record ID (Account, Opportunity, Case, etc.)

Returns: Feed items with body, author, likes, and comments.`,
      inputSchema: ChatterFeedSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ record_id }) => {
      const result = await client.getRecordFeed(record_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_post_chatter",
    {
      title: "Post Chatter Message",
      description: `Post a Chatter message on any Salesforce record.

Args:
  - record_id (string): Record to post on (Account, Opportunity, Case, etc.)
  - message (string): Chatter message text

Returns: Created feed element ID and confirmation.

Example:
  { record_id: "0061a00000XYZ", message: "Deal review complete — pushing to legal for contract sign-off. CC @JohnSmith" }`,
      inputSchema: PostChatterSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ record_id, message }) => {
      const result = await client.postChatterFeed(record_id, message);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Files & Attachments ───────────────────────────────────────────────────
  server.registerTool(
    "sf_list_record_files",
    {
      title: "List Files on a Record",
      description: `List all files (ContentDocuments) attached to a Salesforce record.

Args:
  - record_id (string): Record ID to list files for

Returns: Files with title, file type, size, and last modified date.`,
      inputSchema: RecordFilesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ record_id }) => {
      const files = await client.listContentDocuments(record_id);
      const result = { count: files.length, files };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "sf_list_attachments",
    {
      title: "List Classic Attachments on a Record",
      description: `List classic Attachments (pre-Files) on a Salesforce record.

Args:
  - record_id (string): Parent record ID

Returns: Attachments with name, content type, size, and description.`,
      inputSchema: RecordFilesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ record_id }) => {
      const attachments = await client.listAttachments(record_id);
      const result = { count: attachments.length, attachments };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
