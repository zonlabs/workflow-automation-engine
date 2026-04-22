import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../src/lib/supabase";
import {
  asJsonObject,
  errorResponse,
  jsonResponse,
  resolveUserId,
  type ToolExtra,
  type ToolResult,
} from "./workflow-tool-shared";

type ExecutionLogSummaryRow = {
  workflow_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  triggered_by: string | null;
};

function summarizeExecutionLogs(logs: ExecutionLogSummaryRow[]): {
  last_run_at: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_triggered_by: string | null;
  last_error_preview: string | null;
  runs_in_window: number;
  success_count: number;
  failed_count: number;
  other_count: number;
} {
  if (logs.length === 0) {
    return {
      last_run_at: null,
      last_status: null,
      last_duration_ms: null,
      last_triggered_by: null,
      last_error_preview: null,
      runs_in_window: 0,
      success_count: 0,
      failed_count: 0,
      other_count: 0,
    };
  }
  const last = logs[0];
  let success = 0;
  let failed = 0;
  let other = 0;
  for (const r of logs) {
    if (r.status === "success") success++;
    else if (r.status === "failed" || r.status === "timeout" || r.status === "cancelled") failed++;
    else other++;
  }
  const terminalFail =
    last.status === "failed" || last.status === "timeout" || last.status === "cancelled";
  const errPreview =
    terminalFail && last.error_message?.trim()
      ? last.error_message.trim().slice(0, 140)
      : null;
  return {
    last_run_at: last.created_at,
    last_status: last.status,
    last_duration_ms: last.duration_ms,
    last_triggered_by: last.triggered_by,
    last_error_preview: errPreview,
    runs_in_window: logs.length,
    success_count: success,
    failed_count: failed,
    other_count: other,
  };
}

/** Shared by `workflow_list` and MCP App tool `workflow_open_dashboard`. */
export async function listWorkflowsMcpResult(
  args: { user_id?: string; limit?: number },
  extra: ToolExtra | undefined
): Promise<ToolResult> {
  const resolvedUserId = resolveUserId(args.user_id, extra);
  if (!resolvedUserId) {
    return errorResponse("user_id is required");
  }
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, description, is_active, created_at, workflow_steps(toolkit), scheduled_workflows(id)")
    .eq("user_id", resolvedUserId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 50);

  if (error) {
    return errorResponse(error.message);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    workflow_steps: Array<{ toolkit: string }>;
    scheduled_workflows: Array<{ id: string }>;
  }>;

  const ids = rows.map((r) => r.id);
  const recentPerWf = new Map<string, ExecutionLogSummaryRow[]>();

  if (ids.length > 0) {
    const { data: logRows, error: logErr } = await supabase
      .from("execution_logs")
      .select(
        "workflow_id, status, created_at, completed_at, duration_ms, error_message, triggered_by"
      )
      .eq("user_id", resolvedUserId)
      .in("workflow_id", ids)
      .order("created_at", { ascending: false })
      .limit(2500);

    if (!logErr && logRows) {
      const logs = logRows as ExecutionLogSummaryRow[];
      for (const log of logs) {
        const list = recentPerWf.get(log.workflow_id) ?? [];
        if (list.length < 15) {
          list.push(log);
          recentPerWf.set(log.workflow_id, list);
        }
      }
    }
  }

  const result = rows.map((w) => {
    const stepCount = w.workflow_steps.length;
    const toolkits = [...new Set(w.workflow_steps.map((s) => s.toolkit))];
    const workflow_kind = stepCount > 0 ? ("dag" as const) : ("script" as const);
    const toolkit_label =
      toolkits.length > 0
        ? toolkits.join(", ")
        : workflow_kind === "script"
          ? "Script entrypoint (no DAG steps)"
          : "No toolkits";

    return {
      id: w.id,
      name: w.name,
      description: w.description,
      is_active: w.is_active,
      created_at: w.created_at,
      toolkits,
      step_count: stepCount,
      schedule_count: w.scheduled_workflows.length,
      workflow_kind,
      toolkit_label,
      execution: summarizeExecutionLogs(recentPerWf.get(w.id) ?? []),
    };
  });

  return jsonResponse({ workflows: result });
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
  let query = supabase
    .from("execution_logs")
    .select(
      "id, workflow_id, scheduled_workflow_id, status, triggered_by, started_at, completed_at, duration_ms, error_message, error_code, input_data, created_at"
    )
    .eq("user_id", resolvedUserId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 50);

  const wid = args.workflow_id?.trim();
  if (wid) {
    query = query.eq("workflow_id", wid);
  }

  const { data, error } = await query;
  if (error) {
    return errorResponse(error.message);
  }

  const logs = data ?? [];
  let workflow_name: string | undefined;
  if (wid) {
    const { data: wf } = await supabase
      .from("workflows")
      .select("name")
      .eq("id", wid)
      .eq("user_id", resolvedUserId)
      .maybeSingle();
    workflow_name = wf?.name ?? undefined;
  }

  return jsonResponse({
    logs,
    ...(wid ? { workflow_id: wid, workflow_name } : {}),
  });
}

const TERMINAL_STATUSES = new Set(["success", "failed", "timeout", "cancelled"]);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Fetch execution log row + workflow name. */
async function fetchExecutionLogWithName(
  executionLogId: string,
  resolvedUserId: string
): Promise<{ data: Record<string, unknown>; workflow_name?: string } | null> {
  const { data, error } = await supabase
    .from("execution_logs")
    .select("*")
    .eq("id", executionLogId)
    .eq("user_id", resolvedUserId)
    .single();

  if (error || !data) return null;

  const row = data as { workflow_id?: string };
  let workflow_name: string | undefined;
  if (row.workflow_id) {
    const { data: wf } = await supabase
      .from("workflows")
      .select("name")
      .eq("id", row.workflow_id)
      .eq("user_id", resolvedUserId)
      .maybeSingle();
    workflow_name = wf?.name ?? undefined;
  }
  return { data: data as Record<string, unknown>, workflow_name };
}

/**
 * Wait for an execution log to reach a terminal status using Supabase Realtime.
 */
async function waitForCompletion(
  executionLogId: string,
  resolvedUserId: string,
  timeoutSeconds: number
): Promise<{ data: Record<string, unknown>; workflow_name?: string } | null> {
  const timeoutMs = timeoutSeconds * 1000;
  const startTime = Date.now();

  try {
    const result = await waitViaRealtime(executionLogId, resolvedUserId, timeoutMs, startTime);
    if (result !== null) return result;
  } catch (realtimeErr) {
    console.warn("[execution_log_get] Realtime subscription failed:", realtimeErr);
  }

  // If Realtime fails or returns null, just fetch the current state and return it
  return fetchExecutionLogWithName(executionLogId, resolvedUserId);
}

async function waitViaRealtime(
  executionLogId: string,
  resolvedUserId: string,
  timeoutMs: number,
  startTime: number
): Promise<{ data: Record<string, unknown>; workflow_name?: string } | null> {
  return new Promise((resolve, reject) => {
    const channelName = `exec-log-wait-${executionLogId}-${Date.now()}`;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      // Timeout: fetch final state and return whatever we have
      fetchExecutionLogWithName(executionLogId, resolvedUserId).then(resolve).catch(reject);
    }, Math.max(0, timeoutMs - (Date.now() - startTime)));

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "execution_logs",
          filter: `id=eq.${executionLogId}`,
        },
        (payload: { new?: Record<string, unknown> }) => {
          if (settled) return;
          const newRow = payload.new;
          if (newRow && typeof newRow.status === "string" && isTerminalStatus(newRow.status)) {
            settled = true;
            clearTimeout(timer);
            try { supabase.removeChannel(channel); } catch { /* ignore */ }
            // Fetch full row (Realtime payload may not include all columns)
            fetchExecutionLogWithName(executionLogId, resolvedUserId).then(resolve).catch(reject);
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { supabase.removeChannel(channel); } catch { /* ignore */ }
          reject(new Error(`Realtime channel ${status}`));
        }
      });
  });
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

  // Initial fetch
  const initial = await fetchExecutionLogWithName(args.execution_log_id, resolvedUserId);
  if (!initial) {
    return errorResponse("Execution log not found");
  }

  const initialStatus = (initial.data as { status?: string }).status ?? "";

  // If not waiting or already terminal, return immediately
  if (!args.wait_for_completion || isTerminalStatus(initialStatus)) {
    return jsonResponse({
      execution_log: initial.data,
      workflow_id: (initial.data as { workflow_id?: string }).workflow_id,
      workflow_name: initial.workflow_name,
    });
  }

  // Wait for completion
  const timeoutSeconds = Math.min(Math.max(args.timeout_seconds ?? 60, 1), 120);
  const finalResult = await waitForCompletion(args.execution_log_id, resolvedUserId, timeoutSeconds);

  if (!finalResult) {
    return errorResponse("Execution log not found after waiting");
  }

  const finalStatus = (finalResult.data as { status?: string }).status ?? "";
  const timedOut = !isTerminalStatus(finalStatus);

  return jsonResponse({
    execution_log: finalResult.data,
    workflow_id: (finalResult.data as { workflow_id?: string }).workflow_id,
    workflow_name: finalResult.workflow_name,
    ...(timedOut ? { wait_timed_out: true, message: `Timed out after ${timeoutSeconds}s — execution is still ${finalStatus}` } : {}),
  });
}

function registerExecutionLogTools(
  server: McpServer
): void {
  const listDescription = "List recent execution logs. Optional workflow_id scopes rows to one workflow.";
  const getDescription =
    "Fetch a single execution log by id. Set wait_for_completion=true to wait for a running workflow " +
    "to finish (uses Supabase Realtime) instead of polling repeatedly. Returns once the execution " +
    "reaches a terminal state (success/failed/timeout/cancelled) or timeout_seconds elapses.";

  const listConfig = {
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
  };
  const getConfig = {
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
  };

  server.registerTool("execution_log_list", listConfig, async ({ user_id, workflow_id, limit }, extra) =>
    executionLogListMcpResult({ user_id, workflow_id, limit }, extra)
  );
  server.registerTool(
    "execution_log_get",
    getConfig,
    async ({ user_id, execution_log_id, wait_for_completion, timeout_seconds }, extra) =>
      executionLogGetMcpResult({ user_id, execution_log_id, wait_for_completion, timeout_seconds }, extra)
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
      const { data, error } = await supabase
        .from("workflows")
        .select(
          `id, name, description, is_active, created_at, input_schema, output_schema, script_code, defaults_for_required_parameters,
           script_runtime,
           workflow_steps(id, step_number, name, description, toolkit, tool_slug, tool_arguments, depends_on_step_id, run_if_condition, retry_on_failure, max_retries, timeout_seconds),
           scheduled_workflows(id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at)`
        )
        .eq("id", workflow_id)
        .eq("user_id", resolvedUserId)
        .single();

      if (error || !data) {
        return errorResponse("Workflow not found");
      }

      const steps = [...((data.workflow_steps as Array<{ step_number: number }>) ?? [])].sort(
        (a, b) => a.step_number - b.step_number
      );

      return jsonResponse({ workflow: { ...data, workflow_steps: steps } });
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
      const payload = {
        user_id: resolvedUserId,
        name: name.trim(),
        description: description?.trim() ?? null,
        workflow: [],
        input_schema: asJsonObject(input_schema),
        output_schema: asJsonObject(output_schema),
        defaults_for_required_parameters: asJsonObject(defaults),
        script_runtime: asJsonObject(script_runtime),
        script_code,
        is_active: is_active ?? true,
      };

      if (workflow_id) {
        const { data, error } = await supabase
          .from("workflows")
          .update(payload)
          .eq("id", workflow_id)
          .eq("user_id", resolvedUserId)
          .select("id, name, description, is_active, created_at")
          .single();

        if (error || !data) {
          return errorResponse(error?.message ?? "Update failed");
        }

        return jsonResponse({ workflow: data });
      }

      const { data, error } = await supabase
        .from("workflows")
        .insert(payload)
        .select("id, name, description, is_active, created_at")
        .single();

      if (error || !data) {
        return errorResponse(error?.message ?? "Create failed");
      }

      return jsonResponse({ workflow: data });
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
        cron_timezone: z.string().optional().describe("IANA timezone string, e.g. 'Asia/Kolkata' for IST. Defaults to 'Asia/Kolkata'."),
        status: z.string().optional(),
        is_enabled: z.boolean().optional(),
        params: z.record(z.any()).optional(),
      },
    },
    async ({ user_id, workflow_id, schedule_id, name, cron_expression, cron_timezone, status, is_enabled, params }, extra) => {
      const resolvedUserId = resolveUserId(user_id, extra);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const payload = {
        workflow_id,
        user_id: resolvedUserId,
        name,
        cron_expression,
        cron_timezone: cron_timezone ?? "Asia/Kolkata",
        status: status ?? "active",
        is_enabled: is_enabled ?? true,
        params: asJsonObject(params),
      };

      if (schedule_id) {
        const { data, error } = await supabase
          .from("scheduled_workflows")
          .update(payload)
          .eq("id", schedule_id)
          .eq("user_id", resolvedUserId)
          .select("id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at")
          .single();
        if (error || !data) {
          return errorResponse(error?.message ?? "Update failed");
        }
        return jsonResponse({ schedule: data });
      }

      const { data, error } = await supabase
        .from("scheduled_workflows")
        .insert(payload)
        .select("id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at")
        .single();

      if (error || !data) {
        return errorResponse(error?.message ?? "Create failed");
      }

      return jsonResponse({ schedule: data });
    }
  );

  registerExecutionLogTools(server);
}
