import { oauthRegisterPost } from "@engine/mcp-server/oauth/web-routes";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  return oauthRegisterPost(body);
}
