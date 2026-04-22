export type JsonObject = Record<string, unknown>;

export type WorkflowExecutionStatus = "success" | "failed";
export type WorkflowTriggeredBy = "scheduler" | "manual" | "webhook";

export interface WorkflowJobData {
  workflowId: string;
  scheduledWorkflowId: string;
  executionLogId: string;
  userId: string;
  sessionId: string;
  triggeredBy: WorkflowTriggeredBy;
  params: Record<string, unknown>;
  attempt?: number;
}

export interface WorkflowRow {
  id: string;
  toolkit_ids?: string[] | null;
  script_code?: string | null;
  script_runtime?: JsonObject | null;
}

export interface WorkflowStepResult {
  stepId: string;
  stepNumber: number;
  stepName: string;
  toolSlug: string;
  output: unknown;
  durationMs: number;
}

export interface WorkflowExecutionContext {
  params: Record<string, unknown>;
  steps: Record<number, WorkflowStepResult>;
}

export interface WorkflowExecutionErrorShape {
  message: string;
  code?: string;
  stack?: string;
}

export interface WorkflowExecutionResult {
  status: WorkflowExecutionStatus;
  retryable: boolean;
  output: WorkflowExecutionContext;
  error?: WorkflowExecutionErrorShape;
}

export interface ScheduledWorkflowRow {
  id: string;
  workflow_id: string;
  user_id: string;
  name?: string | null;
  cron_expression: string;
  cron_timezone?: string | null;
  params?: Record<string, unknown> | null;
  last_run_at?: string | null;
  is_enabled?: boolean;
  status?: string | null;
}

export interface ExecutionLogSummaryRow {
  workflow_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  triggered_by: string | null;
}

export interface ExecutionEnqueueRequest {
  workflowId: string;
  userId: string;
  triggeredBy: WorkflowTriggeredBy;
  params: Record<string, unknown>;
  sessionId?: string;
  scheduledWorkflowId?: string;
}

export interface ExecutionEnqueueResult {
  executionLogId: string;
  scheduledWorkflowId: string;
  jobId: string | null;
}

export interface ScheduleTickResult {
  checked: number;
  enqueued: number;
}
