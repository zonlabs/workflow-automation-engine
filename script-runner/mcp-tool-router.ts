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

/**
 * Try executing `toolSlug` via `mcp_execute_tool` meta-tool on sessions that advertise it.
 * This handles sessions using the `search` strategy where real tools aren't in listTools()
 * but are accessible through the meta-tool proxy.
 */
async function tryMetaToolProxy(
  clients: MCPClient[],
  toolSlug: string,
  args: Record<string, unknown>,
  serverNameHint?: string
): Promise<{ raw: unknown; meta: ToolResolutionMeta } | null> {
  for (const c of clients) {
    let listed: { tools?: Array<{ name?: string }> } | undefined;
    try {
      listed = (await c.listTools()) as { tools?: Array<{ name?: string }> };
    } catch {
      continue;
    }
    const names = listed?.tools ?? [];
    const hasMetaTool = names.some((t) => t?.name === "mcp_execute_tool");
    if (!hasMetaTool) continue;

    const serverUrl = c.getServerUrl() || undefined;
    const proxyServerName =
      (typeof c.getServerName === "function" ? c.getServerName() : undefined) ?? undefined;

    try {
      const proxyArgs: Record<string, unknown> = {
        toolName: toolSlug,
        args,
      };
      if (serverNameHint) {
        proxyArgs.serverName = serverNameHint;
      }

      const result = await c.callTool("mcp_execute_tool", proxyArgs);
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
      // Check if the meta-tool itself reported "not found" for the target tool
      const msg = formatToolCallError(err);
      if (msg.includes("not found")) {
        continue; // Try next session
      }
      // Other errors: still try next session
      continue;
    }
  }
  return null;
}

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

    // Phase 1: Direct tool call on sessions that list the tool
    for (const c of clients) {
      let listed: { tools?: Array<{ name?: string }> } | undefined;
      try {
        listed = (await c.listTools()) as { tools?: Array<{ name?: string }> };
      } catch {
        continue;
      }
      const names = listed?.tools ?? [];
      const has = names.some((t) => t?.name === toolSlug);
      if (!has) continue;

      const serverUrl = c.getServerUrl() || undefined;
      try {
        return {
          raw: await c.callTool(toolSlug, args),
          meta: {
            mode: "listed_session",
            toolSlug,
            serverUrl,
          },
        };
      } catch (err) {
        lastAdvertisedFailure = { serverUrl, message: formatToolCallError(err) };
        continue;
      }
    }

    // Phase 2: Try meta-tool proxy (mcp_execute_tool) on sessions that have it
    const metaResult = await tryMetaToolProxy(clients, toolSlug, args, serverNameHint);
    if (metaResult) {
      return metaResult;
    }
  } finally {
    multi.disconnect();
  }

  const strictDiscovery =
    String(process.env.WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY ?? "").trim().toLowerCase() === "true";
  if (strictDiscovery) {
    throw new Error(
      `No connected MCP session advertised tool "${toolSlug}" via listTools(). ` +
        `Strict discovery is enabled (WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY=true), so fallback using context.session_id is disabled.`
    );
  }

  if (contextSessionId) {
    const client = new MCPClient({ identity: userId, sessionId: contextSessionId });
    const contextSessionUrl = client.getServerUrl() || undefined;
    try {
      try {
        await client.connect();
        return {
          raw: await client.callTool(toolSlug, args),
          meta: {
            mode: "context_session_fallback",
            toolSlug,
            serverUrl: contextSessionUrl,
            warning:
              `Tool "${toolSlug}" ran on the workflow context session because no connected session advertised it via listTools(). ` +
              `If this is unexpected, enable strict mode with WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY=true.`,
          },
        };
      } catch (err) {
        const advertisedNote = lastAdvertisedFailure
          ? ` Last advertised-session failure: ${lastAdvertisedFailure.serverUrl ?? "<unknown url>"}: ${lastAdvertisedFailure.message}`
          : "";
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
    throw new Error(
      `Tool "${toolSlug}" was advertised but failed to execute at ${lastAdvertisedFailure.serverUrl ?? "<unknown url>"}: ` +
        `${lastAdvertisedFailure.message}`
    );
  }

  throw new Error(
    `No connected MCP session exposes tool "${toolSlug}". ` +
      `Connect the server that provides this tool (e.g. Zapier) in the same account.`
  );
}

