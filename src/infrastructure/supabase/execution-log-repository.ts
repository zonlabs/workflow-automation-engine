import { supabase } from "../../lib/supabase";
import type { WorkflowTriggeredBy } from "../../domain/workflow";

export class ExecutionLogRepository {
  async updateExecutionLog(executionLogId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.from("execution_logs").update(patch).eq("id", executionLogId);
    if (error) {
      throw new Error(`Failed to update execution log ${executionLogId}: ${error.message}`);
    }
  }

  async createPendingExecutionLog(input: {
    workflowId: string;
    scheduledWorkflowId: string;
    userId: string;
    status?: string;
    inputData: Record<string, unknown>;
    triggeredBy: WorkflowTriggeredBy;
    retryCount: number;
    startedAt: string;
  }): Promise<string> {
    const { data, error } = await supabase
      .from("execution_logs")
      .insert({
        workflow_id: input.workflowId,
        scheduled_workflow_id: input.scheduledWorkflowId,
        user_id: input.userId,
        status: input.status ?? "pending",
        input_data: input.inputData,
        triggered_by: input.triggeredBy,
        retry_count: input.retryCount,
        started_at: input.startedAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create execution log");
    }

    return String(data.id);
  }
}
