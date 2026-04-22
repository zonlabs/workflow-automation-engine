import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serviceRegistry } from "../src/application/service-registry";
import {
  errorResponse,
  jsonResponse,
  resolveUserId,
} from "./workflow-tool-shared";

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

      try {
        if (scheduled_workflow_id?.trim()) {
          const validated = await serviceRegistry.workflowToolService.validateScheduledWorkflow(
            scheduled_workflow_id.trim(),
            resolvedUserId
          );
          if (!validated || validated.workflow_id !== workflow_id) {
            return errorResponse("scheduled_workflow_id not found or does not match workflow_id");
          }
        }

        const result = await serviceRegistry.executionEnqueueService.enqueueExecution({
          workflowId: workflow_id,
          userId: resolvedUserId,
          triggeredBy: "manual",
          params: (params as Record<string, unknown>) ?? {},
          sessionId: session_id?.trim(),
          scheduledWorkflowId: scheduled_workflow_id?.trim(),
          requireWorkflowActive: true,
          allowCreateManualSchedule: true,
        });

        return jsonResponse({
          success: true,
          execution_log_id: result.executionLogId,
          job_id: result.jobId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Queue error";
        if (
          message === "Workflow not found" ||
          message === "Workflow is inactive" ||
          message === "No active MCP session found"
        ) {
          return errorResponse(message);
        }
        if (message === "No schedule found for workflow") {
          return errorResponse("scheduled_workflow_id not found or does not match workflow_id");
        }
        return errorResponse(message);
      }
    }
  );
}
