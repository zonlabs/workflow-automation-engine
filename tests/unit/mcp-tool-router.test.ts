import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@mcp-ts/sdk/server", () => ({
  MCPClient: vi.fn(),
  MultiSessionClient: vi.fn(),
}));

import * as sdkServer from "@mcp-ts/sdk/server";
import { callToolAcrossSessions } from "../../script-runner/mcp-tool-router";

type MockClient = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  getServerUrl: ReturnType<typeof vi.fn>;
};

function makeMockClient(opts: {
  serverUrl?: string;
  tools?: string[];
  callResult?: unknown;
}): MockClient {
  const tools = opts.tools ?? [];
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: tools.map((t) => ({ name: t })) }),
    callTool: vi.fn().mockResolvedValue(opts.callResult ?? { content: [{ type: "text", text: "ok" }] }),
    getServerUrl: vi.fn().mockReturnValue(opts.serverUrl ?? "https://example.invalid"),
  };
}

describe("callToolAcrossSessions", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves tool via advertised listTools()", async () => {
    const remote = makeMockClient({
      serverUrl: "https://remote.mcp",
      tools: ["my_tool"],
      callResult: { content: [{ type: "text", text: "{\"ok\":true}" }] },
    });

    vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        getClients: vi.fn().mockReturnValue([remote]),
      };
    } as any);

    const { raw, meta } = await callToolAcrossSessions("user-1", "my_tool", { a: 1 });

    expect(raw).toEqual({ content: [{ type: "text", text: "{\"ok\":true}" }] });
    expect(meta.mode).toBe("listed_session");
    expect(meta.toolSlug).toBe("my_tool");
    expect(meta.serverUrl).toBe("https://remote.mcp");
    expect(meta.warning).toBeUndefined();
  });

  it("falls back to context session when tool is not advertised", async () => {
    const other = makeMockClient({
      serverUrl: "https://other.mcp",
      tools: ["something_else"],
    });
    const contextSessionClient = makeMockClient({
      serverUrl: "https://context-session.mcp",
      tools: ["only_meta_tools"],
      callResult: { content: [{ type: "text", text: "{\"ok\":\"fallback\"}" }] },
    });

    vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        getClients: vi.fn().mockReturnValue([other]),
      };
    } as any);

    vi.mocked(sdkServer.MCPClient).mockImplementation(function () {
      return contextSessionClient;
    } as any);

    const { raw, meta } = await callToolAcrossSessions("user-1", "unlisted_tool", { q: "x" }, "sess-ctx");

    expect(raw).toEqual({ content: [{ type: "text", text: "{\"ok\":\"fallback\"}" }] });
    expect(meta.mode).toBe("context_session_fallback");
    expect(meta.toolSlug).toBe("unlisted_tool");
    expect(meta.serverUrl).toBe("https://context-session.mcp");
    expect(meta.warning).toContain("workflow context session");
    expect(meta.warning).toContain("WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY");
  });

  it("throws in strict discovery mode when tool is not advertised", async () => {
    process.env.WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY = "true";

    const other = makeMockClient({
      serverUrl: "https://other.mcp",
      tools: ["something_else"],
    });

    vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        getClients: vi.fn().mockReturnValue([other]),
      };
    } as any);

    const mcpClientCtor = vi.mocked(sdkServer.MCPClient);

    await expect(callToolAcrossSessions("user-1", "unlisted_tool", {}, "sess-ctx")).rejects.toThrow(
      /Strict discovery is enabled/
    );
    expect(mcpClientCtor).not.toHaveBeenCalled();
  });

  it("continues to next advertised session if the first fails", async () => {
    const failing = makeMockClient({
      serverUrl: "https://bad.mcp",
      tools: ["my_tool"],
    });
    failing.callTool.mockRejectedValueOnce(new Error("SSE error: Non-200 status code (404)"));

    const good = makeMockClient({
      serverUrl: "https://good.mcp",
      tools: ["my_tool"],
      callResult: { content: [{ type: "text", text: "{\"ok\":\"good\"}" }] },
    });

    vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        getClients: vi.fn().mockReturnValue([failing, good]),
      };
    } as any);

    const { raw, meta } = await callToolAcrossSessions("user-1", "my_tool", {});
    expect(raw).toEqual({ content: [{ type: "text", text: "{\"ok\":\"good\"}" }] });
    expect(meta.serverUrl).toBe("https://good.mcp");
    expect(meta.mode).toBe("listed_session");
  });

  it("includes session + server URL when context session fallback fails", async () => {
    const other = makeMockClient({
      serverUrl: "https://other.mcp",
      tools: ["something_else"],
    });

    vi.mocked(sdkServer.MultiSessionClient).mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        getClients: vi.fn().mockReturnValue([other]),
      };
    } as any);

    const contextSessionClient = makeMockClient({
      serverUrl: "https://context-session.mcp",
      tools: ["only_meta_tools"],
    });
    contextSessionClient.connect.mockRejectedValue(new Error("SSE error: Non-200 status code (404)"));

    vi.mocked(sdkServer.MCPClient).mockImplementation(function () {
      return contextSessionClient;
    } as any);

    const err = await callToolAcrossSessions("user-1", "unlisted_tool", {}, "sess-ctx").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/session "sess-ctx"/);
    expect(msg).toMatch(/https:\/\/context-session\.mcp/);
    expect(msg).toMatch(/404/);
  });
});
