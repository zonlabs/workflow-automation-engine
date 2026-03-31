import { generateText, stepCountIs } from "ai";
import type { ToolSet, StepResult } from "ai";
import { AIAdapter } from "@mcp-ts/sdk/adapters/ai";
import type { MCPClient, MultiSessionClient } from "@mcp-ts/sdk/server";
import type {
  AIStepConfig,
  AIAgentResult,
  AIAgentToolCallLog,
  AIUsageMetrics,
} from "./types";
import { estimateCostUsd } from "./types";
import { resolveModel } from "./provider-registry";

const MAX_ITERATIONS = Number(process.env.AI_MAX_ITERATIONS ?? "15");
const MAX_TOKENS_PER_STEP = Number(process.env.AI_MAX_TOKENS_PER_STEP ?? "16384");
const AGENT_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT_MS ?? "120000");
const RESULT_PREVIEW_LIMIT = 2000;

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "deepseek-chat": 8192,
  "deepseek-reasoner": 8192,
  "gpt-4o": 16384,
  "gpt-4o-mini": 16384,
  "gpt-4.1": 32768,
  "gpt-4.1-mini": 32768,
  "gpt-4.1-nano": 32768,
  "claude-sonnet-4-20250514": 8192,
  "claude-3-5-haiku-20241022": 8192,
  "gemini-2.0-flash": 8192,
};

export async function executeAIAgentStep(
  config: AIStepConfig,
  toolSlug: string,
  mcpClient: MCPClient | MultiSessionClient | null
): Promise<AIAgentResult> {
  const { model, providerName, modelId } = resolveModel(toolSlug);
  const maxIterations = config.max_iterations ?? MAX_ITERATIONS;
  const modelCap = MODEL_MAX_OUTPUT_TOKENS[modelId] ?? 8192;
  const maxTokens = Math.min(config.max_tokens ?? MAX_TOKENS_PER_STEP, modelCap);

  let tools: ToolSet = {};
  if (mcpClient && config.available_tools?.length) {
    const allTools = await AIAdapter.getTools(mcpClient, { prefix: "mcp" });
    if (config.available_tools.includes("*")) {
      tools = allTools;
    } else {
      const allowed = new Set(config.available_tools);
      tools = Object.fromEntries(
        Object.entries(allTools).filter(([name]) => {
          const baseName = name.replace(/^tool_mcp_/, "");
          return allowed.has(name) || allowed.has(baseName);
        })
      );
    }
  }

  const hasTools = Object.keys(tools).length > 0;
  const toolCallLog: AIAgentToolCallLog[] = [];
  const reasoningTrace: string[] = [];
  let stepIndex = 0;

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
    reasoningTrace.push(
      `[timeout] Agent exceeded ${AGENT_TIMEOUT_MS}ms deadline`
    );
  }, AGENT_TIMEOUT_MS);

  try {
    const result = await generateText({
      model,
      system: config.system_prompt,
      prompt: config.user_prompt,
      tools: hasTools ? tools : undefined,
      stopWhen: hasTools ? stepCountIs(maxIterations) : stepCountIs(1),
      maxRetries: 2,
      maxOutputTokens: maxTokens,
      temperature: config.temperature,
      abortSignal: abortController.signal,
      onStepFinish: (event: StepResult<ToolSet>) => {
        stepIndex++;
        if (event.toolCalls?.length) {
          reasoningTrace.push(
            `[step ${stepIndex}] AI called ${event.toolCalls.length} tool(s): ${event.toolCalls.map((tc) => tc.toolName).join(", ")}`
          );
          for (const tc of event.toolCalls) {
            toolCallLog.push({
              iteration: stepIndex,
              tool_name: tc.toolName,
              tool_arguments: (tc.input ?? {}) as Record<string, unknown>,
              result_preview: "",
              duration_ms: 0,
              is_error: false,
            });
          }
        }
        if (event.toolResults?.length) {
          for (const tr of event.toolResults) {
            const outputVal = tr.output;
            const preview = typeof outputVal === "string"
              ? outputVal.slice(0, RESULT_PREVIEW_LIMIT)
              : JSON.stringify(outputVal).slice(0, RESULT_PREVIEW_LIMIT);
            const logEntry = toolCallLog.find(
              (e) => e.iteration === stepIndex && e.tool_name === tr.toolName && !e.result_preview
            );
            if (logEntry) {
              logEntry.result_preview = preview;
            }
          }
        }
        if (event.text && !event.toolCalls?.length) {
          reasoningTrace.push(`[step ${stepIndex}] AI produced final text response`);
        }
      },
    });

    reasoningTrace.push(
      `[done] Finished after ${result.steps.length} step(s), reason: ${result.finishReason}`
    );

    const inputTokens = result.totalUsage.inputTokens ?? 0;
    const outputTokens = result.totalUsage.outputTokens ?? 0;

    const usage: AIUsageMetrics = {
      provider: providerName,
      model: modelId,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      tool_calls_count: toolCallLog.length,
      iterations: result.steps.length,
      estimated_cost_usd: estimateCostUsd(modelId, inputTokens, outputTokens),
    };

    const parsed = tryParseJson(result.text);

    return {
      content: result.text,
      parsed_output: parsed,
      usage,
      tool_call_log: toolCallLog,
      reasoning_trace: reasoningTrace,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
