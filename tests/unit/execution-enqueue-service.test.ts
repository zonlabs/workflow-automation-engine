import { describe, expect, it, vi } from "vitest";
import { ExecutionEnqueueService } from "../../src/application/scheduling/execution-enqueue-service";

describe("ExecutionEnqueueService", () => {
  function makeService() {
    const scheduleRepository = {
      resolveLatestScheduleId: vi.fn(),
      ensureManualSchedule: vi.fn(),
    };
    const executionLogRepository = {
      createPendingExecutionLog: vi.fn(),
      updateExecutionLog: vi.fn(),
    };
    const queueGateway = {
      enqueue: vi.fn(),
    };
    const sessionResolver = {
      resolveActiveSessionId: vi.fn(),
    };
    const workflowLookup = {
      getActiveWorkflow: vi.fn(),
    };

    const service = new ExecutionEnqueueService({
      scheduleRepository: scheduleRepository as any,
      executionLogRepository: executionLogRepository as any,
      queueGateway: queueGateway as any,
      sessionResolver: sessionResolver as any,
      workflowLookup,
    });

    return {
      service,
      scheduleRepository,
      executionLogRepository,
      queueGateway,
      sessionResolver,
      workflowLookup,
    };
  }

  it("creates a manual schedule when allowed and none exists", async () => {
    const {
      service,
      scheduleRepository,
      executionLogRepository,
      queueGateway,
      sessionResolver,
    } = makeService();

    scheduleRepository.resolveLatestScheduleId.mockResolvedValue(undefined);
    scheduleRepository.ensureManualSchedule.mockResolvedValue("sched-manual");
    sessionResolver.resolveActiveSessionId.mockResolvedValue("sess-1");
    executionLogRepository.createPendingExecutionLog.mockResolvedValue("log-1");
    queueGateway.enqueue.mockResolvedValue({ id: "job-1" });

    const result = await service.enqueueExecution({
      workflowId: "wf-1",
      userId: "user-1",
      triggeredBy: "manual",
      params: { a: 1 },
      allowCreateManualSchedule: true,
    });

    expect(scheduleRepository.ensureManualSchedule).toHaveBeenCalledWith("user-1", "wf-1");
    expect(result).toEqual({
      executionLogId: "log-1",
      scheduledWorkflowId: "sched-manual",
      jobId: "job-1",
    });
  });

  it("validates workflow activity when requested", async () => {
    const { service, workflowLookup } = makeService();
    workflowLookup.getActiveWorkflow.mockResolvedValue({ id: "wf-1", is_active: false });

    await expect(
      service.enqueueExecution({
        workflowId: "wf-1",
        userId: "user-1",
        triggeredBy: "manual",
        params: {},
        requireWorkflowActive: true,
      })
    ).rejects.toThrow("Workflow is inactive");
  });

  it("marks the execution log as failed when queueing throws", async () => {
    const {
      service,
      executionLogRepository,
      queueGateway,
    } = makeService();

    executionLogRepository.createPendingExecutionLog.mockResolvedValue("log-1");
    queueGateway.enqueue.mockRejectedValue(new Error("Redis down"));

    await expect(
      service.enqueueExecution({
        workflowId: "wf-1",
        userId: "user-1",
        triggeredBy: "manual",
        params: {},
        scheduledWorkflowId: "sched-1",
        sessionId: "sess-1",
      })
    ).rejects.toThrow("Redis down");

    expect(executionLogRepository.updateExecutionLog).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({
        status: "failed",
        error_message: "Redis down",
      })
    );
  });
});
