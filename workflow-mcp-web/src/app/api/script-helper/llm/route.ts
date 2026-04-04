import { generateText } from "ai";
import { resolveModel } from "@engine/src/lib/ai/provider-registry";
import { verifyScriptHelperAuth } from "@/lib/verify-script-helper-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const authError = verifyScriptHelperAuth(req);
  if (authError) return authError;

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
