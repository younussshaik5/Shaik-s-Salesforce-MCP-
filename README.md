# Salesforce MCP Server

**Connect any LLM to your Salesforce org. 75 tools. Zero browser needed.**

Works with Claude Desktop, Cursor, Windsurf, Claude Code — any MCP-compatible client.

---

## One-click install for Claude Desktop

Download [`salesforce-mcp.dxt`](./salesforce-mcp.dxt) → double-click → fill in your Salesforce credentials → done.

No terminal. No npm. No JSON editing. Claude Desktop handles everything.

---

## What it does

| Module | Tools | What you can ask |
|--------|-------|-----------------|
| **Core** | 10 | "Show me all open opps over $100k this quarter" |
| **Advanced** | 7 | "Run the Q4 Pipeline report" · "Invoke the Renewal Flow" |
| **Metadata** | 11 | "List all Custom Metadata Types" · "What validation rules exist on Opportunity?" |
| **Org** | 21 | "Who has pending approvals?" · "Post Chatter on this deal" |
| **Testing** | 8 | "Run Apex tests for AccountService" · "Scan LeadTrigger for antipatterns" |
| **DevOps** | 10 | "Deploy this metadata" · "Assign permission set to user" |
| **Bulk 2.0** | 8 | "Update 50,000 Lead records" · "Export all Contacts to CSV" |

**75 tools total.** Works on any org — discovers your custom objects, fields, and flows at runtime.

---

## Auth modes

### Password (development / sandbox)
```bash
SF_AUTH_MODE=password
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=your_consumer_key
SF_CLIENT_SECRET=your_consumer_secret
SF_USERNAME=user@yourorg.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yourtoken
```

### JWT Bearer Token (production — no password)
```bash
SF_AUTH_MODE=jwt
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=your_consumer_key
SF_USERNAME=user@yourorg.com
SF_PRIVATE_KEY_FILE=./server.key
```

Tokens auto-refresh before expiry. Set it once, forget it.

---

## Manual setup (for developers)

```bash
git clone https://github.com/younussshaik5/Shaik-s-Salesforce-MCP-.git
cd Shaik-s-Salesforce-MCP-
npm install
npm run build
```

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "SF_AUTH_MODE": "password",
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_CLIENT_ID": "your_consumer_key",
        "SF_CLIENT_SECRET": "your_consumer_secret",
        "SF_USERNAME": "user@yourorg.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourtoken"
      }
    }
  }
}
```

### Cursor / Windsurf (`~/.cursor/mcp.json`)
Same JSON structure as above.

### HTTP mode (remote server, multiple clients)
```bash
TRANSPORT=http PORT=3000 SF_AUTH_MODE=jwt ... node dist/index.js
```

---

## Salesforce Connected App setup (one-time)

1. Setup → App Manager → New Connected App
2. Enable OAuth → add scope: **Full access (full)**
3. Set Callback URL: `http://localhost:1717/OauthRedirect`
4. Save → copy Consumer Key + Consumer Secret
5. Setup → OAuth and OpenID Connect Settings → **Allow OAuth Username-Password Flows** → ON

---

## All 75 tools

<details>
<summary>Core — data & CRUD</summary>

- `sf_query` — SOQL with auto-pagination
- `sf_search` — SOSL cross-object full-text search
- `sf_get_record` — fetch any record by ID
- `sf_create_record` — create any SObject
- `sf_update_record` — update fields on any record
- `sf_delete_record` — delete a record
- `sf_upsert_record` — create-or-update via external ID
- `sf_bulk_create` — create up to 200 records
- `sf_describe_object` — full schema + picklist metadata
- `sf_list_objects` — all standard + custom objects
</details>

<details>
<summary>Advanced — automation & analytics</summary>

- `sf_execute_apex` — run anonymous Apex
- `sf_list_flows` — all active Flows
- `sf_invoke_flow` — trigger any autolaunched Flow
- `sf_list_reports` — all org reports
- `sf_run_report` — execute a report
- `sf_get_org_limits` — API limits and storage usage
- `sf_get_current_user` — current authenticated user
</details>

<details>
<summary>Metadata — org configuration</summary>

- `sf_list_custom_metadata_types` — discover all `__mdt` types
- `sf_query_custom_metadata` — read any `__mdt` records
- `sf_list_custom_settings` — discover Custom Settings
- `sf_get_custom_setting` — read Custom Setting values
- `sf_list_platform_events` — all `__e` event types
- `sf_publish_platform_event` — fire a Platform Event
- `sf_tooling_query` — raw Tooling API SOQL
- `sf_list_validation_rules` — active Validation Rules
- `sf_list_workflow_rules` — active Workflow Rules
- `sf_list_apex_classes` — Apex classes via Tooling API
- `sf_list_apex_triggers` — Apex triggers via Tooling API
</details>

<details>
<summary>Org — dashboards, approvals, users, chatter</summary>

- `sf_list_dashboards` — all dashboards
- `sf_get_dashboard` — dashboard metadata
- `sf_get_dashboard_results` — live dashboard data
- `sf_refresh_dashboard` — trigger refresh
- `sf_get_report_metadata` — report columns and filters
- `sf_run_report_filtered` — report with runtime filters
- `sf_list_approval_processes` — all approval processes
- `sf_submit_for_approval` — submit into approval process
- `sf_approve_reject` — approve or reject work item
- `sf_get_pending_approvals` — all pending work items
- `sf_list_users` — org users with profile + role
- `sf_get_user` — full user detail
- `sf_list_permission_sets` — all permission sets
- `sf_list_profiles` — all profiles
- `sf_get_permission_set_assignments` — who has a permission set
- `sf_list_scheduled_jobs` — scheduled Apex cron jobs
- `sf_list_async_apex_jobs` — batch/queueable job status
- `sf_get_record_feed` — Chatter feed on any record
- `sf_post_chatter` — post Chatter message
- `sf_list_record_files` — files on a record
- `sf_list_attachments` — classic attachments
</details>

<details>
<summary>Testing — quality & analysis</summary>

- `sf_run_apex_tests` — async Apex test runner
- `sf_get_apex_test_results` — test results + coverage
- `sf_resume_operation` — poll any async operation
- `sf_run_agent_test` — Agentforce agent test
- `sf_list_agent_test_suites` — all agent test suites
- `sf_get_agent_test_results` — agent test outcomes
- `sf_run_code_analysis` — compile + symbol analysis
- `sf_scan_apex_antipatterns` — detect SOQL/DML in loops, empty catch, hardcoded IDs
</details>

<details>
<summary>DevOps — deploy, retrieve, permissions</summary>

- `sf_deploy_metadata` — deploy metadata ZIP to org
- `sf_get_deploy_status` — deploy progress + errors
- `sf_retrieve_metadata` — pull metadata from org
- `sf_get_retrieve_status` — retrieve status + base64 ZIP
- `sf_assign_permission_set` — assign perm set to user
- `sf_revoke_permission_set` — remove perm set from user
- `sf_list_all_orgs` — all CLI-authorized orgs
- `sf_create_scratch_org` — create scratch org via CLI
- `sf_delete_scratch_org` — delete scratch org
- `sf_open_org` — get browser login URL
</details>

<details>
<summary>Bulk 2.0 — millions of records</summary>

- `sf_bulk_ingest` — insert/update/upsert/delete at scale
- `sf_get_bulk_job_status` — job state + record counts
- `sf_list_bulk_jobs` — all bulk jobs in org
- `sf_get_bulk_job_results` — success/failure/unprocessed records
- `sf_abort_bulk_job` — kill a running job
- `sf_bulk_query` — SOQL at millions of records
- `sf_get_bulk_query_results` — paginated query results
- `sf_get_auth_info` — current auth mode + org
</details>

---

## Architecture

```
LLM Client (Claude Desktop / Cursor / Windsurf / Claude Code)
        ↓  MCP Protocol (stdio or HTTP)
  salesforce-mcp-server (Node.js 18+)
        ↓  REST API + OAuth 2.0 (password or JWT)
  Salesforce Org
  (any edition — auto-discovers custom objects, fields, flows)
```

---

## Example prompts

```
"Show me all open opportunities over $100k closing this quarter"
"Move Acme Enterprise to Closed Won at $485,000"
"Run the Q4 Pipeline by Region report filtered for APAC"
"Scan AccountTriggerHandler for governor limit violations"
"Deploy this metadata zip to UAT, validate only"
"Submit deal 006XXX for Director approval"
"Post a Chatter note on the Acme opportunity: deal is moving to legal"
"List all active Flows in my org"
"Bulk update 50,000 Lead records — set Status to Active"
"Who has the Sales_Manager_Permissions permission set?"
```

---

## vs. other Salesforce MCPs

| | **This MCP** | salesforcecli/mcp | tsmztech |
|--|--|--|--|
| Tools | **75** | 60+ (dev only) | ~25 |
| JWT auth + auto-refresh | ✅ | ❌ | ❌ |
| Bulk 2.0 | ✅ | ❌ | ❌ |
| Dashboards | ✅ | ❌ | ❌ |
| Approvals | ✅ | ❌ | ❌ |
| Platform Events | ✅ | ❌ | ❌ |
| Custom Metadata | ✅ | ❌ | ❌ |
| No CLI dependency | ✅ | ❌ | Partial |
| HTTP remote mode | ✅ | ❌ | ❌ |
| One-click DXT install | ✅ | ❌ | ❌ |

---

## License

MIT — use it, fork it, ship it.
