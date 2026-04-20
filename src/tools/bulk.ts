import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  BulkIngestSchema,
  BulkJobIdSchema,
  BulkJobResultsSchema,
  BulkQuerySchema,
  BulkQueryResultsSchema,
  ListBulkJobsSchema,
} from "../schemas/tools.js";

export function registerBulkTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── Bulk 2.0 Ingest ───────────────────────────────────────────────────────
  server.registerTool(
    "sf_bulk_ingest",
    {
      title: "Bulk 2.0 Ingest (Millions of Records)",
      description: `Create and upload a Bulk 2.0 ingest job — insert, update, upsert, delete, or hardDelete millions of records.

Handles the full flow: create job → convert records to CSV → upload → close. Returns a jobId immediately.
Processing happens asynchronously. Use sf_get_bulk_job_status to track, sf_get_bulk_job_results for outcomes.

Args:
  - sobject (string): Salesforce object API name
  - operation: insert | update | upsert | delete | hardDelete
  - records (array): JSON array of records. For delete/hardDelete only Id field needed.
  - external_id_field (string): Required for upsert — external ID field API name

Returns: { jobId, recordCount, state, message }

Examples:
  - Bulk insert leads:
    { sobject: "Lead", operation: "insert", records: [{ "FirstName": "Alice", "LastName": "Smith", "Company": "Acme", "Email": "alice@acme.com" }, ...] }

  - Bulk update opportunity stages:
    { sobject: "Opportunity", operation: "update", records: [{ "Id": "006XXX", "StageName": "Closed Won" }, ...] }

  - Bulk upsert accounts by external ID:
    { sobject: "Account", operation: "upsert", external_id_field: "SAP_Id__c", records: [{ "SAP_Id__c": "SAP-001", "Name": "Acme Corp" }, ...] }

  - Bulk delete old records:
    { sobject: "Lead", operation: "delete", records: [{ "Id": "00QXX001" }, { "Id": "00QXX002" }, ...] }

⚠️ hardDelete bypasses the Recycle Bin — permanent, unrecoverable.`,
      inputSchema: BulkIngestSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sobject, operation, records, external_id_field }) => {
      const result = await client.bulkIngest({
        sobject,
        operation,
        records,
        externalIdFieldName: external_id_field,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Bulk Job Status ───────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_bulk_job_status",
    {
      title: "Get Bulk Job Status",
      description: `Get current status of a Bulk 2.0 job (ingest or query).

Args:
  - job_id (string): Bulk job ID from sf_bulk_ingest or sf_bulk_query_create
  - job_type: "ingest" (default) | "query"

Returns: Job state, records processed, records failed, and timing info.

Job states:
  Open → UploadComplete → InProgress → JobComplete | Failed | Aborted

When state = JobComplete:
  - Call sf_get_bulk_job_results for successfulResults and failedResults (ingest)
  - Call sf_get_bulk_query_results for data (query)`,
      inputSchema: BulkJobIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id, job_type }) => {
      const result = await client.getBulkJobStatus(job_id, job_type);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── List Bulk Jobs ────────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_bulk_jobs",
    {
      title: "List Bulk Jobs",
      description: `List all Bulk 2.0 jobs in the org (recent jobs, all states).

Args:
  - job_type: "ingest" (default) | "query"

Returns: All bulk jobs with ID, object, operation, state, record counts, and dates.`,
      inputSchema: ListBulkJobsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_type }) => {
      const result = await client.listBulkJobs(job_type);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Bulk Job Results ──────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_bulk_job_results",
    {
      title: "Get Bulk Ingest Job Results",
      description: `Retrieve success, failure, or unprocessed records from a completed Bulk 2.0 ingest job.

Only available when job state = JobComplete.

Args:
  - job_id (string): Bulk ingest job ID
  - result_type: "successfulResults" | "failedResults" | "unprocessedrecords"
  - max_records (number): Max records to return (default: 1000, max: 50000)

Returns: Array of records with sf__Id, sf__Created (for inserts), or sf__Error (for failures).

Workflow:
  1. sf_bulk_ingest → get jobId
  2. sf_get_bulk_job_status → wait for JobComplete
  3. sf_get_bulk_job_results with result_type: "successfulResults" → IDs of created/updated records
  4. sf_get_bulk_job_results with result_type: "failedResults" → failed records with error messages`,
      inputSchema: BulkJobResultsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id, result_type, max_records }) => {
      const result = await client.getBulkJobResults({
        jobId: job_id,
        resultType: result_type,
        maxRecords: max_records,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Abort Bulk Job ────────────────────────────────────────────────────────
  server.registerTool(
    "sf_abort_bulk_job",
    {
      title: "Abort Bulk Job",
      description: `Abort a running or queued Bulk 2.0 ingest job. Processed records are NOT rolled back.

Args:
  - job_id (string): Bulk ingest job ID to abort
  - job_type: "ingest" (default)

⚠️ Records already processed before abort are committed. Only unprocessed records are skipped.`,
      inputSchema: BulkJobIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ job_id }) => {
      const result = await client.bulkIngestAbort(job_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Bulk Query (fire-and-wait) ────────────────────────────────────────────
  server.registerTool(
    "sf_bulk_query",
    {
      title: "Bulk Query (Millions of Records)",
      description: `Execute a SOQL query via Bulk 2.0 API to retrieve millions of records — no governor limits on result size.

Creates a query job, waits for completion, and returns results directly. For queries that may return
more records than the max_records limit, a nextLocator is returned — use sf_get_bulk_query_results to paginate.

Use this instead of sf_query when:
  - You expect >50,000 records
  - You're doing data migrations, backups, or mass exports
  - You're hitting SOQL row limits with the standard API

Args:
  - soql (string): SOQL query (no LIMIT needed — Bulk handles pagination internally)
  - max_records (number): Max records to return in one call (default: 50000)
  - poll_interval_seconds (number): How often to check status (default: 5s)
  - max_poll_seconds (number): Max wait time (default: 120s)

Returns: { jobId, records, count, done, truncated }
  - done: true = all records returned
  - truncated: true = use sf_get_bulk_query_results with nextLocator for more

Examples:
  - Export all accounts: { soql: "SELECT Id, Name, Industry, AnnualRevenue FROM Account" }
  - Export all contacts with emails: { soql: "SELECT Id, FirstName, LastName, Email, AccountId FROM Contact WHERE Email != null" }
  - Audit log: { soql: "SELECT Id, UserId, Action, EntityType, CreatedDate FROM SetupAuditTrail ORDER BY CreatedDate DESC" }`,
      inputSchema: BulkQuerySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ soql, max_records, poll_interval_seconds, max_poll_seconds }) => {
      const result = await client.bulkQuery({
        soql,
        maxRecords: max_records,
        pollIntervalSeconds: poll_interval_seconds,
        maxPollSeconds: max_poll_seconds,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Bulk Query Results Paginator ──────────────────────────────────────────
  server.registerTool(
    "sf_get_bulk_query_results",
    {
      title: "Get Bulk Query Results (Paginated)",
      description: `Retrieve results from a completed Bulk 2.0 query job, with pagination support for massive result sets.

Use this when sf_bulk_query returns truncated: true (result set larger than max_records).

Args:
  - job_id (string): Bulk query job ID from sf_bulk_query
  - max_records (number): Records per page (default: 50000)
  - locator (string): nextLocator value from previous call for pagination

Returns: { records, count, nextLocator, done }
  - Keep calling with nextLocator until done = true to get all records.

Pagination pattern:
  1. sf_bulk_query → { jobId, records, nextLocator, done: false }
  2. sf_get_bulk_query_results { job_id, locator: nextLocator } → next page
  3. Repeat until done = true`,
      inputSchema: BulkQueryResultsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id, max_records, locator }) => {
      const result = await client.getBulkQueryResults({
        jobId: job_id,
        maxRecords: max_records,
        locator,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Auth Info ────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_auth_info",
    {
      title: "Get Auth Info",
      description: `Get information about the current authentication mode and connected org.

No args required.

Returns: Auth mode (password/jwt), connected org URL, API version, and username.
Useful for verifying which org and auth method the MCP is currently using.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const instanceUrl = client.getInstanceUrl();
      const authMode = client.getAuthMode();
      const result = {
        authMode,
        instanceUrl: instanceUrl || "Not yet authenticated",
        description: authMode === "jwt"
          ? "JWT Bearer Token — passwordless, production-grade server-to-server auth. Token auto-refreshes."
          : "Username + Password OAuth — suitable for development. Enable in Connected App policies.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
