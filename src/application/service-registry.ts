import { WorkflowExecutionService } from "./workflow/workflow-execution-service";
import { WorkflowToolService } from "./mcp/workflow-tool-service";
import { ExecutionEnqueueService } from "./scheduling/execution-enqueue-service";
import { SchedulerTickService } from "./scheduling/scheduler-tick-service";
import { ScriptHelperService } from "./script-helper/script-helper-service";
import { WorkflowDefinitionRepository } from "../infrastructure/supabase/workflow-definition-repository";
import { ExecutionLogRepository } from "../infrastructure/supabase/execution-log-repository";
import { ScheduleRepository } from "../infrastructure/supabase/schedule-repository";
import { WorkflowQueueGateway } from "../infrastructure/queue/workflow-queue-gateway";
import { McpSessionResolver } from "../infrastructure/mcp/session-resolver";
import { WorkflowMcpRepository } from "../infrastructure/supabase/workflow-mcp-repository";

const workflowDefinitionRepository = new WorkflowDefinitionRepository();
const executionLogRepository = new ExecutionLogRepository();
const scheduleRepository = new ScheduleRepository();
const queueGateway = new WorkflowQueueGateway();
const sessionResolver = new McpSessionResolver();
const workflowMcpRepository = new WorkflowMcpRepository();

const workflowToolService = new WorkflowToolService(workflowMcpRepository);
const executionEnqueueService = new ExecutionEnqueueService({
  scheduleRepository,
  executionLogRepository,
  queueGateway,
  sessionResolver,
  workflowLookup: workflowToolService,
});

export const serviceRegistry = {
  workflowExecutionService: new WorkflowExecutionService({
    workflowRepository: workflowDefinitionRepository,
    executionLogRepository,
    sessionResolver,
  }),
  workflowToolService,
  executionEnqueueService,
  schedulerTickService: new SchedulerTickService({
    scheduleRepository,
    executionEnqueueService,
    sessionResolver,
  }),
  scriptHelperService: new ScriptHelperService(),
  scheduleRepository,
  executionLogRepository,
};
