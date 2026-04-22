import { DEFAULT_WORKFLOW_TIMEZONE } from "../scheduling/schedule-due-checker";
import { WorkflowMcpRepository } from "../../infrastructure/supabase/workflow-mcp-repository";

function summarizeExecutionLogs(logs: Array<{
  status: string;
  created_at: string;
  duration_ms: number | null;
  triggered_by: string | null;
  error_message: string | null;
}>) {
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
  for (const row of logs) {
    if (row.status === "success") success++;
    else if (row.status === "failed" || row.status === "timeout" || row.status === "cancelled") failed++;
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

const TERMINAL_STATUSES = new Set(["success", "failed", "timeout", "cancelled"]);

export class WorkflowToolService {
  constructor(
    private readonly repository = new WorkflowMcpRepository()
  ) {}

  async listWorkflows(userId: string, limit = 50) {
    const rows = await this.repository.listWorkflows(userId, limit);
    const workflowIds = rows.map((row) => row.id);
    const summaries = await this.repository.listExecutionLogSummaries(userId, workflowIds);
    const recentPerWorkflow = new Map<string, typeof summaries>();

    for (const summary of summaries) {
      const list = recentPerWorkflow.get(summary.workflow_id) ?? [];
      if (list.length < 15) {
        list.push(summary);
        recentPerWorkflow.set(summary.workflow_id, list);
      }
    }

    return rows.map((workflow) => {
      const toolkits = [...new Set(workflow.toolkit_ids ?? [])];
      const workflow_kind = "script" as const;
      const toolkit_label =
        toolkits.length > 0
          ? toolkits.join(", ")
          : workflow.script_code?.trim()
            ? "Script workflow"
            : "No toolkit metadata";

      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        is_active: workflow.is_active,
        created_at: workflow.created_at,
        toolkits,
        step_count: 0,
        schedule_count: workflow.scheduled_workflows.length,
        workflow_kind,
        toolkit_label,
        execution: summarizeExecutionLogs(recentPerWorkflow.get(workflow.id) ?? []),
      };
    });
  }

  async getWorkflow(userId: string, workflowId: string) {
    const data = await this.repository.getWorkflowDetail(userId, workflowId);
    if (!data) {
      throw new Error("Workflow not found");
    }
    return { ...data, workflow_kind: "script" as const };
  }

  async upsertScriptWorkflow(input: {
    userId: string;
    workflowId?: string;
    name: string;
    description?: string;
    scriptCode: string;
    scriptRuntime?: Record<string, unknown>;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    return this.repository.upsertScriptWorkflow(input);
  }

  async upsertSchedule(input: {
    userId: string;
    workflowId: string;
    scheduleId?: string;
    name: string;
    cronExpression: string;
    cronTimezone?: string;
    status?: string;
    isEnabled?: boolean;
    params?: Record<string, unknown>;
  }) {
    return this.repository.upsertSchedule({
      userId: input.userId,
      workflowId: input.workflowId,
      scheduleId: input.scheduleId,
      name: input.name,
      cronExpression: input.cronExpression,
      cronTimezone: input.cronTimezone ?? DEFAULT_WORKFLOW_TIMEZONE,
      status: input.status ?? "active",
      isEnabled: input.isEnabled ?? true,
      params: input.params ?? {},
    });
  }

  async listExecutionLogs(userId: string, workflowId?: string, limit = 50) {
    const logs = await this.repository.listExecutionLogs(userId, workflowId, limit);
    const response: Record<string, unknown> = { logs };
    if (workflowId?.trim()) {
      response.workflow_id = workflowId.trim();
      response.workflow_name = await this.repository.getWorkflowName(userId, workflowId.trim());
    }
    return response;
  }

  async getExecutionLog(input: {
    userId: string;
    executionLogId: string;
    waitForCompletion?: boolean;
    timeoutSeconds?: number;
  }) {
    const initial = await this.repository.fetchExecutionLogWithName(
      input.executionLogId,
      input.userId
    );
    if (!initial) {
      throw new Error("Execution log not found");
    }

    const initialStatus = (initial.data as { status?: string }).status ?? "";
    if (!input.waitForCompletion || TERMINAL_STATUSES.has(initialStatus)) {
      return {
        execution_log: initial.data,
        workflow_id: (initial.data as { workflow_id?: string }).workflow_id,
        workflow_name: initial.workflow_name,
      };
    }

    const timeoutSeconds = Math.min(Math.max(input.timeoutSeconds ?? 60, 1), 120);
    let finalResult = null;
    try {
      finalResult = await this.repository.waitForExecutionLogCompletion(
        input.executionLogId,
        input.userId,
        timeoutSeconds * 1000
      );
    } catch (err) {
      console.warn("[execution_log_get] Realtime subscription failed:", err);
      finalResult = await this.repository.fetchExecutionLogWithName(
        input.executionLogId,
        input.userId
      );
    }

    if (!finalResult) {
      throw new Error("Execution log not found after waiting");
    }

    const finalStatus = (finalResult.data as { status?: string }).status ?? "";
    const timedOut = !TERMINAL_STATUSES.has(finalStatus);

    return {
      execution_log: finalResult.data,
      workflow_id: (finalResult.data as { workflow_id?: string }).workflow_id,
      workflow_name: finalResult.workflow_name,
      ...(timedOut
        ? {
            wait_timed_out: true,
            message: `Timed out after ${timeoutSeconds}s - execution is still ${finalStatus}`,
          }
        : {}),
    };
  }

  getActiveWorkflow(workflowId: string, userId: string) {
    return this.repository.getActiveWorkflow(workflowId, userId);
  }

  validateScheduledWorkflow(scheduledWorkflowId: string, userId: string) {
    return this.repository.validateScheduledWorkflow(scheduledWorkflowId, userId);
  }
}
