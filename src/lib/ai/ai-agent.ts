import type { MCPClient } from "@mcp-ts/sdk/server";
import type {
  AIStepConfig,
  AIMessage,
  AIAgentResult,
  AIAgentToolCallLog,
  AIUsageMetrics,
} from "./types";
import { estimateCostUsd } from "./types";
import { resolveProviderAndModel } from "./provider-registry";
import { listMcpToolsAsAITools, callMcpToolFromAI } from "./tool-adapter";

const MAX_ITERATIONS = Number(process.env.AI_MAX_ITERATIONS ?? "15");
const MAX_TOKENS_PER_STEP = Number(process.env.AI_MAX_TOKENS_PER_STEP ?? "16384");
const AGENT_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT_MS ?? "120000");

const RESULT_PREVIEW_LIMIT = 2000;

export async function executeAIAgentStep(
  config: AIStepConfig,
  toolSlug: string,
  mcpClient: MCPClient | null
): Promise<AIAgentResult> {
  const { provider, providerName, model } = resolveProviderAndModel(toolSlug);

  const maxIterations = config.max_iterations ?? MAX_ITERATIONS;
  const maxTokens = config.max_tokens ?? MAX_TOKENS_PER_STEP;

  const aiTools =
    mcpClient && config.available_tools?.length
      ? await listMcpToolsAsAITools(mcpClient, config.available_tools)
      : [];

  const hasTools = aiTools.length > 0;

  const messages: AIMessage[] = [
    { role: "system", content: config.system_prompt },
    { role: "user", content: config.user_prompt },
  ];

  const toolCallLog: AIAgentToolCallLog[] = [];
  const reasoningTrace: string[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let iterations = 0;

  const deadline = Date.now() + AGENT_TIMEOUT_MS;

  while (iterations < maxIterations) {
    if (Date.now() > deadline) {
      reasoningTrace.push(
        `[timeout] Agent exceeded ${AGENT_TIMEOUT_MS}ms deadline after ${iterations} iterations`
      );
      break;
    }

    iterations++;

    if (hasTools) {
      const response = await provider.chatWithTools({
        messages,
        model,
        temperature: config.temperature,
        max_tokens: maxTokens,
        tools: aiTools,
        response_format: config.response_format,
      });

      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;

      if (response.tool_calls.length === 0) {
        if (response.content) {
          reasoningTrace.push(`[final] Agent produced final answer on iteration ${iterations}`);
        }
        const parsed = tryParseJson(response.content ?? "");
        return buildResult(
          response.content ?? "",
          parsed,
          providerName,
          model,
          totalPromptTokens,
          totalCompletionTokens,
          toolCallLog,
          reasoningTrace,
          iterations
        );
      }

      reasoningTrace.push(
        `[iter ${iterations}] AI requested ${response.tool_calls.length} tool call(s): ${response.tool_calls.map((tc) => tc.name).join(", ")}`
      );

      const assistantMessage: AIMessage = {
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.tool_calls,
      };
      messages.push(assistantMessage);

      for (const toolCall of response.tool_calls) {
        const callStart = Date.now();
        let callResult: { result: string; is_error: boolean };

        if (mcpClient) {
          callResult = await callMcpToolFromAI(
            mcpClient,
            toolCall.name,
            toolCall.arguments
          );
        } else {
          callResult = {
            result: `Tool "${toolCall.name}" unavailable: no MCP client connected`,
            is_error: true,
          };
        }

        const durationMs = Date.now() - callStart;

        toolCallLog.push({
          iteration: iterations,
          tool_name: toolCall.name,
          tool_arguments: toolCall.arguments,
          result_preview: callResult.result.slice(0, RESULT_PREVIEW_LIMIT),
          duration_ms: durationMs,
          is_error: callResult.is_error,
        });

        reasoningTrace.push(
          `[iter ${iterations}] Tool ${toolCall.name} → ${callResult.is_error ? "ERROR" : "OK"} (${durationMs}ms)`
        );

        messages.push({
          role: "tool",
          content: callResult.result,
          tool_call_id: toolCall.id,
        });
      }
    } else {
      const response = await provider.chat({
        messages,
        model,
        temperature: config.temperature,
        max_tokens: maxTokens,
        response_format: config.response_format,
      });

      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;

      reasoningTrace.push(`[final] Completion-only mode, produced answer on iteration ${iterations}`);

      const parsed = tryParseJson(response.content);
      return buildResult(
        response.content,
        parsed,
        providerName,
        model,
        totalPromptTokens,
        totalCompletionTokens,
        toolCallLog,
        reasoningTrace,
        iterations
      );
    }
  }

  reasoningTrace.push(
    `[limit] Agent reached max iterations (${maxIterations}) without final answer. Returning last state.`
  );

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const fallbackContent =
    lastAssistant?.content || "Agent did not produce a final answer within iteration limit.";

  return buildResult(
    fallbackContent,
    tryParseJson(fallbackContent),
    providerName,
    model,
    totalPromptTokens,
    totalCompletionTokens,
    toolCallLog,
    reasoningTrace,
    iterations
  );
}

function buildResult(
  content: string,
  parsed: unknown,
  providerName: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  toolCallLog: AIAgentToolCallLog[],
  reasoningTrace: string[],
  iterations: number
): AIAgentResult {
  const usage: AIUsageMetrics = {
    provider: providerName,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    tool_calls_count: toolCallLog.length,
    iterations,
    estimated_cost_usd: estimateCostUsd(model, promptTokens, completionTokens),
  };

  return {
    content,
    parsed_output: parsed,
    usage,
    tool_call_log: toolCallLog,
    reasoning_trace: reasoningTrace,
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
