import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowJobData } from "../../src/lib/queue";

vi.mock("@mcp-ts/sdk/server", () => ({
  storage: { getIdentitySessionsData: vi.fn() },
}));

vi.mock("../../src/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

vi.mock("../../src/lib/script-runner", () => ({
  runScriptWorkflow: vi.fn(),
}));

import * as sdkServer from "@mcp-ts/sdk/server";
import { supabase } from "../../src/lib/supabase";
import { runScriptWorkflow } from "../../src/lib/script-runner";
import { executeWorkflowJob } from "../../src/lib/mcp-executor";

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

function setupStorageMock(sessions = [{ sessionId: "sess-xyz" }]) {
  vi.mocked(sdkServer.storage.getIdentitySessionsData).mockResolvedValue(sessions as any);
}

function setupSupabaseMock(workflowRow: { script_code?: string | null; script_runtime?: unknown } = {}) {
  const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

  const wfData = {
    id: "wf-001",
    toolkit_ids: ["github"],
    script_code: "module.exports.main = async () => ({ success: true });",
    script_runtime: null,
    ...workflowRow,
  };
  const mockWorkflowSingle = vi.fn().mockResolvedValue({ data: wfData, error: null });
  const mockWorkflowEq = vi.fn().mockReturnValue({ single: mockWorkflowSingle });
  const mockSelectWorkflows = vi.fn().mockReturnValue({ eq: mockWorkflowEq });

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") return { select: mockSelectWorkflows } as any;
    if (table === "execution_logs") return { update: mockUpdate } as any;
    return { update: mockUpdate } as any;
  });
}

describe("executeWorkflowJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStorageMock();
    setupSupabaseMock();
    vi.mocked(runScriptWorkflow).mockResolvedValue({
      output: { success: true },
      logs: { stdout: "", stderr: "" },
      artifacts: null,
    });
  });

  it("throws when sessionId is missing", async () => {
    await expect(executeWorkflowJob(makeJobData({ sessionId: "" }))).rejects.toThrow(
      "sessionId is required"
    );
  });

  it("returns failed with MCP_SESSION_NOT_FOUND when session does not exist", async () => {
    setupStorageMock([]);

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("MCP_SESSION_NOT_FOUND");
  });

  it("returns failed with SCRIPT_CODE_MISSING when script_code is absent", async () => {
    setupSupabaseMock({ script_code: null });

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("SCRIPT_CODE_MISSING");
  });

  it("runs script workflows successfully", async () => {
    const result = await executeWorkflowJob(makeJobData({ params: { org: "zonlabs" } }));

    expect(result.status).toBe("success");
    expect(result.output.steps[1].toolSlug).toBe("script");
    expect(vi.mocked(runScriptWorkflow)).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-001",
        executionLogId: "log-001",
        userId: "user-abc",
        sessionId: "sess-xyz",
        params: { org: "zonlabs" },
      })
    );
  });

  it("marks execution failed when the script result reports an error payload", async () => {
    vi.mocked(runScriptWorkflow).mockResolvedValueOnce({
      output: { status: "error", error: "boom" },
      logs: { stdout: "", stderr: "boom" },
      artifacts: null,
    });

    const result = await executeWorkflowJob(makeJobData());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("SCRIPT_RESULT_ERROR");
    expect(result.error?.message).toBe("boom");
  });
});
