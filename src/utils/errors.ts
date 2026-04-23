import axios from "axios";

// ─── Salesforce Error Codes → Human Messages ──────────────────────────────────
const SF_ERROR_HINTS: Record<string, string> = {
  INVALID_LOGIN:
    "Wrong username, password, or security token. Check SF_USERNAME, SF_PASSWORD, and SF_SECURITY_TOKEN.",
  INVALID_SESSION_ID:
    "Session expired. The server will re-authenticate automatically on the next request.",
  REQUEST_LIMIT_EXCEEDED:
    "Salesforce daily API limit reached. Check sf_get_org_limits to see remaining quota.",
  QUERY_TIMEOUT:
    "Query took too long. Add a WHERE clause or LIMIT to reduce the result set.",
  MALFORMED_QUERY:
    "SOQL syntax error. Check field names — they are case-sensitive (e.g. 'AccountId' not 'accountid').",
  INVALID_FIELD:
    "Field does not exist on this object. Call sf_describe_object first to see available fields.",
  INVALID_TYPE:
    "SObject does not exist in this org. Call sf_list_objects to see available objects.",
  FIELD_CUSTOM_VALIDATION_EXCEPTION:
    "A validation rule on this object blocked the operation. Check sf_list_validation_rules for details.",
  REQUIRED_FIELD_MISSING:
    "A required field is missing. Call sf_describe_object to see which fields are required (nillable: false).",
  DUPLICATE_VALUE:
    "A record with this value already exists. Use sf_upsert_record to update existing records.",
  ENTITY_IS_DELETED:
    "This record has been deleted. Check the Recycle Bin in Salesforce.",
  INSUFFICIENT_ACCESS:
    "Your Salesforce user lacks permission for this operation. Check your profile or permission sets.",
  CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY:
    "Cannot modify this record — it may be locked, in an active approval process, or read-only.",
  UNABLE_TO_LOCK_ROW:
    "Record is locked by another process. Wait a moment and retry.",
  API_DISABLED_FOR_ORG:
    "Salesforce API is disabled for this org. API access requires Enterprise edition or above.",
  invalid_client:
    "Connected App Consumer Key is wrong. Check SF_CLIENT_ID.",
  invalid_client_credentials:
    "Connected App Consumer Key or Secret is wrong. Check SF_CLIENT_ID and SF_CLIENT_SECRET.",
  invalid_grant:
    "Username, password, or security token is wrong. Also check: Setup → OAuth → Allow Username-Password Flows is ON.",
  unsupported_grant_type:
    "OAuth grant type not enabled. For password auth: Setup → OAuth and OpenID Connect Settings → Allow OAuth Username-Password Flows → ON.",
};

// ─── Parse Salesforce Error Response ─────────────────────────────────────────
export function parseSFError(err: unknown): { code: string; message: string; hint: string } {
  if (!axios.isAxiosError(err)) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: "UNKNOWN", message: msg, hint: "" };
  }

  const data = err.response?.data;
  const status = err.response?.status ?? 0;

  // Array of SF errors: [{ errorCode, message }]
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as { errorCode?: string; message?: string };
    const code = first.errorCode ?? "SF_ERROR";
    const message = first.message ?? "Unknown Salesforce error";
    const hint = SF_ERROR_HINTS[code] ?? "";
    return { code, message, hint };
  }

  // OAuth error: { error, error_description }
  if (data && typeof data === "object" && "error" in data) {
    const d = data as { error: string; error_description?: string };
    const code = d.error;
    const message = d.error_description ?? code;
    const hint = SF_ERROR_HINTS[code] ?? "";
    return { code, message, hint };
  }

  // HTTP errors without body
  const httpMessages: Record<number, string> = {
    400: "Bad request — malformed input",
    401: "Unauthorised — session expired or invalid credentials",
    403: "Forbidden — insufficient permissions",
    404: "Not found — record ID or endpoint does not exist",
    405: "Method not allowed",
    415: "Unsupported media type",
    429: "Too many requests — API rate limit hit",
    500: "Salesforce internal server error — try again",
    503: "Salesforce service unavailable — try again in a moment",
  };

  return {
    code: `HTTP_${status}`,
    message: httpMessages[status] ?? err.message,
    hint: status === 401 ? SF_ERROR_HINTS["INVALID_SESSION_ID"] : "",
  };
}

// ─── Format Error for MCP Response ────────────────────────────────────────────
export function formatToolError(err: unknown, context: string): string {
  const { code, message, hint } = parseSFError(err);
  const parts = [`Error during ${context}: [${code}] ${message}`];
  if (hint) parts.push(`\nFix: ${hint}`);
  return parts.join("");
}

// ─── Tool Handler Wrapper ─────────────────────────────────────────────────────
// Catches all errors and returns clean MCP error responses instead of throwing.
// Every tool uses this — no raw async functions exposed to MCP.
export function toolHandler<T>(
  context: string,
  fn: (input: T) => Promise<{ content: Array<{ type: string; text: string }>; structuredContent?: unknown }>
) {
  return async (input: T) => {
    try {
      return await fn(input);
    } catch (err) {
      const message = formatToolError(err, context);
      console.error(`[sf-mcp] ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: true, message }, null, 2) }],
        isError: true,
      };
    }
  };
}

// ─── Safe JSON stringify ───────────────────────────────────────────────────────
// Handles circular refs, BigInt, undefined values
export function safeJSON(data: unknown): string {
  try {
    return JSON.stringify(data, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value === undefined) return null;
      return value;
    }, 2);
  } catch {
    return JSON.stringify({ error: "Could not serialize response", raw: String(data) }, null, 2);
  }
}

// ─── Standard success response ────────────────────────────────────────────────
export function ok(data: unknown) {
  const text = safeJSON(data);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  };
}
