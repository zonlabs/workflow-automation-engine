import { supabase } from "../../lib/supabase";
import type { WorkflowRow } from "../../domain/workflow";

export class WorkflowDefinitionRepository {
  async fetchWorkflowDefinition(workflowId: string): Promise<WorkflowRow> {
    const { data, error } = await supabase
      .from("workflows")
      .select("id, toolkit_ids, script_code, script_runtime")
      .eq("id", workflowId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to load workflow definition: ${error?.message ?? "unknown error"}`);
    }

    return data as WorkflowRow;
  }
}
