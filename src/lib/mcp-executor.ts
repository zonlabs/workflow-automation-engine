import type { WorkflowExecutionResult, WorkflowJobData } from "../domain/workflow";
import { createWorkflowExecutionService } from "../application/workflow/workflow-execution-service";

const workflowExecutionService = createWorkflowExecutionService();

export async function executeWorkflowJob(
  jobData: WorkflowJobData
): Promise<WorkflowExecutionResult> {
  return workflowExecutionService.execute(jobData);
}
