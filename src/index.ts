#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { SalesforceClient, SalesforceConfig, AuthMode } from "./services/salesforce-client.js";
import { registerCoreTools } from "./tools/core.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { registerMetadataTools } from "./tools/metadata.js";
import { registerOrgTools } from "./tools/org.js";
import { registerTestingTools } from "./tools/testing.js";
import { registerDevOpsTools } from "./tools/devops.js";
import { registerBulkTools } from "./tools/bulk.js";

// ─── Validate Environment ─────────────────────────────────────────────────────
function getConfig(): SalesforceConfig {
  const authMode = (process.env.SF_AUTH_MODE ?? "password") as AuthMode;
  const loginUrl = process.env.SF_LOGIN_URL;
  const clientId = process.env.SF_CLIENT_ID;
  const username = process.env.SF_USERNAME;

  // Common required fields
  const missingCommon = ["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_USERNAME"].filter(
    (k) => !process.env[k]
  );
  if (missingCommon.length) {
    console.error(`❌ Missing required env vars: ${missingCommon.join(", ")}`);
    process.exit(1);
  }

  if (authMode === "jwt") {
    // JWT mode — no password needed
    if (!process.env.SF_PRIVATE_KEY && !process.env.SF_PRIVATE_KEY_FILE) {
      console.error(
        "❌ JWT auth requires SF_PRIVATE_KEY (PEM string) or SF_PRIVATE_KEY_FILE (path to .key/.pem)\n\n" +
        "JWT Connected App Setup:\n" +
        "  1. Setup → App Manager → New Connected App\n" +
        "  2. Enable OAuth, add 'full' scope\n" +
        "  3. Enable 'Use digital signatures' and upload your certificate (.crt)\n" +
        "  4. Setup → Manage Connected Apps → your app → Edit Policies → Permitted Users: Admin approved\n" +
        "  5. Generate key pair: openssl genrsa -out server.key 2048 && openssl req -new -x509 -key server.key -out server.crt -days 3650\n" +
        "  6. Set SF_PRIVATE_KEY_FILE=./server.key or paste PEM into SF_PRIVATE_KEY"
      );
      process.exit(1);
    }
    console.error("🔐 Auth mode: JWT Bearer Token (passwordless)");
    return {
      loginUrl: loginUrl!,
      clientId: clientId!,
      username: username!,
      apiVersion: process.env.SF_API_VERSION ?? "v60.0",
      authMode: "jwt",
      privateKey: process.env.SF_PRIVATE_KEY,
      privateKeyFile: process.env.SF_PRIVATE_KEY_FILE,
    };
  }

  // Password mode (default)
  const missingPassword = ["SF_CLIENT_SECRET", "SF_PASSWORD"].filter((k) => !process.env[k]);
  if (missingPassword.length) {
    console.error(
      `❌ Password auth requires: ${missingPassword.join(", ")}\n\n` +
      "Or switch to JWT auth: set SF_AUTH_MODE=jwt (no password required)\n\n" +
      "Required env vars for password auth:\n" +
      "  SF_LOGIN_URL=https://login.salesforce.com\n" +
      "  SF_CLIENT_ID=your_consumer_key\n" +
      "  SF_CLIENT_SECRET=your_consumer_secret\n" +
      "  SF_USERNAME=user@yourorg.com\n" +
      "  SF_PASSWORD=yourpassword\n" +
      "  SF_SECURITY_TOKEN=yourtoken   # optional if IP is whitelisted\n" +
      "  SF_API_VERSION=v60.0          # optional\n"
    );
    process.exit(1);
  }
  console.error("🔑 Auth mode: Username + Password");
  return {
    loginUrl: loginUrl!,
    clientId: clientId!,
    username: username!,
    apiVersion: process.env.SF_API_VERSION ?? "v60.0",
    authMode: "password",
    clientSecret: process.env.SF_CLIENT_SECRET,
    password: process.env.SF_PASSWORD,
    securityToken: process.env.SF_SECURITY_TOKEN ?? "",
  };
}

// ─── Build Server ─────────────────────────────────────────────────────────────
function buildServer(config: SalesforceConfig): McpServer {
  const client = new SalesforceClient(config);

  const server = new McpServer({
    name: "salesforce-mcp-server",
    version: "1.0.0",
  });

  registerCoreTools(server, client);
  registerAdvancedTools(server, client);
  registerMetadataTools(server, client);
  registerOrgTools(server, client);
  registerTestingTools(server, client);
  registerDevOpsTools(server, client);
  registerBulkTools(server, client);

  return server;
}

// ─── stdio Transport (default — for Claude Desktop, Cursor, Windsurf) ─────────
async function runStdio(config: SalesforceConfig): Promise<void> {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Salesforce MCP Server running via stdio");
  console.error(`   Org: ${config.loginUrl} | User: ${config.username} | API: ${config.apiVersion}`);
}

// ─── HTTP Transport (for remote access, multi-client) ─────────────────────────
async function runHTTP(config: SalesforceConfig): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "salesforce-mcp-server", version: "1.0.0" });
  });

  // MCP endpoint — stateless, one transport per request
  app.post("/mcp", async (req, res) => {
    const server = buildServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`✅ Salesforce MCP Server running on http://localhost:${port}/mcp`);
    console.error(`   Health: http://localhost:${port}/health`);
    console.error(`   Org: ${config.loginUrl} | User: ${config.username} | API: ${config.apiVersion}`);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
const config = getConfig();
const transport = process.env.TRANSPORT ?? "stdio";

if (transport === "http") {
  runHTTP(config).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  runStdio(config).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
