import { MCPClient, MultiSessionClient } from "@mcp-ts/sdk/server";

function isLocalhostServer(client: MCPClient): boolean {
  const url = client.getServerUrl() || "";
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

/** Prefer workflow engine for its tools; prefer remote MCP (e.g. Zapier) for everything else. */
export function sortClientsForToolSlug(clients: MCPClient[], toolSlug: string): MCPClient[] {
  const engineTool = /^(workflow_|schedule_|execution_log)/.test(toolSlug);
  return [...clients].sort((a, b) => {
    const aLocal = isLocalhostServer(a);
    const bLocal = isLocalhostServer(b);
    if (engineTool) {
      if (aLocal && !bLocal) return -1;
      if (!aLocal && bLocal) return 1;
      return 0;
    }
    if (aLocal && !bLocal) return 1;
    if (!aLocal && bLocal) return -1;
    return 0;
  });
}

export type ToolResolutionMeta = {
  mode: "listed_session" | "meta_tool_proxy" | "context_session_fallback";
  toolSlug: string;
  serverUrl?: string;
  serverName?: string;
  warning?: string;
};

function formatToolCallError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const normalizedValue = value?.trim().toLowerCase();
  if (!normalizedValue) {
    return undefined;
  }

  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return undefined;
}

function isStrictToolDiscoveryEnabled(): boolean {
  const explicitStrictMode = parseOptionalBoolean(process.env.WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY);
  if (explicitStrictMode !== undefined) {
    return explicitStrictMode;
  }

  const allowContextSessionFallback = parseOptionalBoolean(
    process.env.WORKFLOW_SCRIPT_ALLOW_CONTEXT_SESSION_FALLBACK
  );
  if (allowContextSessionFallback !== undefined) {
    return !allowContextSessionFallback;
  }

  return true;
}

/**
 * Try executing `toolSlug` via `mcp_execute_tool` meta-tool on sessions that advertise it.
 * This handles sessions using the `search` strategy where real tools aren't in listTools()
 * but are accessible through the meta-tool proxy.
 */
/**
 * Resolves `toolSlug` across all MCP sessions for `userId`.
 * Resolution order:
 *   1. Direct call on sessions that advertise the tool via `listTools()`
 *   2. Meta-tool proxy (`mcp_execute_tool`) on sessions that advertise it
 *   3. Context session fallback (unless strict discovery is enabled)
 *
 * @param contextSessionId - `context.session_id` from the workflow run
 * @param serverNameHint - Optional server name to disambiguate tool calls via meta-tool proxy
 */
export async function callToolAcrossSessions(
  userId: string,
  toolSlug: string,
  args: Record<string, unknown>,
  contextSessionId?: string,
  serverNameHint?: string
): Promise<{ raw: unknown; meta: ToolResolutionMeta }> {
  const multi = new MultiSessionClient(userId);
  let lastAdvertisedFailure: { serverUrl?: string; message: string } | null = null;
  let clients: MCPClient[] = [];
  try {
    await multi.connect();
    clients = sortClientsForToolSlug(multi.getClients(), toolSlug);

    const clientTools = await Promise.all(
      clients.map(async (client) => {
        try {
          const listed = (await client.listTools()) as { tools?: Array<{ name?: string }> };
          return { client, names: listed?.tools?.map((t) => t.name) ?? [] };
        } catch (err) {
          console.warn(`[ToolRouter] Failed to list tools for session ${client.getSessionId()} (${client.getServerUrl()}):`, err);
          return { client, names: [] };
        }
      })
    );

    // Phase 1: Direct tool call on sessions that list the tool
    for (const { client, names } of clientTools) {
      if (!names.includes(toolSlug)) continue;

      const serverUrl = client.getServerUrl() || undefined;
      try {
        const raw = await client.callTool(toolSlug, args);
        console.log("[tool-router] Tool resolved via advertised session", {
          userId,
          toolSlug,
          sessionId: typeof client.getSessionId === "function" ? client.getSessionId() : undefined,
          serverUrl,
        });
        return {
          raw,
          meta: {
            mode: "listed_session",
            toolSlug,
            serverUrl,
          },
        };
      } catch (err) {
        console.warn("[tool-router] Advertised session tool call failed", {
          toolSlug,
          serverUrl,
          sessionId: typeof client.getSessionId === "function" ? client.getSessionId() : undefined,
          error: formatToolCallError(err),
        });
        lastAdvertisedFailure = { serverUrl, message: formatToolCallError(err) };
        continue; // Try next advertised session if this one failed
      }
    }

    // Phase 2: Try meta-tool proxy (mcp_execute_tool) on sessions that have it
    for (const { client, names } of clientTools) {
      if (!names.includes("mcp_execute_tool")) continue;

      const serverUrl = client.getServerUrl() || undefined;
      const proxyServerName =
        (typeof client.getServerName === "function" ? client.getServerName() : undefined) ?? undefined;

      try {
        const proxyArgs: Record<string, unknown> = {
          toolName: toolSlug,
          args,
        };
        if (serverNameHint) {
          proxyArgs.serverName = serverNameHint;
        }

        const result = await client.callTool("mcp_execute_tool", proxyArgs);
        console.log("[tool-router] Tool resolved via meta-tool proxy", {
          userId,
          toolSlug,
          sessionId: typeof client.getSessionId === "function" ? client.getSessionId() : undefined,
          serverUrl,
          proxyServerName,
          serverNameHint: serverNameHint ?? null,
        });
        return {
          raw: result,
          meta: {
            mode: "meta_tool_proxy",
            toolSlug,
            serverUrl,
            serverName: proxyServerName,
          },
        };
      } catch (err) {
        const msg = formatToolCallError(err);
        console.warn("[tool-router] Meta-tool proxy attempt failed", {
          toolSlug,
          serverUrl,
          proxyServerName,
          sessionId: typeof client.getSessionId === "function" ? client.getSessionId() : undefined,
          error: msg,
        });
        if (msg.includes("not found")) continue; // Try next proxy session
        continue; // Other error, try next proxy session
      }
    }
  } finally {
    multi.disconnect();
  }

  const strictDiscovery = isStrictToolDiscoveryEnabled();
  if (strictDiscovery) {
    console.error("[tool-router] Strict discovery blocked fallback", {
      userId,
      toolSlug,
      contextSessionId: contextSessionId ?? null,
    });
    throw new Error(
      `No connected MCP session advertised tool "${toolSlug}" via listTools(). ` +
        `Strict discovery is enabled by default, so fallback using context.session_id is disabled. ` +
        `Set WORKFLOW_SCRIPT_ALLOW_CONTEXT_SESSION_FALLBACK=true to opt in to the legacy fallback behavior.`
    );
  }

  if (contextSessionId) {
    const client = new MCPClient({ identity: userId, sessionId: contextSessionId });
    const contextSessionUrl = client.getServerUrl() || undefined;
    try {
      try {
        console.warn("[tool-router] Using legacy context-session fallback", {
          userId,
          toolSlug,
          contextSessionId,
          contextSessionUrl: contextSessionUrl ?? null,
        });
        await client.connect();
        return {
          raw: await client.callTool(toolSlug, args),
          meta: {
            mode: "context_session_fallback",
            toolSlug,
            serverUrl: contextSessionUrl,
            warning:
              `Tool "${toolSlug}" ran on the workflow context session because no connected session advertised it via listTools(). ` +
              `This legacy fallback is opt-in; remove WORKFLOW_SCRIPT_ALLOW_CONTEXT_SESSION_FALLBACK or enable WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY=true to disable it.`,
          },
        };
      } catch (err) {
        const advertisedNote = lastAdvertisedFailure
          ? ` Last advertised-session failure: ${lastAdvertisedFailure.serverUrl ?? "<unknown url>"}: ${lastAdvertisedFailure.message}`
          : "";
        console.error("[tool-router] Context-session fallback failed", {
          userId,
          toolSlug,
          contextSessionId,
          contextSessionUrl: contextSessionUrl ?? null,
          error: formatToolCallError(err),
          advertisedFailure: lastAdvertisedFailure,
        });
        throw new Error(
          `Context session fallback failed for tool "${toolSlug}" using session "${contextSessionId}" at ${contextSessionUrl ?? "<unknown url>"}: ` +
            `${formatToolCallError(err)}.${advertisedNote}`
        );
      }
    } finally {
      try {
        client.disconnect("script-runner-context-session-fallback");
      } catch {
        /* ignore */
      }
      try {
        client.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  if (lastAdvertisedFailure) {
    console.error("[tool-router] Tool advertised but execution failed on all candidate sessions", {
      userId,
      toolSlug,
      lastAdvertisedFailure,
    });
    throw new Error(
      `Tool "${toolSlug}" was advertised but failed to execute at ${lastAdvertisedFailure.serverUrl ?? "<unknown url>"}: ` +
        `${lastAdvertisedFailure.message}`
    );
  }

  console.error("[tool-router] No connected MCP session exposes requested tool", {
    userId,
    toolSlug,
  });
  throw new Error(
    `No connected MCP session exposes tool "${toolSlug}". ` +
      `Connect the server that provides this tool (e.g. Zapier) in the same account.`
  );
}

