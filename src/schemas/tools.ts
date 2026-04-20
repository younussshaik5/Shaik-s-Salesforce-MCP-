import { z } from "zod";

// ─── Common ───────────────────────────────────────────────────────────────────
export const SObjectNameSchema = z
  .string()
  .min(1)
  .describe("Salesforce SObject API name, e.g. 'Account', 'Opportunity', 'Contact'");

export const RecordIdSchema = z
  .string()
  .min(15)
  .max(18)
  .describe("Salesforce record ID (15 or 18 chars)");

// ─── Query ────────────────────────────────────────────────────────────────────
export const QuerySchema = z.object({
  soql: z
    .string()
    .min(10)
    .describe("SOQL query, e.g. 'SELECT Id, Name FROM Account WHERE Industry = \\'Technology\\' LIMIT 10'"),
  fetch_all: z
    .boolean()
    .default(false)
    .describe("If true, auto-paginates to retrieve all matching records (max 2000)"),
}).strict();

// ─── Search ───────────────────────────────────────────────────────────────────
export const SearchSchema = z.object({
  sosl: z
    .string()
    .min(5)
    .describe(
      "SOSL search string, e.g. 'FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name)'"
    ),
}).strict();

// ─── Get Record ───────────────────────────────────────────────────────────────
export const GetRecordSchema = z.object({
  sobject: SObjectNameSchema,
  id: RecordIdSchema,
  fields: z
    .array(z.string())
    .optional()
    .describe("Specific fields to retrieve. Leave empty to get all fields."),
}).strict();

// ─── Create Record ────────────────────────────────────────────────────────────
export const CreateRecordSchema = z.object({
  sobject: SObjectNameSchema,
  data: z
    .record(z.unknown())
    .describe("Field values as a JSON object, e.g. {\"Name\": \"Acme Corp\", \"Industry\": \"Technology\"}"),
}).strict();

// ─── Update Record ────────────────────────────────────────────────────────────
export const UpdateRecordSchema = z.object({
  sobject: SObjectNameSchema,
  id: RecordIdSchema,
  data: z
    .record(z.unknown())
    .describe("Fields to update as a JSON object, e.g. {\"StageName\": \"Closed Won\", \"Amount\": 50000}"),
}).strict();

// ─── Delete Record ────────────────────────────────────────────────────────────
export const DeleteRecordSchema = z.object({
  sobject: SObjectNameSchema,
  id: RecordIdSchema,
}).strict();

// ─── Upsert ───────────────────────────────────────────────────────────────────
export const UpsertRecordSchema = z.object({
  sobject: SObjectNameSchema,
  external_id_field: z.string().describe("API name of the external ID field, e.g. 'External_Id__c'"),
  external_id: z.string().describe("Value of the external ID"),
  data: z.record(z.unknown()).describe("Field values to set"),
}).strict();

// ─── Describe ─────────────────────────────────────────────────────────────────
export const DescribeSchema = z.object({
  sobject: SObjectNameSchema,
  include_fields: z
    .boolean()
    .default(true)
    .describe("Include field metadata in the response"),
}).strict();

export const ListObjectsSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe("Filter objects by name prefix, e.g. 'Account' or 'Custom__c'"),
  queryable_only: z
    .boolean()
    .default(false)
    .describe("If true, return only queryable objects"),
}).strict();

// ─── Apex ─────────────────────────────────────────────────────────────────────
export const ExecuteApexSchema = z.object({
  apex_code: z
    .string()
    .min(5)
    .describe(
      "Anonymous Apex code to execute, e.g. 'System.debug(UserInfo.getName());'"
    ),
}).strict();

// ─── Flows ────────────────────────────────────────────────────────────────────
export const InvokeFlowSchema = z.object({
  flow_api_name: z
    .string()
    .min(1)
    .describe("API name of the Flow to invoke, e.g. 'Create_Opportunity_Flow'"),
  inputs: z
    .record(z.unknown())
    .default({})
    .describe("Flow input variables as a JSON object"),
}).strict();

// ─── Bulk Create ──────────────────────────────────────────────────────────────
export const BulkCreateSchema = z.object({
  sobject: SObjectNameSchema,
  records: z
    .array(z.record(z.unknown()))
    .min(1)
    .max(200)
    .describe("Array of records to create, each as a field-value JSON object"),
}).strict();

// ─── Reports ──────────────────────────────────────────────────────────────────
export const RunReportSchema = z.object({
  report_id: z
    .string()
    .min(15)
    .describe("Salesforce Report ID (15 or 18 chars)"),
}).strict();

export const RunReportFilteredSchema = z.object({
  report_id: z.string().min(15).describe("Salesforce Report ID"),
  filters: z.array(z.object({
    column: z.string().describe("API name of the report column to filter on"),
    operator: z.string().describe("Filter operator: equals, notEqual, lessThan, greaterThan, lessOrEqual, greaterOrEqual, contains, notContain, startsWith, includes, excludes"),
    value: z.string().describe("Filter value"),
  })).describe("Runtime filter overrides"),
}).strict();

// ─── Dashboards ───────────────────────────────────────────────────────────────
export const DashboardIdSchema = z.object({
  dashboard_id: z.string().min(15).describe("Salesforce Dashboard ID"),
}).strict();

// ─── Custom Metadata ──────────────────────────────────────────────────────────
export const CustomMetadataQuerySchema = z.object({
  mdt_api_name: z.string().describe("API name of the Custom Metadata Type, e.g. 'Tax_Rate__mdt'"),
  fields: z.array(z.string()).optional().describe("Fields to retrieve. Leave empty for defaults (Id, DeveloperName, Label, MasterLabel)"),
}).strict();

// ─── Custom Settings ──────────────────────────────────────────────────────────
export const CustomSettingSchema = z.object({
  setting_api_name: z.string().describe("API name of the Custom Setting object, e.g. 'App_Config__c'"),
}).strict();

// ─── Platform Events ──────────────────────────────────────────────────────────
export const PlatformEventSchema = z.object({
  event_api_name: z.string().describe("API name of the Platform Event, e.g. 'Order_Created__e'"),
  payload: z.record(z.unknown()).describe("Event field values as a JSON object"),
}).strict();

// ─── Tooling API ──────────────────────────────────────────────────────────────
export const ToolingQuerySchema = z.object({
  soql: z.string().min(10).describe("Tooling API SOQL query — for metadata objects like ApexClass, ValidationRule, WorkflowRule, ProcessDefinition, etc."),
}).strict();

export const SObjectFilterSchema = z.object({
  sobject: z.string().optional().describe("Filter by SObject API name, e.g. 'Account'"),
}).strict();

export const ApexClassFilterSchema = z.object({
  filter: z.string().optional().describe("Filter by class name substring"),
}).strict();

// ─── Approvals ────────────────────────────────────────────────────────────────
export const SubmitApprovalSchema = z.object({
  record_id: RecordIdSchema,
  comments: z.string().optional().describe("Submission comments"),
  next_approver_id: z.string().optional().describe("Optional: ID of the next approver to assign"),
}).strict();

export const ApproveRejectSchema = z.object({
  work_item_id: RecordIdSchema,
  action: z.enum(["Approve", "Reject"]).describe("Whether to approve or reject the work item"),
  comments: z.string().optional().describe("Approval/rejection comments"),
}).strict();

// ─── Users ────────────────────────────────────────────────────────────────────
export const ListUsersSchema = z.object({
  active_only: z.boolean().default(true).describe("Return only active users (default: true)"),
}).strict();

export const UserIdSchema = z.object({
  user_id: RecordIdSchema,
}).strict();

export const PermSetIdSchema = z.object({
  permission_set_id: RecordIdSchema,
}).strict();

// ─── Scheduled / Async Jobs ───────────────────────────────────────────────────
export const AsyncJobStatusSchema = z.object({
  status: z.enum(["Queued", "Holding", "Preparing", "Processing", "Aborted", "Completed", "Failed"]).optional()
    .describe("Filter by job status"),
}).strict();

// ─── Chatter ─────────────────────────────────────────────────────────────────
export const ChatterFeedSchema = z.object({
  record_id: RecordIdSchema,
}).strict();

export const PostChatterSchema = z.object({
  record_id: RecordIdSchema,
  message: z.string().min(1).max(10000).describe("Chatter message text to post on the record"),
}).strict();

// ─── Files ────────────────────────────────────────────────────────────────────
export const RecordFilesSchema = z.object({
  record_id: RecordIdSchema,
}).strict();


// ─── Apex Tests ───────────────────────────────────────────────────────────────
export const RunApexTestsSchema = z.object({
  class_names: z.array(z.string()).optional().describe("Apex class names to test, e.g. ['AccountTriggerTest', 'OpportunityServiceTest']"),
  suite_names: z.array(z.string()).optional().describe("Apex test suite names to run"),
  test_level: z.enum(["RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"]).default("RunSpecifiedTests")
    .describe("Test scope: RunSpecifiedTests | RunLocalTests | RunAllTestsInOrg"),
}).strict();

export const TestRunIdSchema = z.object({
  test_run_id: z.string().describe("Async test run ID returned by sf_run_apex_tests"),
}).strict();

// ─── Metadata Deploy ──────────────────────────────────────────────────────────
export const DeployMetadataSchema = z.object({
  zip_base64: z.string().describe("Base64-encoded ZIP file containing Salesforce metadata in MDAPI format"),
  check_only: z.boolean().default(false).describe("Validate-only deploy without committing changes"),
  test_level: z.enum(["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"])
    .default("NoTestRun").describe("Test level for deploy"),
  run_tests: z.array(z.string()).optional().describe("Specific test classes to run if test_level is RunSpecifiedTests"),
  ignore_warnings: z.boolean().default(false).describe("Continue deploy even if there are warnings"),
  rollback_on_error: z.boolean().default(true).describe("Rollback entire deploy if any component fails"),
}).strict();

export const DeployIdSchema = z.object({
  deploy_id: z.string().describe("Deploy request ID returned by sf_deploy_metadata"),
}).strict();

// ─── Metadata Retrieve ────────────────────────────────────────────────────────
export const RetrieveMetadataSchema = z.object({
  specific_types: z.array(z.object({
    name: z.string().describe("Metadata type, e.g. 'ApexClass', 'Flow', 'CustomObject', 'Layout'"),
    members: z.array(z.string()).describe("Component names, use '*' for all, e.g. ['AccountTrigger', 'OpportunityService']"),
  })).optional().describe("Specific metadata types and components to retrieve"),
  package_names: z.array(z.string()).optional().describe("Installed package names to retrieve"),
  api_version: z.string().optional().describe("API version override, e.g. '60.0'"),
}).strict();

export const RetrieveIdSchema = z.object({
  retrieve_id: z.string().describe("Retrieve request ID returned by sf_retrieve_metadata"),
}).strict();

// ─── Permission Set Assign ────────────────────────────────────────────────────
export const AssignPermSetSchema = z.object({
  user_id: RecordIdSchema,
  permission_set_name: z.string().describe("API name of the Permission Set, e.g. 'Sales_Manager_Permissions'"),
}).strict();

// ─── Async Resume ─────────────────────────────────────────────────────────────
export const ResumeOperationSchema = z.object({
  operation_type: z.enum(["apexTest", "deploy", "retrieve", "apexJob"])
    .describe("Type of async operation to check"),
  operation_id: z.string().describe("Operation ID returned by the initiating tool"),
  max_poll_seconds: z.number().int().min(5).max(300).default(60)
    .describe("Max seconds to wait for completion (default: 60)"),
  poll_interval_seconds: z.number().int().min(2).max(30).default(5)
    .describe("How often to poll in seconds (default: 5)"),
}).strict();

// ─── Agent Tests ──────────────────────────────────────────────────────────────
export const RunAgentTestSchema = z.object({
  agent_test_suite_id: z.string().describe("AiEvaluationDefinition or BotVersion ID for the agent test suite"),
  bot_id: z.string().optional().describe("Optional Bot/Agent ID to target specifically"),
}).strict();

export const AgentTestRunIdSchema = z.object({
  run_id: z.string().describe("Agent test run ID returned by sf_run_agent_test"),
}).strict();

// ─── Code Analysis ────────────────────────────────────────────────────────────
export const CodeAnalysisSchema = z.object({
  class_names: z.array(z.string()).optional().describe("Apex class names to analyze"),
  trigger_names: z.array(z.string()).optional().describe("Apex trigger names to analyze"),
  rules: z.array(z.string()).optional().describe("Specific rules to apply (default: all)"),
}).strict();

export const AntipatternScanSchema = z.object({
  class_names: z.array(z.string()).min(1).max(20)
    .describe("Apex class names to scan for antipatterns, e.g. ['AccountService', 'LeadTrigger']"),
}).strict();

// ─── Scratch Orgs ─────────────────────────────────────────────────────────────
export const CreateScratchOrgSchema = z.object({
  alias: z.string().describe("Alias for the new scratch org, e.g. 'dev-sprint-42'"),
  edition: z.enum(["developer", "enterprise", "group", "professional", "partner-developer"])
    .default("developer").describe("Scratch org edition (default: developer)"),
  duration_days: z.number().int().min(1).max(30).default(7).describe("Scratch org lifetime in days (1-30, default: 7)"),
  dev_hub_alias: z.string().optional().describe("Dev Hub org alias (uses default if not specified)"),
  definition_file: z.string().optional().describe("Path to scratch org definition JSON file"),
  no_namespace: z.boolean().default(false).describe("Create org without namespace"),
}).strict();

export const OrgAliasSchema = z.object({
  alias_or_username: z.string().optional().describe("Org alias or username (uses default org if not specified)"),
}).strict();

// ─── Bulk 2.0 ─────────────────────────────────────────────────────────────────
export const BulkIngestSchema = z.object({
  sobject: SObjectNameSchema,
  operation: z.enum(["insert", "update", "upsert", "delete", "hardDelete"])
    .describe("Bulk operation type"),
  records: z.array(z.record(z.unknown())).min(1)
    .describe("Records as JSON array. For delete/hardDelete only Id is needed."),
  external_id_field: z.string().optional()
    .describe("Required for upsert: external ID field API name, e.g. 'External_Id__c'"),
}).strict();

export const BulkJobIdSchema = z.object({
  job_id: z.string().describe("Bulk job ID returned by sf_bulk_ingest or sf_bulk_query"),
  job_type: z.enum(["ingest", "query"]).default("ingest").describe("Job type (default: ingest)"),
}).strict();

export const BulkJobResultsSchema = z.object({
  job_id: z.string().describe("Bulk ingest job ID"),
  result_type: z.enum(["successfulResults", "failedResults", "unprocessedrecords"])
    .describe("Which result set to retrieve"),
  max_records: z.number().int().min(1).max(50000).default(1000)
    .describe("Max records to return (default: 1000)"),
}).strict();

export const BulkQuerySchema = z.object({
  soql: z.string().min(10).describe("SOQL query to execute at bulk scale (millions of records)"),
  max_records: z.number().int().min(1).max(1000000).default(50000)
    .describe("Max records to return (default: 50000)"),
  poll_interval_seconds: z.number().int().min(2).max(60).default(5)
    .describe("Polling frequency in seconds (default: 5)"),
  max_poll_seconds: z.number().int().min(10).max(600).default(120)
    .describe("Max wait time for query completion (default: 120s)"),
}).strict();

export const BulkQueryResultsSchema = z.object({
  job_id: z.string().describe("Bulk query job ID"),
  max_records: z.number().int().min(1).max(1000000).default(50000).describe("Max records to return"),
  locator: z.string().optional().describe("Pagination locator from previous call"),
}).strict();

export const ListBulkJobsSchema = z.object({
  job_type: z.enum(["ingest", "query"]).default("ingest").describe("Job type to list"),
}).strict();
