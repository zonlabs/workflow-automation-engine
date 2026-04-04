import { withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { resolveSupabaseUserIdFromCredential } from "@engine/mcp-server/auth";
import { resolveMcpOAuthResourceUrls } from "@/lib/mcp-oauth-resource-url";
import { handleStreamableMcpRequest } from "@/lib/streamable-mcp-session";

const resourceMetadataPath = "/.well-known/oauth-protected-resource";
const { authResourceBase } = resolveMcpOAuthResourceUrls();

async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken?.trim()) return undefined;
  const userId = await resolveSupabaseUserIdFromCredential(bearerToken);
  if (!userId) return undefined;
  return {
    token: bearerToken,
    clientId: "workflow-mcp",
    scopes: ["workflow"],
    extra: { userId },
  };
}

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function mcpAuthRequired(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return envTruthy("WORKFLOW_MCP_AUTH_REQUIRED") || envTruthy("WORKFLOW_MCP_OAUTH_DEV");
}

type RequestWithAuth = Request & { auth?: AuthInfo };

/**
 * Streamable HTTP + sessions: `handleStreamableMcpRequest` (not `createMcpHandler`), so POST
 * `initialize` and follow-up GET share one transport. We still use `mcp-handler` only for
 * `withMcpAuth` (Bearer + `resource_metadata` URLs) and protected-resource helpers.
 */
async function mcpCore(req: Request): Promise<Response> {
  const r = req as RequestWithAuth;
  return handleStreamableMcpRequest(req, r.auth);
}

export const workflowMcpHandler = withMcpAuth(mcpCore, verifyToken, {
  required: mcpAuthRequired(),
  resourceMetadataPath,
  ...(authResourceBase ? { resourceUrl: authResourceBase } : {}),
});

/** Normalize trailing slash so pathname is exactly `/api/mcp`. */
export function normalizeRequestUrl(req: Request): Request {
  const url = new URL(req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
    return new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.body,
      duplex: req.body ? "half" : undefined,
    } as RequestInit);
  }
  return req;
}
