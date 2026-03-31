import { Worker } from "bullmq";
import { getSharedRedisConnection } from "../src/lib/redis";
import { schedulerQueue, SCHEDULER_QUEUE_NAME } from "../src/lib/queue";

export const schedulerWorker = new Worker(
  SCHEDULER_QUEUE_NAME,
  async () => {
    // Initial bootstrap: scheduler heartbeat only.
    // Actual schedule scanning/enqueue logic can be added next.
    return { ok: true, at: new Date().toISOString() };
  },
  {
    connection: getSharedRedisConnection(),
    concurrency: 1,
  }
);

schedulerWorker.on("completed", (job) => {
  console.log(`[scheduler-worker] completed job=${job.id}`);
});

schedulerWorker.on("failed", (job, err) => {
  console.error(`[scheduler-worker] failed job=${job?.id ?? "unknown"} error=${err.message}`);
});

export async function ensureSchedulerHeartbeat() {
  await schedulerQueue.add(
    "check-schedules",
    {},
    {
      repeat: { every: 60000 },
      removeOnComplete: true,
    }
  );
}
