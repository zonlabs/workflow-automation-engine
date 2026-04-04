import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { storage } from "@mcp-ts/sdk/server";
import { supabase } from "../src/lib/supabase";
import { enqueueWorkflowExecution } from "../src/lib/queue";
import { ensureManualSchedule } from "../src/lib/manual-schedule";
import {
  asJsonObject,
  errorResponse,
  jsonResponse,
  resolveUserId,
} from "./workflow-tool-shared";

async function resolveSessionId(userId: string): Promise<string | undefined> {
  try {
    const sessions = await storage.getIdentitySessionsData(userId);
    const active = sessions.find((s: { active?: boolean; sessionId?: string }) => s.active !== false);
    if (active?.sessionId) return String(active.sessionId);
  } catch {
    /* fall through */
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

/** Enqueues workflow execution via BullMQ (requires Redis + worker). */
export function registerWorkflowRunTool(server: McpServer): void {
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
    async ({ user_id, workflow_id, params, session_id, scheduled_workflow_id }, extra) => {
      const resolvedUserId = resolveUserId(user_id, extra);
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
}
