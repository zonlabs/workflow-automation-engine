import { supabase } from "./supabase";

/**
 * Sentinel schedule for workflows that have no user-defined cron.
 * Disabled so the engine scheduler never enqueues it; execution_logs still satisfy FK.
 */
export const MANUAL_SCHEDULE_NAME = "__engine_manual__";

export async function ensureManualSchedule(userId: string, workflowId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("scheduled_workflows")
    .select("id")
    .eq("user_id", userId)
    .eq("workflow_id", workflowId)
    .eq("name", MANUAL_SCHEDULE_NAME)
    .maybeSingle();

  if (existing?.id) {
    return existing.id as string;
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
    return data.id as string;
  }

  const { data: retry } = await supabase
    .from("scheduled_workflows")
    .select("id")
    .eq("user_id", userId)
    .eq("workflow_id", workflowId)
    .eq("name", MANUAL_SCHEDULE_NAME)
    .maybeSingle();

  if (retry?.id) {
    return retry.id as string;
  }

  throw new Error(error?.message ?? "Failed to ensure manual schedule for workflow_run");
}
