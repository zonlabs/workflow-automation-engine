import { generateText } from "ai";
import { resolveModel } from "@engine/src/lib/ai/provider-registry";

export const runtime = "nodejs";

function requireHelperAuth(req: Request): Response | null {
  const helperToken = process.env.WORKFLOW_SCRIPT_HELPER_TOKEN;
  if (!helperToken) return null;
  const auth = req.headers.get("authorization");
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== helperToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export async function POST(req: Request) {
  const denied = requireHelperAuth(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const prompt = String(body?.prompt ?? "");
    const modelSlug = String(body?.model ?? "");
    if (!prompt) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }
    const { model } = resolveModel(modelSlug);
    const result = await generateText({
      model,
      prompt,
      maxRetries: 2,
    });
    return Response.json({ output: result.text });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "LLM call failed" },
      { status: 500 }
    );
  }
}
