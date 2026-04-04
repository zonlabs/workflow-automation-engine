import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "../src/lib/supabase";
import { enqueueWorkflowExecution } from "../src/lib/queue";
import { storage } from "@mcp-ts/sdk/server";
import { getRequestContext } from "./request-context";
import { ensureManualSchedule } from "../src/lib/manual-schedule";

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

type ToolResult = {
  content: Array<{ type: "text"; text: string; annotations?: { audience?: ("user" | "assistant")[]; priority?: number; lastModified?: string } }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

function jsonResponse(output: unknown): ToolResult {
  const structured = asJsonObject(output);
  return {
    content: [{ type: "text", text: JSON.stringify(output) } as const],
    structuredContent: Object.keys(structured).length > 0 ? structured : { value: output },
  };
}

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` } as const],
    structuredContent: { error: message },
    isError: true,
  };
}

function resolveUserId(argUserId?: string) {
  const ctxUserId = getRequestContext().userId;
  return ctxUserId ?? argUserId ?? "";
}

async function resolveSessionId(userId: string): Promise<string | undefined> {
  try {
    const sessions = await storage.getIdentitySessionsData(userId);
    const active = sessions.find((s: { active?: boolean; sessionId?: string }) => s.active !== false);
    if (active?.sessionId) return String(active.sessionId);
  } catch {
    // fall through
  }
  return undefined;
}

async function resolveScheduleId(userId: string, workflowId: string): Promise<string | undefined> {
  const { data: schedule } = await supabase
    .from("scheduled_workflows")
    .select("id")
    .eq("workflow_id", workflowId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return schedule?.id ?? undefined;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "workflow-automation-engine",
    version: "1.0.0",
  });

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
    async ({ user_id, limit }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, description, is_active, created_at, workflow_steps(toolkit), scheduled_workflows(id)")
        .eq("user_id", resolvedUserId)
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);

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

      const result = rows.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        is_active: w.is_active,
        created_at: w.created_at,
        toolkits: [...new Set(w.workflow_steps.map((s) => s.toolkit))],
        step_count: w.workflow_steps.length,
        schedule_count: w.scheduled_workflows.length,
      }));

      return jsonResponse({ workflows: result });
    }
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
    async ({ user_id, workflow_id }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const { data, error } = await supabase
        .from("workflows")
        .select(
          `id, name, description, is_active, created_at, input_schema, output_schema, script_code, defaults_for_required_parameters,
           script_runtime,
           workflow_steps(id, step_number, name, description, toolkit, tool_slug, tool_arguments, depends_on_step_id, run_if_condition, retry_on_failure, max_retries, timeout_seconds),
           scheduled_workflows(id, name, cron_expression, status, is_enabled, params, created_at)`
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
    async ({
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
    }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
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
    "workflow_run",
    {
      title: "Run Workflow",
      description:
        "Enqueue workflow execution (BullMQ worker). Requires an active MCP session for script workflows that call run_tool. " +
        "If scheduled_workflow_id is omitted, the latest schedule for this workflow is used; if none exists, an internal disabled manual schedule is created automatically. " +
        "Script runs require WORKFLOW_SCRIPT_RUNNER_URL (and the script-runner service) unless using Vercel sandbox mode.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string(),
        params: z.record(z.any()).optional(),
        session_id: z.string().optional(),
        scheduled_workflow_id: z
          .string()
          .optional()
          .describe("Optional. Must belong to this workflow_id and user; otherwise the call fails."),
      },
    },
    async ({ user_id, workflow_id, params, session_id, scheduled_workflow_id }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const { data: workflow, error: wfError } = await supabase
        .from("workflows")
        .select("id, is_active")
        .eq("id", workflow_id)
        .eq("user_id", resolvedUserId)
        .single();

      if (wfError || !workflow) {
        return errorResponse("Workflow not found");
      }
      if (!workflow.is_active) {
        return errorResponse("Workflow is inactive");
      }

      let sessionId = session_id?.trim();
      if (!sessionId) {
        sessionId = await resolveSessionId(resolvedUserId);
      }
      if (!sessionId) {
        return errorResponse("No active MCP session found");
      }

      let scheduledId: string | undefined;

      if (scheduled_workflow_id?.trim()) {
        const sid = scheduled_workflow_id.trim();
        const { data: sch, error: schErr } = await supabase
          .from("scheduled_workflows")
          .select("id, workflow_id")
          .eq("id", sid)
          .eq("user_id", resolvedUserId)
          .maybeSingle();

        if (schErr || !sch || sch.workflow_id !== workflow_id) {
          return errorResponse("scheduled_workflow_id not found or does not match workflow_id");
        }
        scheduledId = sid;
      } else {
        scheduledId = await resolveScheduleId(resolvedUserId, workflow_id);
      }

      if (!scheduledId) {
        try {
          scheduledId = await ensureManualSchedule(resolvedUserId, workflow_id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not create manual schedule";
          return errorResponse(msg);
        }
      }

      const runParams = asJsonObject(params);

      const { data: executionLog, error: logError } = await supabase
        .from("execution_logs")
        .insert({
          workflow_id: workflow_id,
          scheduled_workflow_id: scheduledId,
          user_id: resolvedUserId,
          status: "pending",
          input_data: runParams,
          triggered_by: "manual",
          retry_count: 0,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (logError || !executionLog) {
        return errorResponse(logError?.message ?? "Failed to create log");
      }

      const executionLogId = executionLog.id as string;

      try {
        const job = await enqueueWorkflowExecution({
          workflowId: workflow_id,
          scheduledWorkflowId: scheduledId,
          executionLogId,
          userId: resolvedUserId,
          sessionId,
          triggeredBy: "manual",
          params: runParams,
        });

        await supabase
          .from("execution_logs")
          .update({ job_id: job.id?.toString() ?? `execution-${executionLogId}` })
          .eq("id", executionLogId);

        return jsonResponse({ success: true, execution_log_id: executionLogId, job_id: job.id ?? null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Queue error";
        await supabase
          .from("execution_logs")
          .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
          .eq("id", executionLogId);
        return errorResponse(msg);
      }
    }
  );

  server.registerTool(
    "schedule_upsert",
    {
      title: "Create or Update Schedule",
      description:
        "Create or update a cron schedule (5-field cron, evaluated in UTC by the scheduler worker). " +
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
        status: z.string().optional(),
        is_enabled: z.boolean().optional(),
        params: z.record(z.any()).optional(),
      },
    },
    async ({ user_id, workflow_id, schedule_id, name, cron_expression, status, is_enabled, params }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const payload = {
        workflow_id,
        user_id: resolvedUserId,
        name,
        cron_expression,
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
          .select("id, name, cron_expression, status, is_enabled, params, created_at")
          .single();
        if (error || !data) {
          return errorResponse(error?.message ?? "Update failed");
        }
        return jsonResponse({ schedule: data });
      }

      const { data, error } = await supabase
        .from("scheduled_workflows")
        .insert(payload)
        .select("id, name, cron_expression, status, is_enabled, params, created_at")
        .single();

      if (error || !data) {
        return errorResponse(error?.message ?? "Create failed");
      }

      return jsonResponse({ schedule: data });
    }
  );

  server.registerTool(
    "execution_log_list",
    {
      title: "List Execution Logs",
      description: "List recent execution logs.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        workflow_id: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ user_id, workflow_id, limit }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      let query = supabase
        .from("execution_logs")
        .select("id, workflow_id, scheduled_workflow_id, status, triggered_by, started_at, completed_at, duration_ms, error_message, error_code, input_data, created_at")
        .eq("user_id", resolvedUserId)
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);

      if (workflow_id) {
        query = query.eq("workflow_id", workflow_id);
      }

      const { data, error } = await query;
      if (error) {
        return errorResponse(error.message);
      }

      return jsonResponse({ logs: data ?? [] });
    }
  );

  server.registerTool(
    "execution_log_get",
    {
      title: "Get Execution Log",
      description: "Fetch a single execution log.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        execution_log_id: z.string(),
      },
    },
    async ({ user_id, execution_log_id }, _extra) => {
      const resolvedUserId = resolveUserId(user_id);
      if (!resolvedUserId) {
        return errorResponse("user_id is required");
      }
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*")
        .eq("id", execution_log_id)
        .eq("user_id", resolvedUserId)
        .single();

      if (error || !data) {
        return errorResponse("Execution log not found");
      }

      return jsonResponse({ execution_log: data });
    }
  );

  return server;
}
