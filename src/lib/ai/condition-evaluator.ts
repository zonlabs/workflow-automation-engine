import type { AIConditionConfig, AIConditionResult, AIUsageMetrics } from "./types";
import { estimateCostUsd } from "./types";
import {
  resolveProviderAndModel,
  getDefaultProviderName,
  getDefaultModel,
} from "./provider-registry";

interface StepOutput {
  stepId: string;
  stepNumber: number;
  stepName: string;
  toolSlug: string;
  output: unknown;
}

const CONTEXT_CHAR_LIMIT = 12_000;

const CONDITION_SYSTEM_PROMPT = `You are a workflow condition evaluator. Your ONLY job is to decide whether a workflow step should execute based on the provided context.

You MUST respond with valid JSON in exactly this format:
{"should_execute": true, "reasoning": "Brief explanation of your decision"}

Rules:
- "should_execute" must be a boolean (true or false).
- "reasoning" must be a short string (1-2 sentences) explaining your decision.
- Do NOT include any other fields or text outside the JSON object.`;

export async function evaluateAICondition(
  condition: AIConditionConfig,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepOutput>
): Promise<AIConditionResult> {
  const providerSlug = buildProviderSlug(condition);
  const { provider, providerName, model } = resolveProviderAndModel(providerSlug);

  const contextSummary = buildContextSummary(
    condition,
    params,
    stepOutputs
  );

  const userPrompt = `## Condition to evaluate
${condition.prompt}

## Workflow context
${contextSummary}

Respond with JSON: {"should_execute": <boolean>, "reasoning": "<explanation>"}`;

  const response = await provider.chat({
    messages: [
      { role: "system", content: CONDITION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
    temperature: 0.1,
    max_tokens: 256,
    response_format: { type: "json_object" },
  });

  const parsed = safeParseConditionResponse(response.content);

  const usage: AIUsageMetrics = {
    provider: providerName,
    model,
    prompt_tokens: response.usage.prompt_tokens,
    completion_tokens: response.usage.completion_tokens,
    total_tokens: response.usage.total_tokens,
    tool_calls_count: 0,
    iterations: 1,
    estimated_cost_usd: estimateCostUsd(
      model,
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    ),
  };

  return {
    should_execute: parsed.should_execute,
    reasoning: parsed.reasoning,
    usage,
  };
}

function buildProviderSlug(condition: AIConditionConfig): string {
  const providerName = condition.provider ?? getDefaultProviderName();
  const modelName = condition.model ?? inferCheapModel(providerName);
  return `${providerName}/${modelName}`;
}

function inferCheapModel(providerName: string): string {
  switch (providerName) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-haiku-20241022";
    case "google":
      return "gemini-2.0-flash";
    default:
      return getDefaultModel();
  }
}

function buildContextSummary(
  condition: AIConditionConfig,
  params: Record<string, unknown>,
  stepOutputs: Record<number, StepOutput>
): string {
  const parts: string[] = [];

  if (Object.keys(params).length > 0) {
    parts.push(`### Workflow parameters\n${truncateJson(params)}`);
  }

  const stepNumbers = condition.context_steps?.length
    ? condition.context_steps
    : Object.keys(stepOutputs)
        .map(Number)
        .sort((a, b) => a - b);

  for (const num of stepNumbers) {
    const step = stepOutputs[num];
    if (!step) continue;
    parts.push(
      `### Step ${num}: ${step.stepName} (${step.toolSlug})\n${truncateJson(step.output)}`
    );
  }

  return parts.join("\n\n") || "(no prior step outputs available)";
}

function truncateJson(value: unknown): string {
  const json =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (json.length <= CONTEXT_CHAR_LIMIT) return json;
  return json.slice(0, CONTEXT_CHAR_LIMIT) + "\n... (truncated)";
}

function safeParseConditionResponse(
  raw: string
): { should_execute: boolean; reasoning: string } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.should_execute === "boolean") {
      return {
        should_execute: parsed.should_execute,
        reasoning: String(parsed.reasoning ?? "No reasoning provided"),
      };
    }
  } catch {
    // Fall through to heuristic
  }

  const lower = raw.toLowerCase();
  if (lower.includes('"should_execute": true') || lower.includes('"should_execute":true')) {
    return { should_execute: true, reasoning: raw.slice(0, 200) };
  }
  if (lower.includes('"should_execute": false') || lower.includes('"should_execute":false')) {
    return { should_execute: false, reasoning: raw.slice(0, 200) };
  }

  console.warn(
    "[condition-evaluator] Could not parse AI condition response; defaulting to execute. Raw:",
    raw.slice(0, 300)
  );
  return {
    should_execute: true,
    reasoning: "Failed to parse AI condition response; defaulting to execute",
  };
}
