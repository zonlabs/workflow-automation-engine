import { supabase } from "../../lib/supabase";
import type { ExecutionLogSummaryRow } from "../../domain/workflow";

export class WorkflowMcpRepository {
  async listWorkflows(userId: string, limit: number) {
    const { data, error } = await supabase
      .from("workflows")
      .select("id, name, description, is_active, created_at, toolkit_ids, script_code, scheduled_workflows(id)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      is_active: boolean;
      created_at: string;
      toolkit_ids: string[] | null;
      script_code: string | null;
      scheduled_workflows: Array<{ id: string }>;
    }>;
  }

  async listExecutionLogSummaries(userId: string, workflowIds: string[]) {
    if (!workflowIds.length) {
      return [] as ExecutionLogSummaryRow[];
    }

    const { data, error } = await supabase
      .from("execution_logs")
      .select(
        "workflow_id, status, created_at, completed_at, duration_ms, error_message, triggered_by"
      )
      .eq("user_id", userId)
      .in("workflow_id", workflowIds)
      .order("created_at", { ascending: false })
      .limit(2500);

    if (error || !data) {
      return [] as ExecutionLogSummaryRow[];
    }

    return data as ExecutionLogSummaryRow[];
  }

  async listExecutionLogs(userId: string, workflowId: string | undefined, limit: number) {
    let query = supabase
      .from("execution_logs")
      .select(
        "id, workflow_id, scheduled_workflow_id, status, triggered_by, started_at, completed_at, duration_ms, error_message, error_code, input_data, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (workflowId?.trim()) {
      query = query.eq("workflow_id", workflowId.trim());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return data ?? [];
  }

  async getWorkflowName(userId: string, workflowId: string): Promise<string | undefined> {
    const { data } = await supabase
      .from("workflows")
      .select("name")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .maybeSingle();

    return data?.name ?? undefined;
  }

  async fetchExecutionLogWithName(executionLogId: string, userId: string) {
    const { data, error } = await supabase
      .from("execution_logs")
      .select("*")
      .eq("id", executionLogId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return null;
    }

    const workflowId = (data as { workflow_id?: string }).workflow_id;
    let workflowName: string | undefined;
    if (workflowId) {
      workflowName = await this.getWorkflowName(userId, workflowId);
    }

    return {
      data: data as Record<string, unknown>,
      workflow_name: workflowName,
    };
  }

  async waitForExecutionLogCompletion(
    executionLogId: string,
    userId: string,
    timeoutMs: number
  ) {
    const startTime = Date.now();
    return new Promise<{ data: Record<string, unknown>; workflow_name?: string } | null>(
      (resolve, reject) => {
        const channelName = `exec-log-wait-${executionLogId}-${Date.now()}`;
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            supabase.removeChannel(channel);
          } catch {
            // Ignore cleanup failures.
          }
          this.fetchExecutionLogWithName(executionLogId, userId).then(resolve).catch(reject);
        }, Math.max(0, timeoutMs - (Date.now() - startTime)));

        const channel = supabase
          .channel(channelName)
          .on(
            "postgres_changes" as never,
            {
              event: "UPDATE",
              schema: "public",
              table: "execution_logs",
              filter: `id=eq.${executionLogId}`,
            },
            (payload: { new?: Record<string, unknown> }) => {
              if (settled) return;
              const status = payload.new?.status;
              if (
                typeof status === "string" &&
                new Set(["success", "failed", "timeout", "cancelled"]).has(status)
              ) {
                settled = true;
                clearTimeout(timer);
                try {
                  supabase.removeChannel(channel);
                } catch {
                  // Ignore cleanup failures.
                }
                this.fetchExecutionLogWithName(executionLogId, userId).then(resolve).catch(reject);
              }
            }
          )
          .subscribe((status: string) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              try {
                supabase.removeChannel(channel);
              } catch {
                // Ignore cleanup failures.
              }
              reject(new Error(`Realtime channel ${status}`));
            }
          });
      }
    );
  }

  async getWorkflowDetail(userId: string, workflowId: string) {
    const { data, error } = await supabase
      .from("workflows")
      .select(
        `id, name, description, is_active, created_at, input_schema, output_schema, script_code, defaults_for_required_parameters,
         toolkit_ids, script_runtime,
         scheduled_workflows(id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at)`
      )
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async upsertScriptWorkflow(input: {
    userId: string;
    workflowId?: string;
    name: string;
    description?: string;
    scriptCode: string;
    scriptRuntime?: Record<string, unknown>;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    isActive?: boolean;
  }) {
    const payload = {
      user_id: input.userId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      workflow: [],
      input_schema: input.inputSchema,
      output_schema: input.outputSchema,
      defaults_for_required_parameters: input.defaults ?? {},
      script_runtime: input.scriptRuntime ?? {},
      script_code: input.scriptCode,
      is_active: input.isActive ?? true,
    };

    if (input.workflowId) {
      const { data, error } = await supabase
        .from("workflows")
        .update(payload)
        .eq("id", input.workflowId)
        .eq("user_id", input.userId)
        .select("id, name, description, is_active, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Update failed");
      }

      return data;
    }

    const { data, error } = await supabase
      .from("workflows")
      .insert(payload)
      .select("id, name, description, is_active, created_at")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Create failed");
    }

    return data;
  }

  async upsertSchedule(input: {
    userId: string;
    workflowId: string;
    scheduleId?: string;
    name: string;
    cronExpression: string;
    cronTimezone: string;
    status: string;
    isEnabled: boolean;
    params: Record<string, unknown>;
  }) {
    const payload = {
      workflow_id: input.workflowId,
      user_id: input.userId,
      name: input.name,
      cron_expression: input.cronExpression,
      cron_timezone: input.cronTimezone,
      status: input.status,
      is_enabled: input.isEnabled,
      params: input.params,
    };

    if (input.scheduleId) {
      const { data, error } = await supabase
        .from("scheduled_workflows")
        .update(payload)
        .eq("id", input.scheduleId)
        .eq("user_id", input.userId)
        .select("id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Update failed");
      }

      return data;
    }

    const { data, error } = await supabase
      .from("scheduled_workflows")
      .insert(payload)
      .select("id, name, cron_expression, cron_timezone, status, is_enabled, params, created_at")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Create failed");
    }

    return data;
  }

  async getActiveWorkflow(workflowId: string, userId: string) {
    const { data, error } = await supabase
      .from("workflows")
      .select("id, is_active")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return null;
    }

    return { id: String(data.id), is_active: Boolean(data.is_active) };
  }

  async validateScheduledWorkflow(
    scheduledWorkflowId: string,
    userId: string
  ): Promise<{ id: string; workflow_id: string } | null> {
    const { data, error } = await supabase
      .from("scheduled_workflows")
      .select("id, workflow_id")
      .eq("id", scheduledWorkflowId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: String(data.id),
      workflow_id: String(data.workflow_id),
    };
  }
}
