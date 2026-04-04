import { MCPClient } from "@mcp-ts/sdk/server";
import { unwrapMcpToolCallResult } from "@engine/src/lib/mcp-tool-output";
import { verifyScriptHelperAuth } from "@/lib/verify-script-helper-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const authError = verifyScriptHelperAuth(req);
  if (authError) return authError;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const tool_slug = String(body?.tool_slug ?? "");
    const args = (body?.arguments ?? {}) as Record<string, unknown>;
    const context = (body?.context ?? {}) as Record<string, unknown>;

    if (!tool_slug) {
      return Response.json({ error: "tool_slug is required" }, { status: 400 });
    }
    const userId = String(context?.user_id ?? "");
    const sessionId = String(context?.session_id ?? "");
    if (!userId || !sessionId) {
      return Response.json(
        { error: "context.user_id and context.session_id are required" },
        { status: 400 }
      );
    }

    const client = new MCPClient({ identity: userId, sessionId });
    try {
      await client.connect();
      const raw = await client.callTool(tool_slug, args);
      return Response.json({ output: unwrapMcpToolCallResult(raw) });
    } finally {
      try {
        await client.disconnect("script-helper-tool");
      } catch {
        /* ignore */
      }
      try {
        client.dispose();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Tool call failed" },
      { status: 500 }
    );
  }
}
