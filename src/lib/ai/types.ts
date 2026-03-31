export type AIRole = "system" | "user" | "assistant" | "tool";

export interface AIMessage {
  role: AIRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: AIToolCall[];
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  is_error?: boolean;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AIResponseFormat {
  type: "text" | "json_object" | "json_schema";
  schema?: Record<string, unknown>;
}

export interface AIStepConfig {
  system_prompt: string;
  user_prompt: string;
  temperature?: number;
  max_tokens?: number;
  max_iterations?: number;
  available_tools?: string[];
  response_format?: AIResponseFormat;
}

export interface AIConditionConfig {
  provider?: string;
  model?: string;
  prompt: string;
  context_steps?: number[];
}

export interface AIUsageMetrics {
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tool_calls_count: number;
  iterations: number;
  estimated_cost_usd?: number;
}

export interface AIAgentToolCallLog {
  iteration: number;
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  result_preview: string;
  duration_ms: number;
  is_error: boolean;
}

export interface AIAgentResult {
  content: string;
  parsed_output: unknown;
  usage: AIUsageMetrics;
  tool_call_log: AIAgentToolCallLog[];
  reasoning_trace: string[];
}

export interface AIConditionResult {
  should_execute: boolean;
  reasoning: string;
  usage: AIUsageMetrics;
}

export interface ChatParams {
  messages: AIMessage[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: AIResponseFormat;
}

export interface ChatResponse {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason: string;
}

export interface ChatWithToolsParams extends ChatParams {
  tools: AIToolDefinition[];
}

export interface ToolChatResponse {
  content: string | null;
  tool_calls: AIToolCall[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason: string;
}

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro-preview-05-06": { input: 1.25, output: 10 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number | undefined {
  const cost = COST_PER_MILLION[model];
  if (!cost) return undefined;
  return (
    (promptTokens / 1_000_000) * cost.input +
    (completionTokens / 1_000_000) * cost.output
  );
}
