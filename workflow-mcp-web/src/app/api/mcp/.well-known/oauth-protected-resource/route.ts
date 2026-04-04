import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { getIssuer } from "@engine/mcp-server/oauth/config";
import { resolveMcpOAuthResourceUrls } from "@/lib/mcp-oauth-resource-url";

export const runtime = "nodejs";

/**
 * Matches Express / mcp-handler `resource_metadata` when `WORKFLOW_MCP_RESOURCE_URL` includes `/api/mcp`:
 * `{resourceUrl}/.well-known/oauth-protected-resource`
 */
export async function GET(req: Request) {
  const { protectedResourceUri } = resolveMcpOAuthResourceUrls();
  const resourceUrl =
    protectedResourceUri ?? `${new URL(req.url).origin}/api/mcp`;
  const getHandler = protectedResourceHandler({
    authServerUrls: [getIssuer()],
    resourceUrl,
  });
  return getHandler(req);
}

const optionsFn = metadataCorsOptionsRequestHandler();

export function OPTIONS() {
  return optionsFn();
}
