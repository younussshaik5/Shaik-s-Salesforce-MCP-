import { toolHandler, ok } from "../utils/errors.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  CustomMetadataQuerySchema,
  CustomSettingSchema,
  PlatformEventSchema,
  ToolingQuerySchema,
  SObjectFilterSchema,
  ApexClassFilterSchema,
} from "../schemas/tools.js";

export function registerMetadataTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── List Custom Metadata Types ────────────────────────────────────────────
  server.registerTool(
    "sf_list_custom_metadata_types",
    {
      title: "List Custom Metadata Types",
      description: `Discover all Custom Metadata Types (__mdt) in the org.

No args required.

Returns: Array of Custom Metadata Type API names and labels.

Use this first to find the API name, then call sf_query_custom_metadata to read records.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const types = await client.listCustomMetadataTypes();
      const result = { count: types.length, types };
      return ok(result);
    }
  );

  // ─── Query Custom Metadata ─────────────────────────────────────────────────
  server.registerTool(
    "sf_query_custom_metadata",
    {
      title: "Query Custom Metadata Type Records",
      description: `Read all records from a Custom Metadata Type (__mdt).

Args:
  - mdt_api_name (string): Full API name of the Custom Metadata Type, e.g. 'Tax_Rate__mdt', 'Feature_Flag__mdt'
  - fields (string[]): Optional list of fields to retrieve. Defaults to Id, DeveloperName, Label, MasterLabel.

Returns: All records from the Custom Metadata Type.

Examples:
  - { mdt_api_name: "Feature_Flag__mdt" } → All feature flags
  - { mdt_api_name: "Tax_Rate__mdt", fields: ["DeveloperName", "Rate__c", "Country__c"] }
  - { mdt_api_name: "Approval_Threshold__mdt", fields: ["DeveloperName", "Amount__c", "Currency__c"] }`,
      inputSchema: CustomMetadataQuerySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ mdt_api_name, fields }) => {
      const result = await client.queryCustomMetadata(mdt_api_name, fields);
      return ok(result);
    }
  );

  // ─── List Custom Settings ──────────────────────────────────────────────────
  server.registerTool(
    "sf_list_custom_settings",
    {
      title: "List Custom Settings",
      description: `Discover all Custom Settings objects in the org (Hierarchy and List type).

No args required.

Returns: Array of Custom Setting API names and labels.

Use this to find setting API names, then call sf_get_custom_setting to read values.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const settings = await client.listCustomSettings();
      const result = { count: settings.length, settings };
      return ok(result);
    }
  );

  // ─── Get Custom Setting Values ─────────────────────────────────────────────
  server.registerTool(
    "sf_get_custom_setting",
    {
      title: "Get Custom Setting Values",
      description: `Read all records and field values from a Custom Setting.

Args:
  - setting_api_name (string): API name of the Custom Setting, e.g. 'App_Config__c', 'Integration_Settings__c'

Returns: Setting schema + all record values.

Examples:
  - { setting_api_name: "App_Config__c" }
  - { setting_api_name: "Integration_Settings__c" }`,
      inputSchema: CustomSettingSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ setting_api_name }) => {
      const result = await client.getCustomSetting(setting_api_name);
      return ok(result);
    }
  );

  // ─── List Platform Events ──────────────────────────────────────────────────
  server.registerTool(
    "sf_list_platform_events",
    {
      title: "List Platform Events",
      description: `Discover all Platform Event definitions (__e) in the org.

No args required.

Returns: All Platform Event API names and labels.

Use this to find event API names, then call sf_publish_platform_event to fire one.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const events = await client.listPlatformEvents();
      const result = { count: events.length, events };
      return ok(result);
    }
  );

  // ─── Publish Platform Event ────────────────────────────────────────────────
  server.registerTool(
    "sf_publish_platform_event",
    {
      title: "Publish Platform Event",
      description: `Publish (fire) a Platform Event to trigger subscribed Flows, Apex triggers, or external subscribers.

Args:
  - event_api_name (string): API name of the Platform Event, e.g. 'Order_Created__e'
  - payload (object): Event field values as JSON

Returns: Published event ID and success status.

Examples:
  - { event_api_name: "Order_Created__e", payload: { "Order_Id__c": "ORD-001", "Amount__c": 5000 } }
  - { event_api_name: "Escalation_Triggered__e", payload: { "Case_Id__c": "5001a00000XYZ", "Priority__c": "High" } }`,
      inputSchema: PlatformEventSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ event_api_name, payload }) => {
      const result = await client.publishPlatformEvent(event_api_name, payload);
      return ok(result);
    }
  );

  // ─── Tooling API Raw Query ─────────────────────────────────────────────────
  server.registerTool(
    "sf_tooling_query",
    {
      title: "Tooling API Query",
      description: `Execute a SOQL query against the Salesforce Tooling API to retrieve metadata objects.

Use for metadata not accessible via standard SOQL: ApexClass, ValidationRule, WorkflowRule, ProcessDefinition, FieldDefinition, EntityDefinition, etc.

Args:
  - soql (string): Tooling API SOQL query

Returns: Metadata records matching the query.

Examples:
  - "SELECT Id, Name, Status FROM ApexClass ORDER BY Name"
  - "SELECT Id, Active, ErrorConditionFormula, ErrorMessage FROM ValidationRule WHERE Active = true"
  - "SELECT Id, Name, TableEnumOrId, Status FROM ApexTrigger"
  - "SELECT Id, DeveloperName, TableEnumOrId, Active FROM WorkflowRule"
  - "SELECT QualifiedApiName, Label, DataType FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Account'"`,
      inputSchema: ToolingQuerySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ soql }) => {
      const result = await client.toolingQuery(soql);
      return ok(result);
    }
  );

  // ─── List Validation Rules ─────────────────────────────────────────────────
  server.registerTool(
    "sf_list_validation_rules",
    {
      title: "List Validation Rules",
      description: `List all active Validation Rules in the org, optionally filtered by SObject.

Args:
  - sobject (string, optional): Filter by SObject API name, e.g. 'Opportunity'

Returns: Validation rules with formula, error message, and target object.

Examples:
  - {} → all active validation rules
  - { sobject: "Opportunity" } → only Opportunity validation rules`,
      inputSchema: SObjectFilterSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject }) => {
      const rules = await client.listValidationRules(sobject);
      const result = { count: rules.length, validationRules: rules };
      return ok(result);
    }
  );

  // ─── List Workflow Rules ───────────────────────────────────────────────────
  server.registerTool(
    "sf_list_workflow_rules",
    {
      title: "List Workflow Rules",
      description: `List all active Workflow Rules (legacy automation) in the org.

Args:
  - sobject (string, optional): Filter by SObject API name, e.g. 'Lead'

Returns: Workflow rules with trigger type, object, and description.

Note: These are legacy automations. Newer orgs may use Flows instead.`,
      inputSchema: SObjectFilterSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject }) => {
      const rules = await client.listWorkflowRules(sobject);
      const result = { count: rules.length, workflowRules: rules };
      return ok(result);
    }
  );

  // ─── List Apex Classes ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_apex_classes",
    {
      title: "List Apex Classes",
      description: `List all Apex classes in the org via Tooling API.

Args:
  - filter (string, optional): Filter by class name substring

Returns: Apex classes with ID, name, status, validity, size, and last modified date.

Examples:
  - {} → all Apex classes
  - { filter: "Trigger" } → classes with "Trigger" in the name
  - { filter: "BatchJob" } → batch job classes`,
      inputSchema: ApexClassFilterSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ filter }) => {
      const classes = await client.listApexClasses(filter);
      const result = { count: classes.length, apexClasses: classes };
      return ok(result);
    }
  );

  // ─── List Apex Triggers ────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_apex_triggers",
    {
      title: "List Apex Triggers",
      description: `List all Apex Triggers in the org via Tooling API, optionally filtered by SObject.

Args:
  - sobject (string, optional): Filter by SObject, e.g. 'Account'

Returns: Triggers with name, target object, status, and event context (before/after insert/update/delete).`,
      inputSchema: SObjectFilterSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject }) => {
      const triggers = await client.listApexTriggers(sobject);
      const result = { count: triggers.length, apexTriggers: triggers };
      return ok(result);
    }
  );
}
