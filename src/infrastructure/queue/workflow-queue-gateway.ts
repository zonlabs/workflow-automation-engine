import type { JobsOptions } from "bullmq";
import type { WorkflowJobData } from "../../domain/workflow";
import { enqueueWorkflowExecution } from "../../lib/queue";

export class WorkflowQueueGateway {
  enqueue(payload: WorkflowJobData, options: JobsOptions = {}) {
    return enqueueWorkflowExecution(payload, options);
  }
}
