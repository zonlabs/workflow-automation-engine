import { Worker } from "bullmq";
import { executeWorkflowJob } from "../src/lib/mcp-executor";
import { getSharedRedisConnection } from "../src/lib/redis";
import { WORKFLOW_QUEUE_NAME, WorkflowJobData } from "../src/lib/queue";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? "5");
const jobTimeoutMs = Number(process.env.WORKER_JOB_TIMEOUT ?? "600000");

export const workflowWorker = new Worker<WorkflowJobData>(
  WORKFLOW_QUEUE_NAME,
  async (job) => {
    const result = await executeWorkflowJob(job.data);
    if (result.status === "failed" && !result.retryable) {
      return result;
    }
    return result;
  },
  {
    connection: getSharedRedisConnection(),
    concurrency: Number.isFinite(concurrency) ? concurrency : 5,
    lockDuration: Number.isFinite(jobTimeoutMs) ? jobTimeoutMs : 600000,
  }
);

workflowWorker.on("completed", (job) => {
  console.log(`[workflow-worker] completed job=${job.id}`);
});

workflowWorker.on("failed", (job, err) => {
  console.error(`[workflow-worker] failed job=${job?.id ?? "unknown"} error=${err.message}`);
});
