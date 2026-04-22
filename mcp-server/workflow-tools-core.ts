import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serviceRegistry } from "../src/application/service-registry";
import {
  asJsonObject,
  errorResponse,
  jsonResponse,
  resolveUserId,
  type ToolExtra,
  type ToolResult,
} from "./workflow-tool-shared";

/** Shared by `workflow_list` and MCP App tool `workflow_open_dashboard`. */
export async function listWorkflowsMcpResult(
  args: { user_id?: string; limit?: number },
  extra: ToolExtra | undefined
): Promise<ToolResult> {
  const resolvedUserId = resolveUserId(args.user_id, extra);
  if (!resolvedUserId) {
    return errorResponse("user_id is required");
  }

  try {
    const workflows = await serviceRegistry.workflowToolService.listWorkflows(
      resolvedUserId,
      args.limit ?? 50
    );
    return jsonResponse({ workflows });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Failed to list workflows");
  }
}

export type RegisterWorkflowMcpCoreToolsOptions = {
  // Options for MCP App UI resources removed.
};

/** Shared handler for `execution_log_list`. */
export async function executionLogListMcpResult(
  args: { user_id?: string; workflow_id?: string; limit?: number },
  extra: ToolExtra | undefined
): Promise<ToolResult> {
  const resolvedUserId = resolveUserId(args.user_id, extra);
  if (!resolvedUserId) {
    return errorResponse("user_id is required");
  }

  try {
    const payload = await serviceRegistry.workflowToolService.listExecutionLogs(
      resolvedUserId,
      args.workflow_id,
      args.limit ?? 50
    );
    return jsonResponse(payload);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Failed to list execution logs");
  }
}

/** Shared handler for `execution_log_get`. */
export async function executionLogGetMcpResult(
  args: {
    user_id?: string;
    execution_log_id: string;
    wait_for_completion?: boolean;
    timeout_seconds?: number;
  },
  extra: ToolExtra | undefined
): Promise<ToolResult> {
  const resolvedUserId = resolveUserId(args.user_id, extra);
  if (!resolvedUserId) {
    return errorResponse("user_id is required");
  }

  try {
    const payload = await serviceRegistry.workflowToolService.getExecutionLog({
      userId: resolvedUserId,
      executionLogId: args.execution_log_id,
      waitForCompletion: args.wait_for_completion,
      timeoutSeconds: args.timeout_seconds,
    });
    return jsonResponse(payload);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Failed to fetch execution log");
  }
}

function registerExecutionLogTools(server: McpServer): void {
  const listDescription = "List recent execution logs. Optional workflow_id scopes rows to one workflow.";
  const getDescription =
    "Fetch a single execution log by id. Set wait_for_completion=true to wait for a running workflow " +
    "to finish (uses Supabase Realtime) instead of polling repeatedly. Returns once the execution " +
    "reaches a terminal state (success/failed/timeout/cancelled) or timeout_seconds elapses.";

  server.registerTool(
    "execution_log_list",
    {
      title: "List Execution Logs",
      description: listDescription,
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ user_id, workflow_id, limit }, extra) =>
      executionLogListMcpResult({ user_id, workflow_id, limit }, extra)
  );

  server.registerTool(
    "execution_log_get",
    {
      title: "Get Execution Log",
      description: getDescription,
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        execution_log_id: z.string(),
        wait_for_completion: z
          .boolean()
          .optional()
          .describe(
            "If true, waits until the execution reaches a terminal status (success, failed, timeout, cancelled) " +
            "or until timeout_seconds elapses. Uses Supabase Realtime. Default: false."
          ),
        timeout_seconds: z
          .number()
          .optional()
          .describe("Max seconds to wait when wait_for_completion is true. Default: 60, max: 120."),
      },
    },
    async ({ user_id, execution_log_id, wait_for_completion, timeout_seconds }, extra) =>
      executionLogGetMcpResult(
        { user_id, execution_log_id, wait_for_completion, timeout_seconds },
        extra
      )
  );
}

/** Workflow MCP tools that only need Supabase (no BullMQ). */
export function registerWorkflowMcpCoreTools(
  server: McpServer,
  _options?: RegisterWorkflowMcpCoreToolsOptions
): void {
  server.registerTool(
    "workflow_list",
    {
      title: "List Workflows",
      description:
        "List workflows for a user. Rows are keyed by Supabase auth user id (UUID string); omit user_id to use the authenticated MCP session.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        limit: z.number().optional(),
      },
    },
    async ({ user_id, limit }, extra) => listWorkflowsMcpResult({ user_id, limit }, extra)
  );

  server.registerTool(
    "workflow_get",
    {
      title: "Get Workflow",
      description:
        "Fetch a workflow including script_code, schemas, workflow_steps (multi-tool DAG), and scheduled_workflows. " +
        "Script workflows: see workflow_upsert_script for the supported JavaScript/Python entry-point API.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string(),
      },
    },
    async ({ user_id, workflow_id }, extra) => {
      const resolvedUserId = resolveUserId(user_id, extra);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }

      try {
        const workflow = await serviceRegistry.workflowToolService.getWorkflow(
          resolvedUserId,
          workflow_id
        );
        return jsonResponse({ workflow });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : "Workflow not found");
      }
    }
  );

  server.registerTool(
    "workflow_upsert_script",
    {
      title: "Create or Update Script Workflow",
      description:
        "Create or update a workflow executed as a single script (no workflow_steps rows required). " +
        "JavaScript (default): top-level `async function main(params, context) { ... }` (recommended), or module.exports.main, " +
        "module.exports.executeWorkflow, module.exports.default, or assign global.output. " +
        "Inside the script, call MCP tools with run_tool(tool_slug, arguments) or mcp.callTool(tool_slug, arguments). " +
        "List-shaped tool output is often `{ results: [...] }` or MCP `{ content: [...] }`; iterate with `for (const row of toolResultRows(await run_tool(...)))` (JS) or `tool_result_rows(await run_tool(...))` (Python), or use the correct property (e.g. `.results`). " +
        "The script-runner resolves tool_slug across all active MCP sessions for that user (remote servers first; workflow_* / schedule_* / execution_log_* prefer the workflow engine). " +
        "tool_slug must be the real tool name (e.g. gmail_find_email), not a chat-prefixed alias. " +
        "`context` is metadata only: workflow_id, execution_log_id, user_id, session_id, triggered_by. " +
        "Python: def main(params, context): or def execute_workflow(...):, or set variable output; use run_tool / mcp.callTool. " +
        "The engine only fires cron schedules (UTC) or manual workflow_run; it does not receive Gmail push events unless you add that later.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        script_code: z.string(),
        script_runtime: z.record(z.any()).optional(),
        input_schema: z.record(z.any()),
        output_schema: z.record(z.any()),
        defaults: z.record(z.any()).optional(),
        is_active: z.boolean().optional(),
      },
    },
    async (
      {
        user_id,
        workflow_id,
        name,
        description,
        script_code,
        script_runtime,
        input_schema,
        output_schema,
        defaults,
        is_active,
      },
      extra
    ) => {
      const resolvedUserId = resolveUserId(user_id, extra);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }

      try {
        const workflow = await serviceRegistry.workflowToolService.upsertScriptWorkflow({
          userId: resolvedUserId,
          workflowId: workflow_id,
          name,
          description,
          scriptCode: script_code,
          scriptRuntime: asJsonObject(script_runtime),
          inputSchema: asJsonObject(input_schema),
          outputSchema: asJsonObject(output_schema),
          defaults: asJsonObject(defaults),
          isActive: is_active,
        });
        return jsonResponse({ workflow });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : "Create failed");
      }
    }
  );

  server.registerTool(
    "schedule_upsert",
    {
      title: "Create or Update Schedule",
      description:
        "Create or update a cron schedule (5-field cron). By default, schedules use IST (Asia/Kolkata), but you can specify any other IANA timezone. " +
        "This is time-based polling only, not a push/webhook trigger. Set is_enabled false to keep a schedule row without the scheduler enqueuing runs.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string(),
        schedule_id: z.string().optional(),
        name: z.string(),
        cron_expression: z.string(),
        cron_timezone: z
          .string()
          .optional()
          .describe("IANA timezone string, e.g. 'Asia/Kolkata' for IST. Defaults to 'Asia/Kolkata'."),
        status: z.string().optional(),
        is_enabled: z.boolean().optional(),
        params: z.record(z.any()).optional(),
      },
    },
    async (
      { user_id, workflow_id, schedule_id, name, cron_expression, cron_timezone, status, is_enabled, params },
      extra
    ) => {
      const resolvedUserId = resolveUserId(user_id, extra);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }

      try {
        const schedule = await serviceRegistry.workflowToolService.upsertSchedule({
          userId: resolvedUserId,
          workflowId: workflow_id,
          scheduleId: schedule_id,
          name,
          cronExpression: cron_expression,
          cronTimezone: cron_timezone,
          status,
          isEnabled: is_enabled,
          params: asJsonObject(params),
        });
        return jsonResponse({ schedule });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : "Create failed");
      }
    }
  );

  registerExecutionLogTools(server);
}
