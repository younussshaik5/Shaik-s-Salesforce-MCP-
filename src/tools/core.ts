import { toolHandler, ok } from "../utils/errors.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  QuerySchema,
  SearchSchema,
  GetRecordSchema,
  CreateRecordSchema,
  UpdateRecordSchema,
  DeleteRecordSchema,
  UpsertRecordSchema,
  DescribeSchema,
  ListObjectsSchema,
  BulkCreateSchema,
} from "../schemas/tools.js";

export function registerCoreTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── SOQL Query ────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_query",
    {
      title: "SOQL Query",
      description: `Execute a SOQL (Salesforce Object Query Language) query and return matching records.

Use this to retrieve data from any Salesforce object. SOQL is similar to SQL but specific to Salesforce.

Args:
  - soql (string): Full SOQL query string
  - fetch_all (boolean): Auto-paginate to get all results up to 2000 records (default: false)

Returns JSON with:
  {
    "totalSize": number,     // Total matching records
    "done": boolean,         // Whether all records retrieved
    "records": [ {...} ]     // Array of records with requested fields
  }

Examples:
  - "SELECT Id, Name, Industry, AnnualRevenue FROM Account WHERE Industry = 'Technology' LIMIT 20"
  - "SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE StageName = 'Prospecting'"
  - "SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = '0011a00000ABC'"

Tips:
  - Always include Id in SELECT
  - Use single quotes for string values in WHERE clause
  - Date literals: TODAY, LAST_N_DAYS:30, THIS_MONTH, THIS_QUARTER`,
      inputSchema: QuerySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ soql, fetch_all }) => {
      const result = fetch_all
        ? await client.queryAll(soql)
        : await client.query(soql);
      return ok(result);
    }
  );

  // ─── SOSL Search ───────────────────────────────────────────────────────────
  server.registerTool(
    "sf_search",
    {
      title: "SOSL Search",
      description: `Execute a SOSL (Salesforce Object Search Language) full-text search across multiple objects.

Use when you don't know which object a record lives in, or for cross-object keyword search.

Args:
  - sosl (string): Full SOSL search string

Returns: Search results grouped by SObject type.

Examples:
  - "FIND {Acme*} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, FirstName, LastName, Email)"
  - "FIND {john@company.com} IN EMAIL FIELDS RETURNING Contact(Id, Name, Email)"
  - "FIND {Q4 Deal} IN NAME FIELDS RETURNING Opportunity(Id, Name, StageName, Amount)"`,
      inputSchema: SearchSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sosl }) => {
      const result = await client.search(sosl);
      return ok(result);
    }
  );

  // ─── Get Single Record ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_get_record",
    {
      title: "Get Record",
      description: `Retrieve a single Salesforce record by its ID.

Args:
  - sobject (string): API name of the SObject (e.g. 'Account', 'Opportunity')
  - id (string): Salesforce record ID (15 or 18 characters)
  - fields (string[]): Optional list of specific fields to retrieve

Returns: Record as a JSON object with all requested fields.

Examples:
  - Get an account: { sobject: "Account", id: "0011a00000XYZ" }
  - Get specific fields: { sobject: "Opportunity", id: "0061a00000ABC", fields: ["Name", "StageName", "Amount"] }`,
      inputSchema: GetRecordSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject, id, fields }) => {
      const record = await client.getRecord(sobject, id, fields);
      return ok(record);
    }
  );

  // ─── Create Record ─────────────────────────────────────────────────────────
  server.registerTool(
    "sf_create_record",
    {
      title: "Create Record",
      description: `Create a new Salesforce record.

Args:
  - sobject (string): API name of the SObject
  - data (object): Field values for the new record

Returns: { "id": "new_record_id", "success": true, "errors": [] }

Examples:
  - Create Account: { sobject: "Account", data: { "Name": "Acme Corp", "Industry": "Technology", "AnnualRevenue": 5000000 } }
  - Create Contact: { sobject: "Contact", data: { "FirstName": "Jane", "LastName": "Doe", "Email": "jane@acme.com", "AccountId": "0011a00000XYZ" } }
  - Create Opportunity: { sobject: "Opportunity", data: { "Name": "Q3 Enterprise Deal", "StageName": "Prospecting", "CloseDate": "2025-09-30", "AccountId": "0011a00000XYZ", "Amount": 150000 } }

Tip: Use sf_describe_object first to know which fields are required.`,
      inputSchema: CreateRecordSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sobject, data }) => {
      const result = await client.createRecord(sobject, data);
      return ok(result);
    }
  );

  // ─── Update Record ─────────────────────────────────────────────────────────
  server.registerTool(
    "sf_update_record",
    {
      title: "Update Record",
      description: `Update fields on an existing Salesforce record.

Only include fields you want to change — other fields remain untouched.

Args:
  - sobject (string): API name of the SObject
  - id (string): Salesforce record ID to update
  - data (object): Fields to update with new values

Returns: Confirmation message on success.

Examples:
  - Move opp to next stage: { sobject: "Opportunity", id: "0061a00000ABC", data: { "StageName": "Proposal/Price Quote", "Amount": 175000 } }
  - Update account: { sobject: "Account", id: "0011a00000XYZ", data: { "Phone": "+1-555-0100", "Website": "https://acme.com" } }
  - Close a case: { sobject: "Case", id: "5001a00000DEF", data: { "Status": "Closed", "Resolution__c": "Issue resolved by upgrade" } }`,
      inputSchema: UpdateRecordSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject, id, data }) => {
      await client.updateRecord(sobject, id, data);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, id, sobject }, null, 2) }],
        structuredContent: { success: true, id, sobject },
      };
    }
  );

  // ─── Delete Record ─────────────────────────────────────────────────────────
  server.registerTool(
    "sf_delete_record",
    {
      title: "Delete Record",
      description: `Permanently delete a Salesforce record. This action cannot be undone (record moves to Recycle Bin).

Args:
  - sobject (string): API name of the SObject
  - id (string): Salesforce record ID to delete

Returns: Confirmation message on success.

⚠️ WARNING: Destructive operation. Verify ID before deleting. Always confirm intent before calling this tool.`,
      inputSchema: DeleteRecordSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ sobject, id }) => {
      await client.deleteRecord(sobject, id);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, deleted: id, sobject }, null, 2) }],
        structuredContent: { success: true, deleted: id, sobject },
      };
    }
  );

  // ─── Upsert ────────────────────────────────────────────────────────────────
  server.registerTool(
    "sf_upsert_record",
    {
      title: "Upsert Record",
      description: `Create or update a record based on an external ID field. If a record with that external ID exists, it updates it; otherwise creates a new one.

Args:
  - sobject (string): API name of the SObject
  - external_id_field (string): API name of the external ID field (must be marked as External ID in Salesforce)
  - external_id (string): Value of the external ID
  - data (object): Field values

Returns: Result of the upsert operation.

Example:
  { sobject: "Contact", external_id_field: "SAP_Contact_Id__c", external_id: "SAP-12345", data: { "FirstName": "John", "LastName": "Smith", "Email": "john@acme.com" } }`,
      inputSchema: UpsertRecordSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject, external_id_field, external_id, data }) => {
      const result = await client.upsertRecord(sobject, external_id_field, external_id, data);
      return ok(result);
    }
  );

  // ─── Bulk Create ───────────────────────────────────────────────────────────
  server.registerTool(
    "sf_bulk_create",
    {
      title: "Bulk Create Records",
      description: `Create multiple Salesforce records in a single operation (up to 200 at once).

Args:
  - sobject (string): API name of the SObject
  - records (array): Array of field-value objects to create

Returns: Array of results with success/failure for each record.

Example:
  { sobject: "Lead", records: [
    { "FirstName": "Alice", "LastName": "Smith", "Company": "Acme", "Email": "alice@acme.com" },
    { "FirstName": "Bob", "LastName": "Jones", "Company": "Globex", "Email": "bob@globex.com" }
  ]}`,
      inputSchema: BulkCreateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sobject, records }) => {
      const result = await client.bulkCreateRecords(sobject, records);
      return ok(result);
    }
  );

  // ─── Describe Object ───────────────────────────────────────────────────────
  server.registerTool(
    "sf_describe_object",
    {
      title: "Describe SObject",
      description: `Get full metadata for a Salesforce object — fields, types, relationships, picklist values, and CRUD permissions.

Use this before creating/updating records to know required fields, field types, and valid picklist values.

Args:
  - sobject (string): API name of the SObject
  - include_fields (boolean): Include field metadata (default: true)

Returns: Object metadata including all fields with types, labels, constraints, and relationships.

Examples:
  - { sobject: "Opportunity" }  → Get Opportunity schema
  - { sobject: "Account", include_fields: false }  → Get Account info without field list`,
      inputSchema: DescribeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sobject, include_fields }) => {
      const describe = await client.describeSObject(sobject);
      const result = include_fields
        ? describe
        : { ...describe, fields: undefined };
      return ok(result);
    }
  );

  // ─── List Objects ──────────────────────────────────────────────────────────
  server.registerTool(
    "sf_list_objects",
    {
      title: "List SObjects",
      description: `List all Salesforce objects (standard and custom) available in the org.

Args:
  - filter (string): Optional prefix filter, e.g. 'Custom' to see custom objects
  - queryable_only (boolean): Return only queryable objects (default: false)

Returns: Array of objects with name, label, and key prefix.

Examples:
  - {} → list all objects
  - { filter: "Custom", queryable_only: true } → queryable custom objects only`,
      inputSchema: ListObjectsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ filter, queryable_only }) => {
      let objects = await client.listSObjects();
      if (queryable_only) objects = objects.filter((o) => o.queryable);
      if (filter) {
        const f = filter.toLowerCase();
        objects = objects.filter(
          (o) =>
            o.name.toLowerCase().includes(f) ||
            o.label.toLowerCase().includes(f)
        );
      }
      const result = { count: objects.length, objects };
      return ok(result);
    }
  );
}
