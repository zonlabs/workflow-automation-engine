import { oauthTokenPost } from "@engine/mcp-server/oauth/web-routes";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  let params: Record<string, string>;

  if (ct.includes("application/json")) {
    try {
      const j = (await req.json()) as Record<string, unknown>;
      params = {};
      for (const [k, v] of Object.entries(j)) {
        params[k] = v == null ? "" : String(v);
      }
    } catch {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    const text = await req.text();
    const sp = new URLSearchParams(text);
    params = {};
    sp.forEach((v, k) => {
      params[k] = v;
    });
  }

  return oauthTokenPost(params);
}
