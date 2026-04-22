import "dotenv/config";
import { Worker } from "bullmq";
import { getSharedRedisConnection } from "../src/lib/redis";
import { schedulerQueue, SCHEDULER_QUEUE_NAME } from "../src/lib/queue";
import { serviceRegistry } from "../src/application/service-registry";

/** Default 5m: scheduler does many DB/session calls; BullMQ's 30s lock causes "Missing lock" on moveToFinished. */
const schedulerLockDurationMs = Number(
  process.env.SCHEDULER_LOCK_DURATION_MS ?? "300000"
);

export const schedulerWorker = new Worker(
  SCHEDULER_QUEUE_NAME,
  async () => {
    const result = await serviceRegistry.schedulerTickService.runTick();
    if (result.enqueued > 0) {
      console.log(
        `[scheduler] Tick: checked=${result.checked} enqueued=${result.enqueued}`
      );
    }
    return result;
  },
  {
    connection: getSharedRedisConnection(),
    concurrency: 1,
    lockDuration: Number.isFinite(schedulerLockDurationMs)
      ? schedulerLockDurationMs
      : 300000,
  }
);

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
