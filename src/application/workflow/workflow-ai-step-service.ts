import type { MCPClient, MultiSessionClient } from "@mcp-ts/sdk/server";
import type { AIStepConfig, AIAgentResult } from "../../lib/ai/types";
import { executeAIAgentStep } from "../../lib/ai/ai-agent";
import type { WorkflowStepRow } from "../../domain/workflow";
import { createPermanentWorkflowError, normalizeWorkflowError } from "../../domain/workflow-errors";
import { delay, getRetryDelayMs, isTransientError } from "./retry-policy";

export async function executeWorkflowAiStep(
  step: WorkflowStepRow,
  resolvedArgs: Record<string, unknown>,
  mcpClient: MCPClient | MultiSessionClient | null
): Promise<AIAgentResult> {
  const aiConfig: AIStepConfig = {
    system_prompt:
      (resolvedArgs.system_prompt as string) ?? "You are a helpful AI assistant.",
    user_prompt: (resolvedArgs.user_prompt as string) ?? "",
    temperature: resolvedArgs.temperature as number | undefined,
    max_tokens: resolvedArgs.max_tokens as number | undefined,
    max_iterations: resolvedArgs.max_iterations as number | undefined,
    available_tools: resolvedArgs.available_tools as string[] | undefined,
    response_format: resolvedArgs.response_format as AIStepConfig["response_format"],
  };

  if (!aiConfig.user_prompt) {
    throw createPermanentWorkflowError(
      `AI step ${step.step_number} (${step.name}) requires a "user_prompt" in tool_arguments`,
      "AI_STEP_MISSING_PROMPT"
    );
  }

  const maxRetries = Math.max(0, step.max_retries ?? 1);
  const allowRetries = step.retry_on_failure ?? true;
  const maxAttempts = allowRetries ? maxRetries + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await executeAIAgentStep(aiConfig, step.tool_slug, mcpClient);
    } catch (error) {
      const finalAttempt = attempt >= maxAttempts;
      const transientFailure = isTransientError(error);

      if (!finalAttempt && transientFailure) {
        await delay(getRetryDelayMs(attempt));
        continue;
      }

      if (transientFailure) {
        throw error;
      }

      throw createPermanentWorkflowError(
        `AI step ${step.step_number} (${step.name}) failed: ${normalizeWorkflowError(error).message}`,
        "AI_STEP_EXECUTION_FAILED",
        error
      );
    }
  }

  throw new Error("Unreachable AI step retry branch");
}
