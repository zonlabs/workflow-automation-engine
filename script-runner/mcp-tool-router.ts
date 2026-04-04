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

export async function callToolAcrossSessions(
  userId: string,
  toolSlug: string,
  args: Record<string, unknown>,
  hintSessionId?: string
): Promise<unknown> {
  const multi = new MultiSessionClient(userId);
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
      return await c.callTool(toolSlug, args);
    }
  } finally {
    multi.disconnect();
  }

  if (hintSessionId) {
    const client = new MCPClient({ identity: userId, sessionId: hintSessionId });
    try {
      await client.connect();
      return await client.callTool(toolSlug, args);
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

  throw new Error(
    `No connected MCP session exposes tool "${toolSlug}". ` +
      `Connect the server that provides this tool (e.g. Zapier) in the same account.`
  );
}
