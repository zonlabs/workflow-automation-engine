import { supabase } from "../../lib/supabase";
import type { ScheduledWorkflowRow } from "../../domain/workflow";
import { MANUAL_SCHEDULE_NAME } from "../../lib/manual-schedule";

export class ScheduleRepository {
  async listActiveSchedules(): Promise<ScheduledWorkflowRow[]> {
    const { data, error } = await supabase
      .from("scheduled_workflows")
      .select(
        "id, workflow_id, user_id, name, cron_expression, cron_timezone, params, last_run_at, is_enabled, status"
      )
      .eq("is_enabled", true)
      .eq("status", "active");

    if (error || !data) {
      return [];
    }

    return data as ScheduledWorkflowRow[];
  }

  async listActiveWorkflowIds(workflowIds: string[]): Promise<Set<string>> {
    if (!workflowIds.length) {
      return new Set();
    }

    const { data } = await supabase
      .from("workflows")
      .select("id")
      .in("id", workflowIds)
      .eq("is_active", true);

    return new Set((data ?? []).map((row) => String(row.id)));
  }

  async updateSchedule(scheduleId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await supabase
      .from("scheduled_workflows")
      .update(patch)
      .eq("id", scheduleId);

    if (error) {
      throw new Error(`Failed to update schedule ${scheduleId}: ${error.message}`);
    }
  }

  async resolveLatestScheduleId(userId: string, workflowId: string): Promise<string | undefined> {
    const { data: schedule } = await supabase
      .from("scheduled_workflows")
      .select("id")
      .eq("workflow_id", workflowId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return schedule?.id ?? undefined;
  }

  async ensureManualSchedule(userId: string, workflowId: string): Promise<string> {
    const { data: existing } = await supabase
      .from("scheduled_workflows")
      .select("id")
      .eq("user_id", userId)
      .eq("workflow_id", workflowId)
      .eq("name", MANUAL_SCHEDULE_NAME)
      .maybeSingle();

    if (existing?.id) {
      return String(existing.id);
    }

    const { data, error } = await supabase
      .from("scheduled_workflows")
      .insert({
        workflow_id: workflowId,
        user_id: userId,
        name: MANUAL_SCHEDULE_NAME,
        cron_expression: "0 0 1 1 *",
        status: "active",
        is_enabled: false,
        params: { _engine_manual: true },
      })
      .select("id")
      .single();

    if (data?.id) {
      return String(data.id);
    }

    const { data: retry } = await supabase
      .from("scheduled_workflows")
      .select("id")
      .eq("user_id", userId)
      .eq("workflow_id", workflowId)
      .eq("name", MANUAL_SCHEDULE_NAME)
      .maybeSingle();

    if (retry?.id) {
      return String(retry.id);
    }

    throw new Error(error?.message ?? "Failed to ensure manual schedule for workflow_run");
  }
}
