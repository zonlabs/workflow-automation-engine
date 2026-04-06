import { unwrapMcpToolCallResult } from "@engine/src/lib/mcp-tool-output";
import { callToolAcrossSessions } from "@engine/script-runner/mcp-tool-router";
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

    console.log("[script-helper/tool] received:", {
      tool_slug,
      arguments: args,
      context,
      user_id: context?.user_id,
      session_id: context?.session_id,
      body_keys: Object.keys(body),
    });

    if (!tool_slug) {
      return Response.json({ error: "tool_slug is required" }, { status: 400 });
    }
    const userId = String(context?.user_id ?? "");
    if (!userId) {
      return Response.json({ error: "context.user_id is required" }, { status: 400 });
    }
    const contextSessionId =
      context?.session_id != null && String(context.session_id).trim()
        ? String(context.session_id).trim()
        : undefined;

    const { raw, meta } = await callToolAcrossSessions(userId, tool_slug, args, contextSessionId);
    return Response.json({ output: unwrapMcpToolCallResult(raw), meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool call failed";
    try {
      const asAny = err as { stack?: string; cause?: unknown; response?: unknown };
      console.error("[script-helper/tool] Tool call failed:", message, {
        stack: asAny?.stack,
        cause: asAny?.cause,
        response: asAny?.response,
      });
    } catch {
      console.error("[script-helper/tool] Tool call failed:", message);
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
