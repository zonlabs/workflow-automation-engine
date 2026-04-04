import { oauthAuthorizationServerMetadataResponse } from "@engine/mcp-server/oauth/web-routes";

export const runtime = "nodejs";

export function GET() {
  return oauthAuthorizationServerMetadataResponse();
}
