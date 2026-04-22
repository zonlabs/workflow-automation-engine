import { getScriptFailureMessage } from "../../lib/script-result";
import { runScriptWorkflow } from "../../lib/script-runner";
import type {
  WorkflowExecutionContext,
  WorkflowExecutionResult,
  WorkflowJobData,
  WorkflowRow,
} from "../../domain/workflow";
import {
  createPermanentWorkflowError,
  normalizeWorkflowError,
} from "../../domain/workflow-errors";
import type { ExecutionLogRepository } from "../../infrastructure/supabase/execution-log-repository";
import { nowIso } from "./retry-policy";

export async function executeScriptWorkflow(
  jobData: WorkflowJobData,
  workflow: WorkflowRow,
  context: WorkflowExecutionContext,
  startedAt: number,
  executionLogRepository: Pick<ExecutionLogRepository, "updateExecutionLog">
): Promise<WorkflowExecutionResult> {
  const scriptCode = workflow.script_code?.trim();
  if (!scriptCode) {
    throw createPermanentWorkflowError(
      "Workflow is missing script_code. Script-based workflows are required.",
      "SCRIPT_CODE_MISSING"
    );
  }

  const scriptStartedAt = Date.now();
  const result = await runScriptWorkflow({
    workflowId: jobData.workflowId,
    executionLogId: jobData.executionLogId,
    userId: jobData.userId,
    sessionId: jobData.sessionId,
    triggeredBy: jobData.triggeredBy,
    scriptCode,
    scriptRuntime: workflow.script_runtime ?? undefined,
    params: context.params,
  });

  context.steps[1] = {
    stepId: "script",
    stepNumber: 1,
    stepName: "Workflow Script",
    toolSlug: "script",
    output: {
      result: result.output,
      logs: result.logs ?? null,
    },
    durationMs: Date.now() - scriptStartedAt,
  };

  const scriptFailure = getScriptFailureMessage(result.output);
  if (scriptFailure) {
    const normalized = normalizeWorkflowError(new Error(scriptFailure));
    await executionLogRepository.updateExecutionLog(jobData.executionLogId, {
      status: "failed",
      output_data: context,
      completed_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: scriptFailure,
      error_code: "SCRIPT_RESULT_ERROR",
      error_stack: normalized.stack ? { stack: normalized.stack } : null,
    });

    return {
      status: "failed",
      retryable: false,
      output: context,
      error: { message: scriptFailure, code: "SCRIPT_RESULT_ERROR", stack: normalized.stack },
    };
  }

  await executionLogRepository.updateExecutionLog(jobData.executionLogId, {
    status: "success",
    output_data: context,
    completed_at: nowIso(),
    duration_ms: Date.now() - startedAt,
    error_message: null,
    error_code: null,
    error_stack: null,
  });

  return {
    status: "success",
    retryable: false,
    output: context,
  };
}
