import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => () => false),
}));

vi.mock("@mcp-ts/sdk/adapters/ai", () => ({
  AIAdapter: {
    getTools: vi.fn(),
  },
}));

vi.mock("../../../src/lib/ai/provider-registry", () => ({
  resolveModel: vi.fn(() => ({
    model: { id: "gpt-4o" },
    providerName: "openai",
    modelId: "gpt-4o",
  })),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { generateText } from "ai";
import { AIAdapter } from "@mcp-ts/sdk/adapters/ai";
import { executeAIAgentStep } from "../../../src/lib/ai/ai-agent";
import type { AIStepConfig } from "../../../src/lib/ai/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseConfig: AIStepConfig = {
  system_prompt: "You are a helpful assistant.",
  user_prompt: "List open GitHub issues.",
  temperature: 0.5,
  max_tokens: 1024,
};

const mockMCPClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
};

function makeGenerateTextResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "Here are the issues: [issue-1, issue-2]",
    finishReason: "stop",
    totalUsage: { inputTokens: 200, outputTokens: 80 },
    usage: { inputTokens: 200, outputTokens: 80 },
    steps: [{}],
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeAIAgentStep", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    vi.mocked(AIAdapter.getTools).mockReset();
  });

  // ── No-tools simple completion ────────────────────────────────────────────

  it("returns content from generateText text on a simple prompt", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    const result = await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    expect(result.content).toBe("Here are the issues: [issue-1, issue-2]");
  });

  it("does NOT call AIAdapter.getTools when mcpClient is null", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    expect(AIAdapter.getTools).not.toHaveBeenCalled();
  });

  it("does NOT pass tools to generateText when available_tools is undefined", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(baseConfig, "openai/gpt-4o", mockMCPClient as any);

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tools).toBeUndefined();
  });

  // ── Tool usage ────────────────────────────────────────────────────────────

  it("fetches tools from AIAdapter when available_tools includes '*'", async () => {
    const allTools = {
      tool_mcp_list_issues: { description: "List GitHub issues" },
      tool_mcp_create_pr: { description: "Create a PR" },
    };
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce(allTools as any);
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      { ...baseConfig, available_tools: ["*"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    expect(AIAdapter.getTools).toHaveBeenCalledWith(mockMCPClient, { prefix: "mcp" });
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tools).toEqual(allTools);
  });

  it("filters tools to only the explicitly named ones", async () => {
    const allTools = {
      tool_mcp_list_issues: { description: "List GitHub issues" },
      tool_mcp_create_pr: { description: "Create a PR" },
      tool_mcp_send_email: { description: "Send email" },
    };
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce(allTools as any);
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      { ...baseConfig, available_tools: ["tool_mcp_list_issues", "tool_mcp_create_pr"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    const tools = callArgs.tools as Record<string, unknown>;
    expect(Object.keys(tools)).toContain("tool_mcp_list_issues");
    expect(Object.keys(tools)).toContain("tool_mcp_create_pr");
    expect(Object.keys(tools)).not.toContain("tool_mcp_send_email");
  });

  it("matches tools by base name (without the 'tool_mcp_' prefix)", async () => {
    const allTools = {
      tool_mcp_list_issues: { description: "List GitHub issues" },
    };
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce(allTools as any);
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      { ...baseConfig, available_tools: ["list_issues"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    const tools = callArgs.tools as Record<string, unknown>;
    expect(Object.keys(tools)).toContain("tool_mcp_list_issues");
  });

  it("passes empty tools to generateText when available_tools filter matches nothing", async () => {
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce({} as any);
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      { ...baseConfig, available_tools: ["non_existent_tool"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    // No tools found → hasTools = false → tools passed as undefined
    expect(callArgs.tools).toBeUndefined();
  });

  // ── Tool call log ─────────────────────────────────────────────────────────

  it("records tool calls in tool_call_log via onStepFinish callback", async () => {
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce({
      tool_mcp_list_issues: { description: "list" },
    } as any);

    // Capture the onStepFinish handler so we can invoke it manually
    let capturedOnStepFinish: ((event: unknown) => void) | undefined;
    vi.mocked(generateText).mockImplementationOnce(async (opts: any) => {
      capturedOnStepFinish = opts.onStepFinish;
      // Simulate one step that calls a tool
      capturedOnStepFinish?.({
        toolCalls: [{ toolName: "tool_mcp_list_issues", input: { owner: "me" } }],
        toolResults: [
          { toolName: "tool_mcp_list_issues", output: [{ id: 1, title: "Bug" }] },
        ],
        text: "",
      });
      return makeGenerateTextResult();
    });

    const result = await executeAIAgentStep(
      { ...baseConfig, available_tools: ["*"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    expect(result.tool_call_log).toHaveLength(1);
    expect(result.tool_call_log[0].tool_name).toBe("tool_mcp_list_issues");
    expect(result.tool_call_log[0].tool_arguments).toEqual({ owner: "me" });
    expect(result.tool_call_log[0].result_preview).toContain("Bug");
  });

  it("records reasoning trace entries for each step", async () => {
    vi.mocked(AIAdapter.getTools).mockResolvedValueOnce({
      tool_mcp_list_issues: { description: "list" },
    } as any);

    let capturedOnStepFinish: ((event: unknown) => void) | undefined;
    vi.mocked(generateText).mockImplementationOnce(async (opts: any) => {
      capturedOnStepFinish = opts.onStepFinish;
      capturedOnStepFinish?.({
        toolCalls: [{ toolName: "tool_mcp_list_issues", input: {} }],
        toolResults: [{ toolName: "tool_mcp_list_issues", output: [] }],
        text: "",
      });
      return makeGenerateTextResult({
        steps: [{}, {}],
        finishReason: "stop",
      });
    });

    const result = await executeAIAgentStep(
      { ...baseConfig, available_tools: ["*"] },
      "openai/gpt-4o",
      mockMCPClient as any
    );

    expect(result.reasoning_trace.some((t) => t.includes("[step"))).toBe(true);
    expect(result.reasoning_trace.some((t) => t.includes("[done]"))).toBe(true);
  });

  // ── Usage metrics ─────────────────────────────────────────────────────────

  it("populates usage metrics with correct token counts", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult({
        totalUsage: { inputTokens: 300, outputTokens: 150 },
        steps: [{}],
      }) as any
    );

    const result = await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    expect(result.usage.prompt_tokens).toBe(300);
    expect(result.usage.completion_tokens).toBe(150);
    expect(result.usage.total_tokens).toBe(450);
    expect(result.usage.provider).toBe("openai");
    expect(result.usage.model).toBe("gpt-4o");
    expect(result.usage.iterations).toBe(1);
  });

  it("provides estimated_cost_usd for known models", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult({
        totalUsage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        steps: [{}],
      }) as any
    );

    const result = await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    // gpt-4o: $2.5/M input + $10/M output → $2.5 + $5 = $7.5
    expect(result.usage.estimated_cost_usd).toBeCloseTo(7.5, 5);
  });

  // ── JSON parsing ──────────────────────────────────────────────────────────

  it("parses valid JSON text into parsed_output", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult({ text: '{"status":"ok","count":3}' }) as any
    );

    const result = await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    expect(result.parsed_output).toEqual({ status: "ok", count: 3 });
  });

  it("returns raw text as parsed_output when output is not JSON", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(
      makeGenerateTextResult({ text: "Plain text response here." }) as any
    );

    const result = await executeAIAgentStep(baseConfig, "openai/gpt-4o", null);

    expect(result.parsed_output).toBe("Plain text response here.");
  });

  // ── Config forwarding ─────────────────────────────────────────────────────

  it("forwards system_prompt and user_prompt to generateText", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      {
        system_prompt: "You are a code reviewer.",
        user_prompt: "Review this PR.",
      },
      "openai/gpt-4o",
      null
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toBe("You are a code reviewer.");
    expect(callArgs.prompt).toBe("Review this PR.");
  });

  it("passes temperature and maxOutputTokens from config", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(makeGenerateTextResult() as any);

    await executeAIAgentStep(
      { ...baseConfig, temperature: 0.2, max_tokens: 512 },
      "openai/gpt-4o",
      null
    );

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.temperature).toBe(0.2);
    expect(callArgs.maxOutputTokens).toBe(512);
  });
});
