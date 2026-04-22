import type {
  WorkflowExecutionContext,
  WorkflowExecutionResult,
  WorkflowJobData,
} from "../../domain/workflow";
import {
  createPermanentWorkflowError,
  normalizeWorkflowError,
  WorkflowExecutionError,
} from "../../domain/workflow-errors";
import { McpSessionResolver } from "../../infrastructure/mcp/session-resolver";
import { ExecutionLogRepository } from "../../infrastructure/supabase/execution-log-repository";
import { WorkflowDefinitionRepository } from "../../infrastructure/supabase/workflow-definition-repository";
import { isTransientError, nowIso } from "./retry-policy";
import { executeScriptWorkflow } from "./workflow-script-service";

export class WorkflowExecutionService {
  constructor(
    private readonly deps: {
      workflowRepository: WorkflowDefinitionRepository;
      executionLogRepository: ExecutionLogRepository;
      sessionResolver: McpSessionResolver;
    } = {
      workflowRepository: new WorkflowDefinitionRepository(),
      executionLogRepository: new ExecutionLogRepository(),
      sessionResolver: new McpSessionResolver(),
    }
  ) {}

  async execute(jobData: WorkflowJobData): Promise<WorkflowExecutionResult> {
    const startedAt = Date.now();
    const context: WorkflowExecutionContext = { params: jobData.params ?? {}, steps: {} };

    console.log("[mcp-executor] Starting workflow job", {
      workflowId: jobData.workflowId,
      scheduledWorkflowId: jobData.scheduledWorkflowId,
      executionLogId: jobData.executionLogId,
      userId: jobData.userId,
      sessionId: jobData.sessionId,
      triggeredBy: jobData.triggeredBy,
      attempt: jobData.attempt ?? 0,
      runnerMode: process.env.WORKFLOW_SCRIPT_RUNNER_MODE ?? "local",
    });

    if (!jobData.sessionId) {
      throw createPermanentWorkflowError(
        "sessionId is required in workflow job payload",
        "SESSION_ID_REQUIRED"
      );
    }

    try {
      await this.deps.executionLogRepository.updateExecutionLog(jobData.executionLogId, {
        status: "running",
        started_at: nowIso(),
        error_message: null,
        error_code: null,
        error_stack: null,
        retry_count: jobData.attempt ?? 0,
      });

      try {
        await this.deps.sessionResolver.assertSessionExists(jobData.userId, jobData.sessionId);
      } catch (err) {
        throw createPermanentWorkflowError(
          err instanceof Error ? err.message : "Session lookup failed",
          "MCP_SESSION_NOT_FOUND",
          err
        );
      }

      const workflow = await this.deps.workflowRepository.fetchWorkflowDefinition(jobData.workflowId);
      return await executeScriptWorkflow(
        jobData,
        workflow,
        context,
        startedAt,
        this.deps.executionLogRepository
      );
    } catch (error) {
      const normalized = normalizeWorkflowError(error);
      const retryable =
        !(error instanceof WorkflowExecutionError) && isTransientError(error);
      console.error("[mcp-executor] Workflow job failed", {
        workflowId: jobData.workflowId,
        executionLogId: jobData.executionLogId,
        message: normalized.message,
        code: normalized.code ?? null,
        retryable,
      });

      try {
        await this.deps.executionLogRepository.updateExecutionLog(jobData.executionLogId, {
          status: "failed",
          completed_at: nowIso(),
          duration_ms: Date.now() - startedAt,
          error_message: normalized.message,
          error_code: normalized.code ?? (retryable ? "TRANSIENT_FAILURE" : "PERMANENT_FAILURE"),
          error_stack: normalized.stack ? { stack: normalized.stack } : null,
        });
      } catch (logError) {
        console.error("[mcp-executor] Failed to write final execution log", logError);
      }

      if (retryable) {
        throw error;
      }

      return {
        status: "failed",
        retryable: false,
        output: context,
        error: normalized,
      };
    } finally {
      console.log("[mcp-executor] Finished workflow job", {
        workflowId: jobData.workflowId,
        executionLogId: jobData.executionLogId,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

export function createWorkflowExecutionService(): WorkflowExecutionService {
  return new WorkflowExecutionService();
}
