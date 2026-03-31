import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerateTextResult } from "ai";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
}));

vi.mock("../../../src/lib/ai/provider-registry", () => ({
  resolveModel: vi.fn(() => ({
    model: { id: "gpt-4o-mini" },
    providerName: "openai",
    modelId: "gpt-4o-mini",
  })),
  getDefaultProviderName: vi.fn(() => "openai"),
  getDefaultModel: vi.fn(() => "gpt-4o"),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { generateText } from "ai";
import { evaluateAICondition } from "../../../src/lib/ai/condition-evaluator";
import type { AIConditionConfig } from "../../../src/lib/ai/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGenerateTextResult(text: string): Partial<GenerateTextResult<Record<string, never>, never>> {
  return {
    text,
    finishReason: "stop",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } as any,
    steps: [],
    toolCalls: [],
    toolResults: [],
  };
}

const baseCondition: AIConditionConfig = {
  prompt: "Should this step run?",
};

const baseParams = { repo: "my-repo", env: "production" };

const baseStepOutputs = {
  1: {
    stepId: "step-001",
    stepNumber: 1,
    stepName: "Fetch Issues",
    toolSlug: "github/list_issues",
    output: { issues: [{ id: 1, title: "Bug fix" }] },
    durationMs: 120,
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("evaluateAICondition", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
  });

  // ── Happy path – valid JSON responses ────────────────────────────────────

  it("returns should_execute=true when AI responds with valid JSON true", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "Issues exist" })
      ) as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, baseStepOutputs);

    expect(result.should_execute).toBe(true);
    expect(result.reasoning).toBe("Issues exist");
  });

  it("returns should_execute=false when AI responds with valid JSON false", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: false, reasoning: "No issues found" })
      ) as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, baseStepOutputs);

    expect(result.should_execute).toBe(false);
    expect(result.reasoning).toBe("No issues found");
  });

  // ── Fallback / malformed responses ───────────────────────────────────────

  it("defaults to true when AI response is not valid JSON", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult("I cannot determine this.") as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, {});

    expect(result.should_execute).toBe(true);
    expect(result.reasoning).toContain("Failed to parse");
  });

  it('extracts true from malformed JSON containing "should_execute": true', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult('Here is my answer: {"should_execute": true}') as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, {});
    expect(result.should_execute).toBe(true);
  });

  it('extracts false from malformed JSON containing "should_execute": false', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult('Answer: {"should_execute": false, "reasoning": "skip"}') as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, {});
    expect(result.should_execute).toBe(false);
  });

  it("handles compact JSON without spaces in fallback heuristic", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult('{"should_execute":false,"reasoning":"empty"}') as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, {});
    expect(result.should_execute).toBe(false);
  });

  // ── Usage metrics ─────────────────────────────────────────────────────────

  it("returns populated usage metrics", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "ok" })
      ) as any
    );

    const result = await evaluateAICondition(baseCondition, baseParams, {});

    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.usage.total_tokens).toBe(150);
    expect(result.usage.tool_calls_count).toBe(0);
    expect(result.usage.iterations).toBe(1);
    expect(result.usage.provider).toBe("openai");
    expect(result.usage.model).toBe("gpt-4o-mini");
  });

  // ── Provider slug inference ───────────────────────────────────────────────

  it("uses condition.provider and condition.model when supplied", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");

    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "yes" })
      ) as any
    );

    await evaluateAICondition(
      { prompt: "run?", provider: "anthropic", model: "claude-3-5-haiku-20241022" },
      {},
      {}
    );

    expect(vi.mocked(resolveModel)).toHaveBeenCalledWith(
      "anthropic/claude-3-5-haiku-20241022"
    );
  });

  it("infers cheap openai model (gpt-4o-mini) when provider=openai but no model", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");

    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: false, reasoning: "no" })
      ) as any
    );

    await evaluateAICondition({ prompt: "run?", provider: "openai" }, {}, {});

    expect(vi.mocked(resolveModel)).toHaveBeenCalledWith("openai/gpt-4o-mini");
  });

  it("infers cheap anthropic model when provider=anthropic but no model", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");

    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "yes" })
      ) as any
    );

    await evaluateAICondition({ prompt: "run?", provider: "anthropic" }, {}, {});

    expect(vi.mocked(resolveModel)).toHaveBeenCalledWith(
      "anthropic/claude-3-5-haiku-20241022"
    );
  });

  it("infers cheap google model when provider=google but no model", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");

    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "yes" })
      ) as any
    );

    await evaluateAICondition({ prompt: "run?", provider: "google" }, {}, {});

    expect(vi.mocked(resolveModel)).toHaveBeenCalledWith("google/gemini-2.0-flash");
  });

  // ── Context building ──────────────────────────────────────────────────────

  it("passes workflow params to generateText prompt", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "ok" })
      ) as any
    );

    await evaluateAICondition(
      baseCondition,
      { key: "value", count: 42 },
      {}
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toContain("key");
    expect(callArgs.prompt).toContain("value");
  });

  it("includes step outputs in context by default", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "ok" })
      ) as any
    );

    await evaluateAICondition(baseCondition, {}, baseStepOutputs);

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toContain("Fetch Issues");
  });

  it("filters context to only context_steps when specified", async () => {
    const multiStepOutputs = {
      ...baseStepOutputs,
      2: {
        stepId: "step-002",
        stepNumber: 2,
        stepName: "Send Email",
        toolSlug: "email/send",
        output: { sent: true },
        durationMs: 80,
      },
    };

    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: false, reasoning: "filtered" })
      ) as any
    );

    await evaluateAICondition(
      { prompt: "run?", context_steps: [1] },
      {},
      multiStepOutputs
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toContain("Fetch Issues");
    expect(callArgs.prompt).not.toContain("Send Email");
  });

  it("shows no prior step outputs when stepOutputs is empty and no params", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "ok" })
      ) as any
    );

    await evaluateAICondition(baseCondition, {}, {});

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.prompt).toContain("no prior step outputs");
  });

  // ── System prompt compliance ──────────────────────────────────────────────

  it("sends the standard condition system prompt", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult(
        JSON.stringify({ should_execute: true, reasoning: "yes" })
      ) as any
    );

    await evaluateAICondition(baseCondition, {}, {});

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toContain("condition evaluator");
    expect(callArgs.maxOutputTokens).toBe(256);
    expect(callArgs.temperature).toBe(0.1);
  });
});
