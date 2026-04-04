import 'dotenv/config';
import { schedulerQueue } from './lib/queue';
import { workflowWorker } from './workers/workflow-worker';
import { schedulerWorker } from './workers/scheduler';

async function startWorkers() {
  console.log('[INFO] Starting BullMQ Workflow Engine');

  try {
    // Start scheduler to check every 60 seconds
    await schedulerQueue.add(
      'check-schedules',
      {},
      {
        repeat: {
          every: 60000,
        },
        removeOnComplete: true,
      }
    );

    console.log('[OK] Scheduler started (checks every 60s)');
    console.log('[OK] Workflow worker ready (concurrency: ' +
      (process.env.WORKER_CONCURRENCY || '5') + ')');
    console.log('[OK] Listening for jobs');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('[INFO] Shutting down gracefully...');
      await workflowWorker.close();
      await schedulerWorker.close();
      console.log('[OK] Workers closed');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('[INFO] Interrupted, shutting down...');
      await workflowWorker.close();
      await schedulerWorker.close();
      console.log('[OK] Workers closed');
      process.exit(0);
    });
  } catch (err) {
    console.error('[ERROR] Failed to start workers:', err);
    process.exit(1);
  }
}

startWorkers();
