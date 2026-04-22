import { supabase } from "../../lib/supabase";
import type {
  WorkflowRow,
  WorkflowStepRow,
} from "../../domain/workflow";

export class WorkflowDefinitionRepository {
  async fetchWorkflowDefinition(workflowId: string): Promise<WorkflowRow> {
    const { data, error } = await supabase
      .from("workflows")
      .select("id, script_code, script_runtime")
      .eq("id", workflowId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to load workflow definition: ${error?.message ?? "unknown error"}`);
    }

    return data as WorkflowRow;
  }

  async fetchStepsForWorkflow(workflowId: string): Promise<WorkflowStepRow[]> {
    const { data: steps, error } = await supabase
      .from("workflow_steps")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("step_number", { ascending: true });

    if (error) {
      throw new Error(`Failed to load workflow steps: ${error.message}`);
    }

    return (steps ?? []) as WorkflowStepRow[];
  }
}
