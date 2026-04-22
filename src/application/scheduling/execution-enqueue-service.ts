import { nowIso } from "../workflow/retry-policy";
import type {
  ExecutionEnqueueRequest,
  ExecutionEnqueueResult,
  WorkflowJobData,
} from "../../domain/workflow";
import type { WorkflowQueueGateway } from "../../infrastructure/queue/workflow-queue-gateway";
import type { McpSessionResolver } from "../../infrastructure/mcp/session-resolver";
import type { ExecutionLogRepository } from "../../infrastructure/supabase/execution-log-repository";
import type { ScheduleRepository } from "../../infrastructure/supabase/schedule-repository";

export type WorkflowActiveLookup = {
  getActiveWorkflow(workflowId: string, userId: string): Promise<{ id: string; is_active: boolean } | null>;
};

export class ExecutionEnqueueService {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      executionLogRepository: ExecutionLogRepository;
      queueGateway: WorkflowQueueGateway;
      sessionResolver: McpSessionResolver;
      workflowLookup?: WorkflowActiveLookup;
    }
  ) {}

  async enqueueExecution(
    request: ExecutionEnqueueRequest & {
      requireWorkflowActive?: boolean;
      allowCreateManualSchedule?: boolean;
    }
  ): Promise<ExecutionEnqueueResult> {
    if (request.requireWorkflowActive && this.deps.workflowLookup) {
      const workflow = await this.deps.workflowLookup.getActiveWorkflow(
        request.workflowId,
        request.userId
      );
      if (!workflow) {
        throw new Error("Workflow not found");
      }
      if (!workflow.is_active) {
        throw new Error("Workflow is inactive");
      }
    }

    let scheduledWorkflowId = request.scheduledWorkflowId?.trim();
    if (!scheduledWorkflowId) {
      scheduledWorkflowId = await this.deps.scheduleRepository.resolveLatestScheduleId(
        request.userId,
        request.workflowId
      );
    }

    if (!scheduledWorkflowId && request.allowCreateManualSchedule) {
      scheduledWorkflowId = await this.deps.scheduleRepository.ensureManualSchedule(
        request.userId,
        request.workflowId
      );
    }

    if (!scheduledWorkflowId) {
      throw new Error("No schedule found for workflow");
    }

    let sessionId = request.sessionId?.trim() ?? "";
    if (!sessionId) {
      sessionId = (await this.deps.sessionResolver.resolveActiveSessionId(request.userId)) ?? "";
    }

    if (!sessionId) {
      throw new Error("No active MCP session found");
    }

    const executionLogId = await this.deps.executionLogRepository.createPendingExecutionLog({
      workflowId: request.workflowId,
      scheduledWorkflowId,
      userId: request.userId,
      inputData: request.params,
      triggeredBy: request.triggeredBy,
      retryCount: 0,
      startedAt: nowIso(),
    });

    try {
      const payload: WorkflowJobData = {
        workflowId: request.workflowId,
        scheduledWorkflowId,
        executionLogId,
        userId: request.userId,
        sessionId,
        triggeredBy: request.triggeredBy,
        params: request.params,
      };

      const job = await this.deps.queueGateway.enqueue(payload);

      await this.deps.executionLogRepository.updateExecutionLog(executionLogId, {
        job_id: job.id?.toString() ?? `execution-${executionLogId}`,
      });

      return {
        executionLogId,
        scheduledWorkflowId,
        jobId: job.id?.toString() ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Queue error";
      await this.deps.executionLogRepository.updateExecutionLog(executionLogId, {
        status: "failed",
        error_message: message,
        completed_at: nowIso(),
      });
      throw err;
    }
  }
}
