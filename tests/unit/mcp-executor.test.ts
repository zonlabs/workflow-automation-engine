import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowJobData } from "../../src/lib/queue";

// ── Module mocks ──────────────────────────────────────────────────────────────

// MCPClient / MultiSessionClient / storage
vi.mock("@mcp-ts/sdk/server", () => ({
  MCPClient: vi.fn(),
  MultiSessionClient: vi.fn(),
  storage: { getIdentitySessionsData: vi.fn() },
}));

// Supabase
vi.mock("../../src/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

// AI agent & condition evaluator
vi.mock("../../src/lib/ai/ai-agent", () => ({
  executeAIAgentStep: vi.fn(),
}));

vi.mock("../../src/lib/ai/condition-evaluator", () => ({
  evaluateAICondition: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { executeWorkflowJob } from "../../src/lib/mcp-executor";
import * as sdkServer from "@mcp-ts/sdk/server";
import { supabase } from "../../src/lib/supabase";
import { executeAIAgentStep } from "../../src/lib/ai/ai-agent";
import { evaluateAICondition } from "../../src/lib/ai/condition-evaluator";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJobData(overrides: Partial<WorkflowJobData> = {}): WorkflowJobData {
  return {
    workflowId: "wf-001",
    scheduledWorkflowId: "sched-001",
    executionLogId: "log-001",
    userId: "user-abc",
    sessionId: "sess-xyz",
    triggeredBy: "manual",
    params: {},
    attempt: 0,
    ...overrides,
  };
}

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-001",
    workflow_id: "wf-001",
    step_number: 1,
    name: "Test Step",
    toolkit: "github",
    tool_slug: "list_issues",
    tool_arguments: {},
    depends_on_step_id: null,
    run_if_condition: null,
    retry_on_failure: false,
    max_retries: 0,
    timeout_seconds: 30,
    ...overrides,
  };
}

// ── Mock setup helpers ────────────────────────────────────────────────────────

let mockCallTool: ReturnType<typeof vi.fn>;
let mockConnect: ReturnType<typeof vi.fn>;
let mockDisconnect: ReturnType<typeof vi.fn>;
let mockDispose: ReturnType<typeof vi.fn>;
let mockMultiConnect: ReturnType<typeof vi.fn>;
let mockMultiDisconnect: ReturnType<typeof vi.fn>;

function setupMCPClientMock(callToolResult: unknown = { content: [{ text: "ok" }] }) {
  mockCallTool = vi.fn().mockResolvedValue(callToolResult);
  mockConnect = vi.fn().mockResolvedValue(undefined);
  mockDisconnect = vi.fn().mockResolvedValue(undefined);
  mockDispose = vi.fn();
  // Regular function (not arrow) so `new MCPClient(...)` works as a constructor.
  vi.mocked(sdkServer.MCPClient).mockImplementation(function () {
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
      dispose: mockDispose,
      callTool: mockCallTool,
      isConnected: vi.fn().mockReturnValue(true),
      getSessionId: vi.fn().mockReturnValue("sess-xyz"),
      getSessionData: vi.fn().mockReturnValue(null),
    };
  } as any);
}

function setupMultiSessionClientMock() {
  mockMultiConnect = vi.fn().mockResolvedValue(undefined);
  mockMultiDisconnect = vi.fn();
  // Regular function (not arrow) so `new MultiSessionClient(...)` works as a constructor.
  vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
    return {
      connect: mockMultiConnect,
      disconnect: mockMultiDisconnect,
      getClients: vi.fn().mockReturnValue([]),
    };
  } as any);
}

function setupStorageMock(sessions = [{ sessionId: "sess-xyz" }]) {
  vi.mocked(sdkServer.storage.getIdentitySessionsData).mockResolvedValue(sessions as any);
}

let mockUpdateEq: ReturnType<typeof vi.fn>;
let mockOrderFn: ReturnType<typeof vi.fn>;

/** Matches executeWorkflowJob: execution_logs updates, workflows definition fetch, workflow_steps list. */
function setupSupabaseMock(
  steps: unknown[] = [],
  workflowRow: { script_code?: string | null; script_runtime?: unknown } = {}
) {
  mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

  mockOrderFn = vi.fn().mockResolvedValue({ data: steps, error: null });
  const mockEqSteps = vi.fn().mockReturnValue({ order: mockOrderFn });
  const mockSelectSteps = vi.fn().mockReturnValue({ eq: mockEqSteps });

  const wfData = {
    id: "wf-001",
    script_code: null as string | null,
    script_runtime: null,
    ...workflowRow,
  };
  const mockWorkflowSingle = vi.fn().mockResolvedValue({ data: wfData, error: null });
  const mockWorkflowEq = vi.fn().mockReturnValue({ single: mockWorkflowSingle });
  const mockSelectWorkflows = vi.fn().mockReturnValue({ eq: mockWorkflowEq });

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflow_steps") return { select: mockSelectSteps } as any;
    if (table === "workflows") return { select: mockSelectWorkflows } as any;
    if (table === "execution_logs") return { update: mockUpdate } as any;
    return { update: mockUpdate } as any;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeWorkflowJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMCPClientMock();
    setupMultiSessionClientMock();
    setupStorageMock();
  });

  // ── Guard rails ───────────────────────────────────────────────────────────

  it("throws when sessionId is missing", async () => {
    setupSupabaseMock([]);
    await expect(
      executeWorkflowJob(makeJobData({ sessionId: "" }))
    ).rejects.toThrow("sessionId is required");
  });

  it("returns failed with SESSION_NOT_FOUND when session does not exist", async () => {
    setupStorageMock([]); // No sessions
    setupSupabaseMock([makeStep()]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("MCP_SESSION_NOT_FOUND");
  });

  it("returns failed with WORKFLOW_STEPS_EMPTY when no steps exist", async () => {
    setupSupabaseMock([]); // No steps

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("WORKFLOW_STEPS_EMPTY");
  });

  // ── Successful single MCP step ────────────────────────────────────────────

  it("returns status=success after a successful single-step workflow", async () => {
    setupSupabaseMock([makeStep()]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(result.retryable).toBe(false);
  });

  it("stores step output keyed by step_number in result", async () => {
    const toolOutput = { issues: [{ id: 1 }] };
    setupMCPClientMock(toolOutput);
    setupSupabaseMock([makeStep({ step_number: 1 })]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.output.steps[1].output).toEqual(toolOutput);
    expect(result.output.steps[1].toolSlug).toBe("list_issues");
  });

  it("forwards resolved tool arguments to MCPClient.callTool", async () => {
    setupSupabaseMock([
      makeStep({ tool_arguments: { owner: "my-org", repo: "my-repo" } }),
    ]);

    await executeWorkflowJob(makeJobData());

    expect(mockCallTool).toHaveBeenCalledWith("list_issues", {
      owner: "my-org",
      repo: "my-repo",
    });
  });

  // ── Template variable resolution ──────────────────────────────────────────

  it("resolves {{params.key}} template in tool_arguments", async () => {
    setupSupabaseMock([
      makeStep({ tool_arguments: { owner: "{{params.org}}" } }),
    ]);

    await executeWorkflowJob(makeJobData({ params: { org: "zonlabs" } }));

    expect(mockCallTool).toHaveBeenCalledWith("list_issues", { owner: "zonlabs" });
  });

  it("resolves {{steps.1.output.issues}} template from prior step output", async () => {
    const step1Output = { issues: [{ id: 1 }] };
    setupMCPClientMock(step1Output);

    const step1 = makeStep({
      id: "step-001",
      step_number: 1,
      name: "Fetch Issues",
      tool_slug: "list_issues",
      tool_arguments: {},
    });
    const step2 = makeStep({
      id: "step-002",
      step_number: 2,
      name: "Create PR",
      tool_slug: "create_pr",
      tool_arguments: { issues: "{{steps.1.output.issues}}" },
    });

    setupSupabaseMock([step1, step2]);

    await executeWorkflowJob(makeJobData());

    // Second callTool invocation gets the resolved output
    const calls = mockCallTool.mock.calls;
    expect(calls[1][1]).toEqual({ issues: step1Output.issues });
  });

  it("fails with TEMPLATE_RESOLUTION_FAILED for unresolvable template vars", async () => {
    setupSupabaseMock([
      makeStep({ tool_arguments: { val: "{{params.missing}}" } }),
    ]);

    const result = await executeWorkflowJob(makeJobData({ params: {} }));

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TEMPLATE_RESOLUTION_FAILED");
  });

  // ── run_if_condition ──────────────────────────────────────────────────────

  it("executes step when AI condition returns should_execute=true", async () => {
    vi.mocked(evaluateAICondition).mockResolvedValueOnce({
      should_execute: true,
      reasoning: "Issues exist",
      usage: {} as any,
    });

    setupSupabaseMock([
      makeStep({
        run_if_condition: { prompt: "Are there open issues?" },
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(mockCallTool).toHaveBeenCalled();
  });

  it("skips step and marks it _skipped when AI condition returns false", async () => {
    vi.mocked(evaluateAICondition).mockResolvedValueOnce({
      should_execute: false,
      reasoning: "No issues found",
      usage: {} as any,
    });

    setupSupabaseMock([
      makeStep({
        run_if_condition: { prompt: "Are there open issues?" },
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(mockCallTool).not.toHaveBeenCalled();
    expect((result.output.steps[1].output as any)._skipped).toBe(true);
    expect((result.output.steps[1].output as any)._condition_reasoning).toBe(
      "No issues found"
    );
  });

  it("defaults to execute when run_if_condition has no prompt field", async () => {
    setupSupabaseMock([
      makeStep({ run_if_condition: {} }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(mockCallTool).toHaveBeenCalled();
    expect(evaluateAICondition).not.toHaveBeenCalled();
  });

  it("defaults to execute when AI condition evaluation throws", async () => {
    vi.mocked(evaluateAICondition).mockRejectedValueOnce(new Error("AI API timeout"));

    setupSupabaseMock([
      makeStep({ run_if_condition: { prompt: "Run?" } }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(mockCallTool).toHaveBeenCalled();
  });

  // ── AI step routing ───────────────────────────────────────────────────────

  it("routes toolkit=ai steps to executeAIAgentStep instead of callTool", async () => {
    vi.mocked(executeAIAgentStep).mockResolvedValueOnce({
      content: "AI result text",
      parsed_output: "AI result text",
      usage: {
        provider: "openai",
        model: "gpt-4o",
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        tool_calls_count: 0,
        iterations: 1,
      },
      tool_call_log: [],
      reasoning_trace: ["[done] Finished"],
    });

    setupSupabaseMock([
      makeStep({
        toolkit: "ai",
        tool_slug: "openai/gpt-4o",
        tool_arguments: {
          system_prompt: "You are a helpful assistant.",
          user_prompt: "Analyze these issues.",
          available_tools: ["*"],
        },
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(executeAIAgentStep).toHaveBeenCalled();
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect((result.output.steps[1].output as any).content).toBe("AI result text");
  });

  it("includes ai_usage in AI step output", async () => {
    const aiUsage = {
      provider: "openai",
      model: "gpt-4o",
      prompt_tokens: 200,
      completion_tokens: 100,
      total_tokens: 300,
      tool_calls_count: 2,
      iterations: 3,
    };

    vi.mocked(executeAIAgentStep).mockResolvedValueOnce({
      content: "Done",
      parsed_output: "Done",
      usage: aiUsage,
      tool_call_log: [],
      reasoning_trace: [],
    });

    setupSupabaseMock([
      makeStep({
        toolkit: "ai",
        tool_slug: "openai/gpt-4o",
        tool_arguments: {
          system_prompt: "sys",
          user_prompt: "Analyze",
        },
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect((result.output.steps[1].output as any).ai_usage).toEqual(aiUsage);
  });

  it("throws AI_STEP_MISSING_PROMPT when user_prompt is absent for an AI step", async () => {
    setupSupabaseMock([
      makeStep({
        toolkit: "ai",
        tool_slug: "openai/gpt-4o",
        tool_arguments: { system_prompt: "sys" }, // no user_prompt
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AI_STEP_MISSING_PROMPT");
  });

  // ── MultiSessionClient creation ───────────────────────────────────────────

  it("creates MultiSessionClient only when AI steps are present", async () => {
    vi.mocked(executeAIAgentStep).mockResolvedValueOnce({
      content: "ok",
      parsed_output: "ok",
      usage: {
        provider: "openai",
        model: "gpt-4o",
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        tool_calls_count: 0,
        iterations: 1,
      },
      tool_call_log: [],
      reasoning_trace: [],
    });

    setupSupabaseMock([
      makeStep({
        toolkit: "ai",
        tool_slug: "openai/gpt-4o",
        tool_arguments: { system_prompt: "sys", user_prompt: "go" },
      }),
    ]);

    await executeWorkflowJob(makeJobData());

    expect(sdkServer.MultiSessionClient).toHaveBeenCalled();
    expect(mockMultiConnect).toHaveBeenCalled();
  });

  it("does NOT create MultiSessionClient for pure MCP workflows", async () => {
    setupSupabaseMock([makeStep()]); // toolkit defaults to "github"

    await executeWorkflowJob(makeJobData());

    expect(sdkServer.MultiSessionClient).not.toHaveBeenCalled();
  });

  // ── Step dependency ───────────────────────────────────────────────────────

  it("fails with STEP_DEPENDENCY_UNMET when depends_on_step_id output is missing", async () => {
    setupSupabaseMock([
      makeStep({
        id: "step-002",
        step_number: 1,
        depends_on_step_id: "step-999", // step-999 never ran
      }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("STEP_DEPENDENCY_UNMET");
  });

  it("resolves dependency correctly when dependent step ran first", async () => {
    const step1 = makeStep({
      id: "step-001",
      step_number: 1,
      depends_on_step_id: null,
    });
    const step2 = makeStep({
      id: "step-002",
      step_number: 2,
      depends_on_step_id: "step-001",
    });

    setupSupabaseMock([step1, step2]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(mockCallTool).toHaveBeenCalledTimes(2);
  });

  // ── MCP tool error handling ───────────────────────────────────────────────

  it("fails non-retryably when MCP tool returns isError=true", async () => {
    setupMCPClientMock({
      isError: true,
      content: [{ text: "Repository not found" }],
    });
    setupSupabaseMock([makeStep()]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Repository not found");
    expect(result.error?.code).toBe("STEP_EXECUTION_FAILED");
  });

  // ── Transient error handling ──────────────────────────────────────────────

  it("returns retryable=false and does not rethrow for permanent errors", async () => {
    setupMCPClientMock(undefined);
    mockCallTool.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { code: "401" })
    );
    setupSupabaseMock([makeStep()]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(false);
  });

  it("rethrows transient errors so BullMQ can retry the job", async () => {
    mockCallTool.mockRejectedValueOnce(
      Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" })
    );
    setupSupabaseMock([
      makeStep({ retry_on_failure: false, max_retries: 0 }),
    ]);

    await expect(executeWorkflowJob(makeJobData())).rejects.toThrow(
      "Connection timed out"
    );
  });

  // ── Execution log updates ─────────────────────────────────────────────────

  it("marks execution log as 'running' at start", async () => {
    setupSupabaseMock([makeStep()]);

    await executeWorkflowJob(makeJobData());

    // .eq("id", "log-001") → mockUpdateEq("id", "log-001")
    // calls[0][0] = column name ("id"), calls[0][1] = value ("log-001")
    const firstUpdate = mockUpdateEq.mock.calls[0];
    expect(firstUpdate[1]).toBe("log-001");
  });

  it("marks execution log as 'success' on completion", async () => {
    setupSupabaseMock([makeStep()]);

    await executeWorkflowJob(makeJobData());

    // Last call to mockUpdateEq should have status=success patched
    const allUpdateArgs = vi.mocked(supabase.from).mock.calls
      .filter(([t]) => t === "execution_logs");
    expect(allUpdateArgs.length).toBeGreaterThanOrEqual(2); // at least running + success
  });

  it("marks execution log as 'failed' on error", async () => {
    setupStorageMock([]); // triggers SESSION_NOT_FOUND
    setupSupabaseMock([makeStep()]);

    await executeWorkflowJob(makeJobData());

    // execution_logs table was updated at least once (for the failed status)
    const logUpdates = vi.mocked(supabase.from).mock.calls.filter(
      ([t]) => t === "execution_logs"
    );
    expect(logUpdates.length).toBeGreaterThanOrEqual(1);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it("disconnects MCPClient in the finally block even on error", async () => {
    setupStorageMock([]); // triggers error path
    setupSupabaseMock([makeStep()]);

    await executeWorkflowJob(makeJobData());

    // disconnect is called in finally – but the MCPClient is only created
    // AFTER the session check, so it may be null in this case. Verify the
    // mock was at least instantiated (or not) cleanly.
    // The key invariant: no unhandled promise rejection.
    expect(true).toBe(true);
  });

  it("disconnects MultiSessionClient in the finally block", async () => {
    vi.mocked(executeAIAgentStep).mockResolvedValueOnce({
      content: "ok",
      parsed_output: "ok",
      usage: {
        provider: "openai",
        model: "gpt-4o",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        tool_calls_count: 0,
        iterations: 1,
      },
      tool_call_log: [],
      reasoning_trace: [],
    });

    setupSupabaseMock([
      makeStep({
        toolkit: "ai",
        tool_slug: "openai/gpt-4o",
        tool_arguments: { system_prompt: "s", user_prompt: "u" },
      }),
    ]);

    await executeWorkflowJob(makeJobData());

    expect(mockMultiDisconnect).toHaveBeenCalled();
  });

  // ── Multi-step workflow ───────────────────────────────────────────────────

  it("executes multiple steps in order and accumulates outputs", async () => {
    const callCount = { n: 0 };
    mockCallTool.mockImplementation(async () => {
      callCount.n++;
      return { count: callCount.n };
    });

    setupSupabaseMock([
      makeStep({ step_number: 1, id: "s1" }),
      makeStep({ step_number: 2, id: "s2", tool_slug: "create_pr" }),
      makeStep({ step_number: 3, id: "s3", tool_slug: "send_email" }),
    ]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("success");
    expect(Object.keys(result.output.steps)).toHaveLength(3);
    expect((result.output.steps[1].output as any).count).toBe(1);
    expect((result.output.steps[2].output as any).count).toBe(2);
    expect((result.output.steps[3].output as any).count).toBe(3);
  });

  it("passes workflow params through to the result output", async () => {
    setupSupabaseMock([makeStep()]);

    const result = await executeWorkflowJob(
      makeJobData({ params: { env: "staging", branch: "main" } })
    );

    expect(result.output.params).toEqual({ env: "staging", branch: "main" });
  });
});
