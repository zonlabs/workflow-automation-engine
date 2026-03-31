import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Queue is instantiated at module-load time, so the mock must be ready before
// the import. We use `this.add = vi.fn()` inside the constructor so we can
// later access the stub via the exported `workflowQueue` instance directly.

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: any) {
    this.add = vi.fn();
  }),
  Worker: vi.fn(function () {}),
  JobsOptions: {},
}));

vi.mock("../../src/lib/redis", () => ({
  getSharedRedisConnection: vi.fn(function () { return { status: "ready" }; }),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  enqueueWorkflowExecution,
  workflowQueue,
  WORKFLOW_QUEUE_NAME,
  SCHEDULER_QUEUE_NAME,
} from "../../src/lib/queue";
import type { WorkflowJobData } from "../../src/lib/queue";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<WorkflowJobData> = {}): WorkflowJobData {
  return {
    workflowId: "wf-001",
    scheduledWorkflowId: "sched-001",
    executionLogId: "log-abc",
    userId: "user-xyz",
    sessionId: "sess-123",
    triggeredBy: "manual",
    params: {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("queue constants", () => {
  it("WORKFLOW_QUEUE_NAME is defined", () => {
    expect(WORKFLOW_QUEUE_NAME).toBe("workflow-executions");
  });

  it("SCHEDULER_QUEUE_NAME is defined", () => {
    expect(SCHEDULER_QUEUE_NAME).toBe("workflow-scheduler");
  });
});

describe("enqueueWorkflowExecution", () => {
  // Grab the `add` stub placed on the Queue instance by the mock constructor.
  let mockAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAdd = (workflowQueue as unknown as { add: ReturnType<typeof vi.fn> }).add;
    mockAdd.mockReset();
    mockAdd.mockResolvedValue({ id: "job-001" });
  });

  it("calls workflowQueue.add with job name 'execute-workflow'", async () => {
    await enqueueWorkflowExecution(makePayload());
    expect(mockAdd).toHaveBeenCalledWith(
      "execute-workflow",
      expect.any(Object),
      expect.any(Object)
    );
  });

  it("passes the full payload as job data", async () => {
    const payload = makePayload({ workflowId: "wf-special", params: { key: "val" } });
    await enqueueWorkflowExecution(payload);

    const [, data] = mockAdd.mock.calls[0];
    expect(data.workflowId).toBe("wf-special");
    expect(data.params).toEqual({ key: "val" });
  });

  it("defaults jobId to execution-{executionLogId} when no options provided", async () => {
    await enqueueWorkflowExecution(makePayload({ executionLogId: "log-abc" }));

    const [, , opts] = mockAdd.mock.calls[0];
    expect(opts.jobId).toBe("execution-log-abc");
  });

  it("uses the provided jobId from options instead of the default", async () => {
    await enqueueWorkflowExecution(makePayload(), { jobId: "custom-job-id" });

    const [, , opts] = mockAdd.mock.calls[0];
    expect(opts.jobId).toBe("custom-job-id");
  });

  it("merges caller options with defaultJobOptions", async () => {
    await enqueueWorkflowExecution(makePayload(), { priority: 5 } as any);

    const [, , opts] = mockAdd.mock.calls[0];
    expect(opts.attempts).toBeDefined();
    expect(opts.priority).toBe(5);
  });

  it("includes exponential backoff in job options", async () => {
    await enqueueWorkflowExecution(makePayload());

    const [, , opts] = mockAdd.mock.calls[0];
    expect(opts.backoff).toEqual(
      expect.objectContaining({ type: "exponential" })
    );
  });

  it("sets removeOnComplete and removeOnFail thresholds", async () => {
    await enqueueWorkflowExecution(makePayload());

    const [, , opts] = mockAdd.mock.calls[0];
    expect(typeof opts.removeOnComplete).toBe("number");
    expect(typeof opts.removeOnFail).toBe("number");
  });

  it("returns the BullMQ job object from queue.add", async () => {
    mockAdd.mockResolvedValueOnce({ id: "bullmq-job-999" });

    const job = await enqueueWorkflowExecution(makePayload());

    expect(job).toEqual({ id: "bullmq-job-999" });
  });

  it("propagates errors thrown by queue.add", async () => {
    mockAdd.mockRejectedValueOnce(new Error("Redis connection refused"));

    await expect(enqueueWorkflowExecution(makePayload())).rejects.toThrow(
      "Redis connection refused"
    );
  });
});
