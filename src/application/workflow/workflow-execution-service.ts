import { MCPClient, MultiSessionClient } from "@mcp-ts/sdk/server";
import { evaluateAICondition } from "../../lib/ai/condition-evaluator";
import type {
  AIConditionConfig,
  AIAgentResult,
} from "../../lib/ai/types";
import type {
  WorkflowExecutionContext,
  WorkflowExecutionResult,
  WorkflowJobData,
  WorkflowStepRow,
} from "../../domain/workflow";
import {
  createPermanentWorkflowError,
  normalizeWorkflowError,
  WorkflowExecutionError,
} from "../../domain/workflow-errors";
import { McpSessionResolver } from "../../infrastructure/mcp/session-resolver";
import { ExecutionLogRepository } from "../../infrastructure/supabase/execution-log-repository";
import { WorkflowDefinitionRepository } from "../../infrastructure/supabase/workflow-definition-repository";
import { nowIso, isTransientError } from "./retry-policy";
import { resolveVariables } from "./template-resolution-service";
import {
  buildStepResult,
  executeWorkflowAiStep,
  executeWorkflowMcpStep,
} from "./workflow-step-runner-service";
import { executeScriptWorkflow } from "./workflow-script-service";

async function evaluateStepCondition(
  conditionJson: Record<string, unknown>,
  params: Record<string, unknown>,
  stepOutputs: WorkflowExecutionContext["steps"]
): Promise<{ should_execute: boolean; reasoning: string; usage?: unknown }> {
  const condition = conditionJson as unknown as AIConditionConfig;

  if (!condition.prompt) {
    console.warn("[mcp-executor] run_if_condition has no prompt; defaulting to execute");
    return { should_execute: true, reasoning: "No condition prompt provided" };
  }

  try {
    return await evaluateAICondition(condition, params, stepOutputs);
  } catch (err) {
    console.error("[mcp-executor] AI condition evaluation failed; defaulting to execute", err);
    return {
      should_execute: true,
      reasoning: `Condition evaluation failed: ${
        err instanceof Error ? err.message : "unknown error"
      }; defaulting to execute`,
    };
  }
}

export class WorkflowExecutionService {
  constructor(
    private readonly deps: {
      workflowRepository: WorkflowDefinitionRepository;
      executionLogRepository: ExecutionLogRepository;
      sessionResolver: McpSessionResolver;
    } = {
      workflowRepository: new WorkflowDefinitionRepository(),
      executionLogRepository: new ExecutionLogRepository(),
      sessionResolver: new McpSessionResolver(),
    }
  ) {}

  async execute(jobData: WorkflowJobData): Promise<WorkflowExecutionResult> {
    const startedAt = Date.now();
    const context: WorkflowExecutionContext = { params: jobData.params ?? {}, steps: {} };

    console.log("[mcp-executor] Starting workflow job", {
      workflowId: jobData.workflowId,
      scheduledWorkflowId: jobData.scheduledWorkflowId,
      executionLogId: jobData.executionLogId,
      userId: jobData.userId,
      sessionId: jobData.sessionId,
      triggeredBy: jobData.triggeredBy,
      attempt: jobData.attempt ?? 0,
      runnerMode: process.env.WORKFLOW_SCRIPT_RUNNER_MODE ?? "local",
    });

    if (!jobData.sessionId) {
      throw createPermanentWorkflowError(
        "sessionId is required in workflow job payload",
        "SESSION_ID_REQUIRED"
      );
    }

    let client: MCPClient | null = null;
    let multiClient: MultiSessionClient | null = null;

    try {
      await this.deps.executionLogRepository.updateExecutionLog(jobData.executionLogId, {
        status: "running",
        started_at: nowIso(),
        error_message: null,
        error_code: null,
        error_stack: null,
        retry_count: jobData.attempt ?? 0,
      });

      try {
        await this.deps.sessionResolver.assertSessionExists(jobData.userId, jobData.sessionId);
      } catch (err) {
        throw createPermanentWorkflowError(
          err instanceof Error ? err.message : "Session lookup failed",
          "MCP_SESSION_NOT_FOUND",
          err
        );
      }

      const workflow = await this.deps.workflowRepository.fetchWorkflowDefinition(jobData.workflowId);
      const hasScript =
        typeof workflow.script_code === "string" && workflow.script_code.trim().length > 0;

      if (hasScript) {
        return await executeScriptWorkflow(
          jobData,
          workflow,
          context,
          startedAt,
          this.deps.executionLogRepository
        );
      }

      const steps = await this.deps.workflowRepository.fetchStepsForWorkflow(jobData.workflowId);
      if (!steps.length) {
        throw createPermanentWorkflowError(
          `No workflow steps found for workflow ${jobData.workflowId}`,
          "WORKFLOW_STEPS_EMPTY"
        );
      }

      client = new MCPClient({
        identity: jobData.userId,
        sessionId: jobData.sessionId,
      });
      await client.connect();

      const hasAISteps = steps.some((step) => step.toolkit === "ai");
      if (hasAISteps) {
        multiClient = new MultiSessionClient(jobData.userId);
        await multiClient.connect();
      }

      for (const step of steps) {
        await this.runStep({
          step,
          context,
          jobData,
          client,
          multiClient,
        });
      }

      await this.deps.executionLogRepository.updateExecutionLog(jobData.executionLogId, {
        status: "success",
        output_data: context,
        completed_at: nowIso(),
        duration_ms: Date.now() - startedAt,
        error_message: null,
        error_code: null,
        error_stack: null,
      });

      return {
        status: "success",
        retryable: false,
        output: context,
      };
    } catch (error) {
      const normalized = normalizeWorkflowError(error);
      const retryable =
        !(error instanceof WorkflowExecutionError) && isTransientError(error);
      console.error("[mcp-executor] Workflow job failed", {
        workflowId: jobData.workflowId,
        executionLogId: jobData.executionLogId,
        message: normalized.message,
        code: normalized.code ?? null,
        retryable,
      });

      try {
        await this.deps.executionLogRepository.updateExecutionLog(jobData.executionLogId, {
          status: "failed",
          completed_at: nowIso(),
          duration_ms: Date.now() - startedAt,
          error_message: normalized.message,
          error_code: normalized.code ?? (retryable ? "TRANSIENT_FAILURE" : "PERMANENT_FAILURE"),
          error_stack: normalized.stack ? { stack: normalized.stack } : null,
        });
      } catch (logError) {
        console.error("[mcp-executor] Failed to write final execution log", logError);
      }

      if (retryable) {
        throw error;
      }

      return {
        status: "failed",
        retryable: false,
        output: context,
        error: normalized,
      };
    } finally {
      console.log("[mcp-executor] Finished workflow job", {
        workflowId: jobData.workflowId,
        executionLogId: jobData.executionLogId,
        durationMs: Date.now() - startedAt,
      });
      if (multiClient) {
        try {
          multiClient.disconnect();
        } catch {
          // Ignore disconnect failures.
        }
      }
      if (client) {
        try {
          await client.disconnect("workflow-execution-complete");
        } catch {
          // Ignore disconnect failures.
        }
        try {
          client.dispose();
        } catch {
          // Ignore dispose failures.
        }
      }
    }
  }

  private async runStep(input: {
    step: WorkflowStepRow;
    context: WorkflowExecutionContext;
    jobData: WorkflowJobData;
    client: MCPClient;
    multiClient: MultiSessionClient | null;
  }): Promise<void> {
    const { step, context, jobData, client, multiClient } = input;

    if (step.depends_on_step_id) {
      const dependency = Object.values(context.steps).find(
        (stepOutput) => stepOutput.stepId === step.depends_on_step_id
      );
      if (!dependency) {
        throw createPermanentWorkflowError(
          `Step ${step.step_number} depends on ${step.depends_on_step_id}, but dependency did not produce output`,
          "STEP_DEPENDENCY_UNMET"
        );
      }
    }

    if (step.run_if_condition) {
      const conditionResult = await evaluateStepCondition(
        step.run_if_condition,
        context.params,
        context.steps
      );
      if (!conditionResult.should_execute) {
        console.log(
          `[mcp-executor] Skipping step ${step.step_number} (${step.name}): ${conditionResult.reasoning}`
        );
        context.steps[step.step_number] = {
          stepId: step.id,
          stepNumber: step.step_number,
          stepName: step.name,
          toolSlug: step.tool_slug,
          output: {
            _skipped: true,
            _condition_reasoning: conditionResult.reasoning,
            _condition_usage: conditionResult.usage,
          },
          durationMs: 0,
        };
        return;
      }
    }

    const stepStartedAt = Date.now();
    const resolvedArgs = resolveVariables(
      step.tool_arguments ?? {},
      context.params,
      context.steps
    ) as Record<string, unknown>;

    let output: unknown;
    if (step.toolkit === "ai") {
      const aiResult: AIAgentResult = await executeWorkflowAiStep(
        step,
        resolvedArgs,
        multiClient ?? client
      );
      output = {
        content: aiResult.content,
        parsed_output: aiResult.parsed_output,
        tool_call_log: aiResult.tool_call_log,
        reasoning_trace: aiResult.reasoning_trace,
        ai_usage: aiResult.usage,
      };
    } else {
      output = await executeWorkflowMcpStep(
        client,
        step,
        resolvedArgs,
        jobData.userId,
        jobData.sessionId
      );
    }

    context.steps[step.step_number] = buildStepResult({
      step,
      output,
      startedAt: stepStartedAt,
    });
  }
}

export function createWorkflowExecutionService(): WorkflowExecutionService {
  return new WorkflowExecutionService();
}
