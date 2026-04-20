import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SalesforceClient } from "../services/salesforce-client.js";
import {
  RunApexTestsSchema,
  TestRunIdSchema,
  ResumeOperationSchema,
  RunAgentTestSchema,
  AgentTestRunIdSchema,
  CodeAnalysisSchema,
  AntipatternScanSchema,
} from "../schemas/tools.js";

export function registerTestingTools(
  server: McpServer,
  client: SalesforceClient
): void {
  // ─── 1. Run Apex Tests ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_run_apex_tests",
    {
      title: "Run Apex Tests",
      description: `Execute Apex test classes asynchronously and get back a test run ID.

Returns immediately with a testRunId. Use sf_get_apex_test_results or sf_resume_operation to poll for completion.

Args:
  - class_names (string[]): Apex test class names to run
  - suite_names (string[]): Apex test suite names (alternative to class_names)
  - test_level: RunSpecifiedTests | RunLocalTests | RunAllTestsInOrg

Returns: { testRunId: "..." } — use this ID with sf_get_apex_test_results.

Examples:
  - { class_names: ["AccountTriggerTest", "OpportunityServiceTest"] }
  - { test_level: "RunLocalTests" }  → runs all local (non-managed-package) tests`,
      inputSchema: RunApexTestsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ class_names, suite_names, test_level }) => {
      const result = await client.runApexTests({
        classNames: class_names,
        suiteNames: suite_names,
        testLevel: test_level,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            next_step: `Call sf_get_apex_test_results with testRunId "${result.testRunId}" to get results, or sf_resume_operation with { operation_type: "apexTest", operation_id: "${result.testRunId}" } to wait for completion.`,
          }, null, 2),
        }],
        structuredContent: result,
      };
    }
  );

  // ─── Get Apex Test Results ─────────────────────────────────────────────────
  server.registerTool(
    "sf_get_apex_test_results",
    {
      title: "Get Apex Test Results",
      description: `Get results for a completed (or in-progress) Apex test run.

Args:
  - test_run_id (string): ID returned by sf_run_apex_tests

Returns: Summary (pass/fail/skip counts), individual test results with stack traces, and code coverage.

Use sf_resume_operation first if the test run is still in progress.`,
      inputSchema: TestRunIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ test_run_id }) => {
      const result = await client.getApexTestResults(test_run_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 5. Resume / Poll Async Operation ─────────────────────────────────────
  server.registerTool(
    "sf_resume_operation",
    {
      title: "Resume / Poll Async Operation",
      description: `Poll an async Salesforce operation until it completes or times out.

Handles: Apex test runs, metadata deploys, metadata retrieves, and async Apex jobs.

Args:
  - operation_type: "apexTest" | "deploy" | "retrieve" | "apexJob"
  - operation_id: The ID returned by the initiating tool
  - max_poll_seconds: Max wait time in seconds (default: 60, max: 300)
  - poll_interval_seconds: Polling frequency in seconds (default: 5)

Returns: Final status when complete, or a timeout message with the operation ID to retry.

Examples:
  - Wait for test run: { operation_type: "apexTest", operation_id: "707xx0000001234", max_poll_seconds: 120 }
  - Wait for deploy: { operation_type: "deploy", operation_id: "0Afxx0000001234", max_poll_seconds: 180 }`,
      inputSchema: ResumeOperationSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ operation_type, operation_id, max_poll_seconds, poll_interval_seconds }) => {
      const result = await client.pollAsyncOperation({
        operationType: operation_type,
        operationId: operation_id,
        maxPollSeconds: max_poll_seconds,
        pollIntervalSeconds: poll_interval_seconds,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 6. Run Agent Test ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_run_agent_test",
    {
      title: "Run Agentforce Agent Test",
      description: `Execute an Agentforce (Einstein) agent test suite.

Args:
  - agent_test_suite_id (string): AiEvaluationDefinition or BotVersion ID
  - bot_id (string, optional): Specific Bot/Agent ID to target

Returns: Test run ID and initial status. Use sf_get_agent_test_results for outcome.

Use sf_list_agent_test_suites first to find the correct test suite ID.`,
      inputSchema: RunAgentTestSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ agent_test_suite_id, bot_id }) => {
      const result = await client.runAgentTest({ agentTestSuiteId: agent_test_suite_id, botId: bot_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── List Agent Test Suites ────────────────────────────────────────────────
  server.registerTool(
    "sf_list_agent_test_suites",
    {
      title: "List Agent Test Suites",
      description: `List all Agentforce agent test suites and bot versions in the org.

No args required.

Returns: Available test suite IDs to use with sf_run_agent_test.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const suites = await client.listAgentTestSuites();
      const result = { count: suites.length, testSuites: suites };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── Get Agent Test Results ────────────────────────────────────────────────
  server.registerTool(
    "sf_get_agent_test_results",
    {
      title: "Get Agent Test Results",
      description: `Get results from an Agentforce agent test run.

Args:
  - run_id (string): Test run ID returned by sf_run_agent_test

Returns: Agent test outcomes including response quality, intent matching, and action accuracy.`,
      inputSchema: AgentTestRunIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ run_id }) => {
      const result = await client.getAgentTestResults(run_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 7. Code Analysis ─────────────────────────────────────────────────────
  server.registerTool(
    "sf_run_code_analysis",
    {
      title: "Run Code Analysis on Apex Classes",
      description: `Perform static code analysis on Apex classes using the Tooling API.

Checks: compilation errors, symbol table issues, and code quality via container-based compile.

Args:
  - class_names (string[]): Apex class names to analyze
  - trigger_names (string[]): Apex trigger names to analyze

Returns: Compile check results, symbol analysis, and issues found.

Example:
  { class_names: ["AccountService", "OpportunityTriggerHandler"] }

For deeper antipattern detection (SOQL in loops, DML in loops, hardcoded IDs, etc.), use sf_scan_apex_antipatterns.`,
      inputSchema: CodeAnalysisSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ class_names, trigger_names, rules }) => {
      const result = await client.runCodeAnalysis({
        classNames: class_names,
        triggerNames: trigger_names,
        rules,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── 8. Apex Antipattern Scanner ──────────────────────────────────────────
  server.registerTool(
    "sf_scan_apex_antipatterns",
    {
      title: "Scan Apex Classes for Antipatterns",
      description: `Scan Apex class bodies for critical governor limit violations and code quality issues.

Detects:
  🔴 CRITICAL: SOQL inside loops (hits 100 query limit), DML inside loops (hits 150 DML limit)
  🟠 HIGH: Empty catch blocks, classes declared 'without sharing'
  🟡 WARNING: SOQL without LIMIT clauses, hardcoded Salesforce IDs
  🔵 INFO: System.debug() left in code, @future(callout=true) antipatterns

Args:
  - class_names (string[]): Apex class names to scan (max 20 at a time)

Returns: Per-class issue list with line numbers, severity, description, and recommended fix.

Example:
  { class_names: ["AccountTriggerHandler", "LeadConversionService", "OpportunityBatch"] }`,
      inputSchema: AntipatternScanSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ class_names }) => {
      const result = await client.scanApexAntipatterns({ classNames: class_names });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
