import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { getIssuer } from "@engine/mcp-server/oauth/config";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const resourceUrl = process.env.WORKFLOW_MCP_RESOURCE_URL?.replace(/\/$/, "");
  const getHandler = protectedResourceHandler({
    authServerUrls: [getIssuer()],
    ...(resourceUrl ? { resourceUrl } : {}),
  });
  return getHandler(req);
}

const optionsFn = metadataCorsOptionsRequestHandler();

export function OPTIONS() {
  return optionsFn();
}
