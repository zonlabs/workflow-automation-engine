import { JobsOptions, Queue } from "bullmq";
import { getSharedRedisConnection } from "./redis";

export const WORKFLOW_QUEUE_NAME = "workflow-executions";
export const SCHEDULER_QUEUE_NAME = "workflow-scheduler";

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

const defaultAttempts = Number(process.env.WORKER_MAX_ATTEMPTS ?? "3");
const defaultBackoffDelay = Number(process.env.WORKER_BACKOFF_DELAY ?? "5000");
const defaultJobTimeout = Number(process.env.WORKER_JOB_TIMEOUT ?? "600000");

const defaultJobOptions: JobsOptions = {
  attempts: Number.isFinite(defaultAttempts) ? defaultAttempts : 3,
  backoff: {
    type: "exponential",
    delay: Number.isFinite(defaultBackoffDelay) ? defaultBackoffDelay : 5000,
  },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

export const workflowQueue = new Queue<WorkflowJobData>(WORKFLOW_QUEUE_NAME, {
  connection: getSharedRedisConnection(),
  defaultJobOptions,
});

export const schedulerQueue = new Queue<Record<string, never>>(SCHEDULER_QUEUE_NAME, {
  connection: getSharedRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export async function enqueueWorkflowExecution(
  payload: WorkflowJobData,
  options: JobsOptions = {}
) {
  const jobId = options.jobId ?? `execution-${payload.executionLogId}`;
  return workflowQueue.add("execute-workflow", payload, {
    ...defaultJobOptions,
    ...options,
    jobId,
  });
}
