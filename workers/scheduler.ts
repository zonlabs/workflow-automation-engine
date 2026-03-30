import { Worker } from 'bullmq';
import cronParser from 'cron-parser';
import supabase from '../lib/supabase';
import { workflowQueue } from '../lib/queue';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
};

export const schedulerWorker = new Worker(
  'scheduler',
  async () => {
    console.log('[Scheduler] Checking for workflows to execute...');

    // Get all active scheduled workflows
    const { data: schedules, error } = await supabase
      .from('scheduled_workflows')
      .select('*')
      .eq('status', 'active')
      .eq('is_enabled', true);

    if (error) {
      console.error('[Scheduler] Failed to fetch schedules:', error);
      return;
    }

    const now = new Date();
    let scheduledCount = 0;

    for (const schedule of schedules || []) {
      try {
        const interval = cronParser.parseExpression(
          schedule.cron_expression
        );
        const nextRun = new Date(interval.next().toDate());

        // Check if it's time to run (with 1-minute tolerance)
        const timeDiff = Math.abs(
          nextRun.getTime() - now.getTime()
        );

        if (timeDiff < 60000) {
          // Time to run!
          const { data: executionLog, error: logError } = await supabase
            .from('execution_logs')
            .insert({
              scheduled_workflow_id: schedule.id,
              workflow_id: schedule.workflow_id,
              user_id: schedule.user_id,
              status: 'pending',
              triggered_by: 'scheduler',
            })
            .select()
            .single();

          if (logError) {
            console.error(
              '[Scheduler] Failed to create execution log:',
              logError
            );
            continue;
          }

          // Add job to queue
          await workflowQueue.add(
            'execute-workflow',
            {
              workflow_id: schedule.workflow_id,
              scheduled_workflow_id: schedule.id,
              user_id: schedule.user_id,
              execution_log_id: executionLog?.id,
              params: schedule.params || {},
            },
            {
              jobId: `${schedule.id}:${Date.now()}`,
              attempts: parseInt(
                process.env.WORKER_MAX_ATTEMPTS || '3'
              ),
              backoff: {
                type: 'exponential',
                delay: parseInt(
                  process.env.WORKER_BACKOFF_DELAY || '5000'
                ),
              },
              timeout: parseInt(
                process.env.WORKER_JOB_TIMEOUT || '600000'
              ),
            }
          );

          // Update next_run_at
          await supabase
            .from('scheduled_workflows')
            .update({
              next_run_at: nextRun.toISOString(),
            })
            .eq('id', schedule.id);

          console.log(
            `[Scheduler] Queued workflow ${schedule.workflow_id} (schedule: ${schedule.id})`
          );
          scheduledCount++;
        }
      } catch (err) {
        console.error(
          `[Scheduler] Error processing schedule ${schedule.id}:`,
          err
        );
      }
    }

    console.log(`[Scheduler] Scheduled ${scheduledCount} workflows`);
  },
  {
    connection: redisConnection,
    settings: {
      maxStalledCount: 1,
      stalledInterval: 5000,
    },
  }
);

schedulerWorker.on('completed', () => {
  console.log('[Scheduler] Check completed');
});

schedulerWorker.on('failed', (job, err) => {
  console.error('[Scheduler] Check failed:', err.message);
});
