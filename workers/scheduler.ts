import "dotenv/config";
import { Worker } from "bullmq";
import { getSharedRedisConnection } from "../src/lib/redis";
import { schedulerQueue, SCHEDULER_QUEUE_NAME, enqueueWorkflowExecution } from "../src/lib/queue";
import { supabase } from "../src/lib/supabase";
import { storage } from "@mcp-ts/sdk/server";
import { CronExpressionParser } from "cron-parser";

async function resolveSessionId(userId: string): Promise<string | null> {
  try {
    const sessions = await storage.getIdentitySessionsData(userId);
    const match = sessions.find(
      (s: { active?: boolean; sessionId?: string }) => s.active !== false
    );
    if (match?.sessionId) return String(match.sessionId);
  } catch (err) {
    console.warn(`[scheduler] Failed to resolve session for ${userId}: ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

function isDue(cronExpression: string, lastCheckedAt: Date, now: Date): boolean {
  try {
    const expr = CronExpressionParser.parse(cronExpression, {
      currentDate: lastCheckedAt,
      tz: "UTC",
    });

    const nextDate = expr.next().toDate();
    return nextDate <= now;
  } catch {
    return false;
  }
}

async function checkAndEnqueueSchedules() {
  const now = new Date();

  // Fetch enabled schedules with their parent workflow's is_active flag
  const { data: schedules, error } = await supabase
    .from("scheduled_workflows")
    .select(
      "id, workflow_id, user_id, name, cron_expression, params, last_run_at, is_enabled, status"
    )
    .eq("is_enabled", true)
    .eq("status", "active");

  if (error || !schedules || schedules.length === 0) {
    return { checked: 0, enqueued: 0 };
  }

  // Batch-check which parent workflows are active
  const workflowIds = [...new Set(schedules.map((s) => s.workflow_id as string))];
  const { data: activeWorkflows } = await supabase
    .from("workflows")
    .select("id")
    .in("id", workflowIds)
    .eq("is_active", true);

  const activeWfIds = new Set((activeWorkflows ?? []).map((w) => w.id as string));

  let enqueued = 0;

  for (const schedule of schedules) {
    if (!activeWfIds.has(schedule.workflow_id as string)) continue;

    const rawLastRun = schedule.last_run_at as string | null;
    const lastRun = rawLastRun
      ? new Date(rawLastRun.endsWith("Z") ? rawLastRun : rawLastRun + "Z")
      : new Date(now.getTime() - 2 * 60 * 1000);

    if (!isDue(schedule.cron_expression as string, lastRun, now)) {
      continue;
    }

    const identityUserId = String(schedule.user_id ?? "");
    const sessionId = await resolveSessionId(identityUserId);
    if (!sessionId) {
      console.warn(
        `[scheduler] No active MCP session for identity ${identityUserId}, skipping schedule ${schedule.id}`
      );
      continue;
    }

    const { data: executionLog, error: logError } = await supabase
      .from("execution_logs")
      .insert({
        workflow_id: schedule.workflow_id,
        scheduled_workflow_id: schedule.id,
        user_id: identityUserId,
        status: "pending",
        input_data: (schedule.params as Record<string, unknown>) ?? {},
        triggered_by: "scheduler",
        retry_count: 0,
        started_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (logError || !executionLog) {
      console.error(
        `[scheduler] Failed to create execution log for schedule ${schedule.id}: ${logError?.message}`
      );
      continue;
    }

    try {
      await enqueueWorkflowExecution({
        workflowId: schedule.workflow_id as string,
        scheduledWorkflowId: schedule.id as string,
        executionLogId: executionLog.id as string,
        userId: identityUserId,
        sessionId,
        triggeredBy: "scheduler",
        params: (schedule.params as Record<string, unknown>) ?? {},
      });

      const params = (schedule.params as Record<string, unknown>) ?? {};
      const isOneTime = params._one_time === true;

      const updatePatch: Record<string, unknown> = { last_run_at: now.toISOString() };
      if (isOneTime) {
        updatePatch.is_enabled = false;
        updatePatch.status = "disabled";
      }

      const { error: updateErr } = await supabase
        .from("scheduled_workflows")
        .update(updatePatch)
        .eq("id", schedule.id);

      if (updateErr) {
        console.error(`[scheduler] Failed to update schedule ${schedule.id}: ${updateErr.message}`);
      } else if (isOneTime) {
        console.log(`[scheduler] One-time schedule ${schedule.id} auto-disabled after execution`);
      }

      enqueued++;
      console.log(
        `[scheduler] Enqueued workflow=${schedule.workflow_id} schedule=${schedule.id} log=${executionLog.id}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[scheduler] Failed to enqueue schedule ${schedule.id}: ${msg}`);
      await supabase
        .from("execution_logs")
        .update({ status: "failed", error_message: msg, completed_at: now.toISOString() })
        .eq("id", executionLog.id);
    }
  }

  return { checked: schedules.length, enqueued };
}

export const schedulerWorker = new Worker(
  SCHEDULER_QUEUE_NAME,
  async () => {
    const result = await checkAndEnqueueSchedules();
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
