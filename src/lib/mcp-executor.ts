import { MCPClient, MultiSessionClient, storage } from "@mcp-ts/sdk/server";
import { supabase } from "./supabase";
import { WorkflowJobData } from "./queue";
import { executeAIAgentStep } from "./ai/ai-agent";
import { evaluateAICondition } from "./ai/condition-evaluator";
import type { AIStepConfig, AIConditionConfig, AIAgentResult } from "./ai/types";

type JsonObject = Record<string, unknown>;

interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  step_number: number;
  name: string;
  toolkit: string;
  tool_slug: string;
  tool_arguments: JsonObject;
  depends_on_step_id: string | null;
  run_if_condition: JsonObject | null;
  retry_on_failure: boolean | null;
  max_retries: number | null;
  timeout_seconds: number | null;
}

interface StepExecutionResult {
  stepId: string;
  stepNumber: number;
  stepName: string;
  toolSlug: string;
  output: unknown;
  durationMs: number;
}

interface WorkflowExecutionResult {
  status: "success" | "failed";
  retryable: boolean;
  output: {
    params: Record<string, unknown>;
    steps: Record<number, StepExecutionResult>;
  };
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

class NonRetryableExecutionError extends Error {
  public readonly code: string;

  constructor(message: string, code = "NON_RETRYABLE_WORKFLOW_ERROR") {
    super(message);
    this.name = "NonRetryableExecutionError";
    this.code = code;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeError(err: unknown): { message: string; code?: string; stack?: string } {
  if (err instanceof NonRetryableExecutionError) {
    return { message: err.message, code: err.code, stack: err.stack };
  }

  if (err instanceof Error) {
    const withCode = err as Error & { code?: string };
    return { message: err.message, code: withCode.code, stack: err.stack };
  }

  return { message: "Unknown execution error", code: "UNKNOWN_ERROR" };
}

function parsePath(target: unknown, dottedPath: string): unknown {
  const segments = dottedPath.split(".").filter(Boolean);
  let current: unknown = target;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function isTransientError(err: unknown): boolean {
  const normalized = normalizeError(err);
  const haystack = `${normalized.code ?? ""} ${normalized.message}`.toLowerCase();
  const transientMarkers = [
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "enotfound",
    "eai_again",
    "429",
    "rate limit",
    "temporarily unavailable",
    "network",
    "socket hang up",
    "service unavailable",
  ];

  return transientMarkers.some((marker) => haystack.includes(marker));
}

function isAuthError(err: unknown): boolean {
  const normalized = normalizeError(err);
  const haystack = `${normalized.code ?? ""} ${normalized.message}`.toLowerCase();
  const authMarkers = ["unauthorized", "forbidden", "401", "403", "token", "expired", "oauth"];
  return authMarkers.some((marker) => haystack.includes(marker));
}

function getMcpToolErrorMessage(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const candidate = result as {
    isError?: boolean;
    content?: Array<{ text?: unknown }>;
  };

  if (candidate.isError !== true) {
    return null;
  }

  const firstContent = Array.isArray(candidate.content) ? candidate.content[0] : undefined;
  if (firstContent && typeof firstContent.text === "string" && firstContent.text.trim().length > 0) {
    return firstContent.text;
  }

  return "MCP tool call returned error response";
}

function resolveTemplateString(
  template: string,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepExecutionResult>
): unknown {
  const exactMatch = template.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (exactMatch) {
    const value = resolveExpression(exactMatch[1], params, stepOutputs);
    if (value === undefined) {
      throw new NonRetryableExecutionError(
        `Template variable "${exactMatch[1]}" could not be resolved`,
        "TEMPLATE_RESOLUTION_FAILED"
      );
    }
    return value;
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression: string) => {
    const value = resolveExpression(expression, params, stepOutputs);
    if (value === undefined) {
      throw new NonRetryableExecutionError(
        `Template variable "${expression}" could not be resolved`,
        "TEMPLATE_RESOLUTION_FAILED"
      );
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  });
}

function resolveExpression(
  rawExpression: string,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepExecutionResult>
): unknown {
  const expression = rawExpression.trim();

  if (expression.startsWith("params.")) {
    return parsePath(params, expression.slice("params.".length));
  }

  const stepMatch = expression.match(/^steps\.(\d+)\.(.+)$/);
  if (stepMatch) {
    const stepNumber = Number(stepMatch[1]);
    const path = stepMatch[2];
    const stepResult = stepOutputs[stepNumber];
    if (!stepResult) {
      return undefined;
    }
    return parsePath(stepResult, path);
  }

  return undefined;
}

function resolveVariables(
  value: unknown,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepExecutionResult>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveVariables(item, params, stepOutputs));
  }

  if (value && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolveVariables(nestedValue, params, stepOutputs);
    }
    return resolved;
  }

  if (typeof value === "string") {
    return resolveTemplateString(value, params, stepOutputs);
  }

  return value;
}

async function persistRefreshedSessionIfPossible(identity: string, sessionId: string, client: MCPClient) {
  const anyStorage = storage as unknown as {
    updateSession?: (...args: unknown[]) => Promise<unknown>;
    updateSessionData?: (...args: unknown[]) => Promise<unknown>;
  };
  const anyClient = client as unknown as {
    getSession?: () => unknown;
    getSessionData?: () => unknown;
  };

  const sessionData = anyClient.getSessionData?.() ?? anyClient.getSession?.();
  if (!sessionData) {
    return;
  }

  try {
    if (typeof anyStorage.updateSession === "function") {
      await anyStorage.updateSession(identity, sessionId, sessionData);
      return;
    }
    if (typeof anyStorage.updateSessionData === "function") {
      await anyStorage.updateSessionData(identity, sessionId, sessionData);
    }
  } catch {
    // Avoid masking execution success if persistence helper shape differs.
  }
}

async function callMcpTool(client: MCPClient, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const anyClient = client as unknown as {
    callTool?: (...params: unknown[]) => Promise<unknown>;
    executeTool?: (...params: unknown[]) => Promise<unknown>;
    request?: (payload: unknown) => Promise<unknown>;
  };

  if (typeof anyClient.callTool === "function") {
    return anyClient.callTool(toolName, args);
  }

  if (typeof anyClient.executeTool === "function") {
    return anyClient.executeTool(toolName, args);
  }

  if (typeof anyClient.request === "function") {
    return anyClient.request({
      jsonrpc: "2.0",
      id: `workflow-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    });
  }

  throw new NonRetryableExecutionError(
    "MCP client does not expose a supported tool execution method",
    "UNSUPPORTED_MCP_CLIENT"
  );
}

async function updateExecutionLog(
  executionLogId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("execution_logs").update(patch).eq("id", executionLogId);
  if (error) {
    throw new Error(`Failed to update execution log ${executionLogId}: ${error.message}`);
  }
}

async function fetchStepsForWorkflow(workflowId: string): Promise<WorkflowStepRow[]> {
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

async function assertSessionExists(identity: string, sessionId: string): Promise<void> {
  const sessions = await storage.getIdentitySessionsData(identity);
  const hasSession = sessions.some((session: { sessionId: string }) => session.sessionId === sessionId);
  if (!hasSession) {
    throw new NonRetryableExecutionError(
      `Session ${sessionId} was not found for identity ${identity}`,
      "MCP_SESSION_NOT_FOUND"
    );
  }
}

async function executeStepWithRetry(
  client: MCPClient,
  step: WorkflowStepRow,
  resolvedArgs: Record<string, unknown>,
  identity: string,
  sessionId: string
): Promise<unknown> {
  const maxRetries = Math.max(0, step.max_retries ?? 0);
  const allowRetries = step.retry_on_failure ?? true;
  const maxAttempts = allowRetries ? maxRetries + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await callMcpTool(client, step.tool_slug, resolvedArgs);
      const toolErrorMessage = getMcpToolErrorMessage(result);
      if (toolErrorMessage) {
        throw new NonRetryableExecutionError(
          `Step ${step.step_number} (${step.tool_slug}) returned MCP error: ${toolErrorMessage}`,
          "MCP_TOOL_CALL_ERROR"
        );
      }
      await persistRefreshedSessionIfPossible(identity, sessionId, client);
      return result;
    } catch (error) {
      const finalAttempt = attempt >= maxAttempts;
      const authFailure = isAuthError(error);
      const transientFailure = isTransientError(error);

      if (!finalAttempt && authFailure) {
        await client.disconnect(`auth-reconnect-step-${step.step_number}`);
        await client.connect();
      }

      if (!finalAttempt && (authFailure || transientFailure)) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
        const jitter = Math.floor(Math.random() * 300);
        await delay(backoff + jitter);
        continue;
      }

      if (transientFailure) {
        throw error;
      }

      throw new NonRetryableExecutionError(
        `Step ${step.step_number} (${step.tool_slug}) failed permanently: ${normalizeError(error).message}`,
        "STEP_EXECUTION_FAILED"
      );
    }
  }

  throw new Error("Unreachable step retry branch");
}

async function evaluateStepCondition(
  conditionJson: JsonObject,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepExecutionResult>
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
      reasoning: `Condition evaluation failed: ${err instanceof Error ? err.message : "unknown error"}; defaulting to execute`,
    };
  }
}

async function executeAIStep(
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
    throw new NonRetryableExecutionError(
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
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
        const jitter = Math.floor(Math.random() * 300);
        await delay(backoff + jitter);
        continue;
      }

      if (transientFailure) {
        throw error;
      }

      throw new NonRetryableExecutionError(
        `AI step ${step.step_number} (${step.name}) failed: ${normalizeError(error).message}`,
        "AI_STEP_EXECUTION_FAILED"
      );
    }
  }

  throw new Error("Unreachable AI step retry branch");
}

export async function executeWorkflowJob(jobData: WorkflowJobData): Promise<WorkflowExecutionResult> {
  const startedAt = Date.now();
  const context: WorkflowExecutionResult["output"] = { params: jobData.params ?? {}, steps: {} };

  if (!jobData.sessionId) {
    throw new NonRetryableExecutionError("sessionId is required in workflow job payload", "SESSION_ID_REQUIRED");
  }

  let client: MCPClient | null = null;
  let multiClient: MultiSessionClient | null = null;

  try {
    await updateExecutionLog(jobData.executionLogId, {
      status: "running",
      started_at: nowIso(),
      error_message: null,
      error_code: null,
      error_stack: null,
      retry_count: jobData.attempt ?? 0,
    });

    await assertSessionExists(jobData.userId, jobData.sessionId);

    const steps = await fetchStepsForWorkflow(jobData.workflowId);
    if (!steps.length) {
      throw new NonRetryableExecutionError(
        `No workflow steps found for workflow ${jobData.workflowId}`,
        "WORKFLOW_STEPS_EMPTY"
      );
    }

    client = new MCPClient({
      identity: jobData.userId,
      sessionId: jobData.sessionId,
    });
    await client.connect();

    const hasAISteps = steps.some((s) => s.toolkit === "ai");
    if (hasAISteps) {
      multiClient = new MultiSessionClient(jobData.userId);
      await multiClient.connect();
    }

    for (const step of steps) {
      if (step.depends_on_step_id) {
        const dependency = Object.values(context.steps).find(
          (stepOutput) => stepOutput.stepId === step.depends_on_step_id
        );
        if (!dependency) {
          throw new NonRetryableExecutionError(
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
          continue;
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
        const aiResult = await executeAIStep(
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
        output = await executeStepWithRetry(
          client,
          step,
          resolvedArgs,
          jobData.userId,
          jobData.sessionId
        );
      }

      context.steps[step.step_number] = {
        stepId: step.id,
        stepNumber: step.step_number,
        stepName: step.name,
        toolSlug: step.tool_slug,
        output,
        durationMs: Date.now() - stepStartedAt,
      };
    }

    await updateExecutionLog(jobData.executionLogId, {
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
    const normalized = normalizeError(error);
    const retryable = !(error instanceof NonRetryableExecutionError) && isTransientError(error);

    try {
      await updateExecutionLog(jobData.executionLogId, {
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
