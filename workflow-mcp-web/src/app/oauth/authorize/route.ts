import { oauthAuthorizeGet, oauthAuthorizePost } from "@engine/mcp-server/oauth/web-routes";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return oauthAuthorizeGet(url.searchParams);
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/x-www-form-urlencoded")) {
    return new Response("Expected application/x-www-form-urlencoded", { status: 415 });
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  const form: Record<string, string> = {};
  params.forEach((v, k) => {
    form[k] = v;
  });
  return oauthAuthorizePost(form);
}
