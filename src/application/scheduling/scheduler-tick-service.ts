import type { ScheduleTickResult } from "../../domain/workflow";
import type { ExecutionEnqueueService } from "./execution-enqueue-service";
import type { ScheduleRepository } from "../../infrastructure/supabase/schedule-repository";
import type { McpSessionResolver } from "../../infrastructure/mcp/session-resolver";
import { DEFAULT_WORKFLOW_TIMEZONE, isScheduleDue } from "./schedule-due-checker";
import { nowIso } from "../workflow/retry-policy";

export class SchedulerTickService {
  constructor(
    private readonly deps: {
      scheduleRepository: ScheduleRepository;
      executionEnqueueService: ExecutionEnqueueService;
      sessionResolver: McpSessionResolver;
    }
  ) {}

  async runTick(now = new Date()): Promise<ScheduleTickResult> {
    const schedules = await this.deps.scheduleRepository.listActiveSchedules();
    if (!schedules.length) {
      return { checked: 0, enqueued: 0 };
    }

    const activeWorkflowIds = await this.deps.scheduleRepository.listActiveWorkflowIds(
      [...new Set(schedules.map((schedule) => String(schedule.workflow_id)))]
    );

    let enqueued = 0;

    for (const schedule of schedules) {
      if (!activeWorkflowIds.has(String(schedule.workflow_id))) {
        continue;
      }

      const rawLastRun = schedule.last_run_at ?? null;
      const lastRun = rawLastRun
        ? new Date(rawLastRun.endsWith("Z") ? rawLastRun : `${rawLastRun}Z`)
        : new Date(now.getTime() - 2 * 60 * 1000);

      const timezone = schedule.cron_timezone || DEFAULT_WORKFLOW_TIMEZONE;
      if (!isScheduleDue(schedule.cron_expression, lastRun, now, timezone)) {
        continue;
      }

      const identityUserId = String(schedule.user_id ?? "");
      const sessionId = await this.deps.sessionResolver.resolveActiveSessionId(identityUserId);
      if (!sessionId) {
        console.warn(
          `[scheduler] No active MCP session for identity ${identityUserId}, skipping schedule ${schedule.id}`
        );
        continue;
      }

      try {
        await this.deps.executionEnqueueService.enqueueExecution({
          workflowId: String(schedule.workflow_id),
          scheduledWorkflowId: String(schedule.id),
          userId: identityUserId,
          sessionId,
          triggeredBy: "scheduler",
          params: (schedule.params as Record<string, unknown>) ?? {},
        });

        const params = (schedule.params as Record<string, unknown>) ?? {};
        const isOneTime = params._one_time === true;
        const updatePatch: Record<string, unknown> = { last_run_at: nowIso() };
        if (isOneTime) {
          updatePatch.is_enabled = false;
          updatePatch.status = "disabled";
        }

        await this.deps.scheduleRepository.updateSchedule(String(schedule.id), updatePatch);
        if (isOneTime) {
          console.log(`[scheduler] One-time schedule ${schedule.id} auto-disabled after execution`);
        }

        enqueued++;
        console.log(
          `[scheduler] Enqueued workflow=${schedule.workflow_id} schedule=${schedule.id}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[scheduler] Failed to enqueue schedule ${schedule.id}: ${message}`);
      }
    }

    return { checked: schedules.length, enqueued };
  }
}
