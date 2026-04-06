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
  mode: "listed_session" | "hint_session_fallback";
  toolSlug: string;
  serverUrl?: string;
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

export async function callToolAcrossSessions(
  userId: string,
  toolSlug: string,
  args: Record<string, unknown>,
  hintSessionId?: string
): Promise<{ raw: unknown; meta: ToolResolutionMeta }> {
  const multi = new MultiSessionClient(userId);
  let lastAdvertisedFailure: { serverUrl?: string; message: string } | null = null;
  try {
    await multi.connect();
    const clients = sortClientsForToolSlug(multi.getClients(), toolSlug);

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
  } finally {
    multi.disconnect();
  }

  const strictDiscovery =
    String(process.env.WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY ?? "").trim().toLowerCase() === "true";
  if (strictDiscovery) {
    throw new Error(
      `No connected MCP session advertised tool "${toolSlug}" via listTools(). ` +
        `Strict discovery is enabled (WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY=true), so hint-session fallback is disabled.`
    );
  }

  if (hintSessionId) {
    const client = new MCPClient({ identity: userId, sessionId: hintSessionId });
    const hintedUrl = client.getServerUrl() || undefined;
    try {
      try {
        await client.connect();
        return {
          raw: await client.callTool(toolSlug, args),
          meta: {
            mode: "hint_session_fallback",
            toolSlug,
            serverUrl: hintedUrl,
            warning:
              `Tool "${toolSlug}" was executed via hint-session fallback because no connected session advertised it via listTools(). ` +
              `If this is unexpected, enable strict mode with WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY=true.`,
          },
        };
      } catch (err) {
        const advertisedNote = lastAdvertisedFailure
          ? ` Last advertised-session failure: ${lastAdvertisedFailure.serverUrl ?? "<unknown url>"}: ${lastAdvertisedFailure.message}`
          : "";
        throw new Error(
          `Hint-session fallback failed for tool "${toolSlug}" using session "${hintSessionId}" at ${hintedUrl ?? "<unknown url>"}: ` +
            `${formatToolCallError(err)}.${advertisedNote}`
        );
      }
    } finally {
      try {
        client.disconnect("script-runner-hint-fallback");
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
