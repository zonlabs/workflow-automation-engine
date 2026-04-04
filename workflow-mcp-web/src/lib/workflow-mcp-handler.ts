import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerWorkflowMcpWebTools } from "@engine/mcp-server/workflow-mcp-web-tools";
import { resolveSupabaseUserIdFromCredential } from "@engine/mcp-server/auth";

const resourceMetadataPath = "/.well-known/oauth-protected-resource";

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

const mcp = createMcpHandler(
  async (server) => {
    registerWorkflowMcpWebTools(
      server as unknown as Parameters<typeof registerWorkflowMcpWebTools>[0]
    );
  },
  {
    serverInfo: {
      name: "workflow-automation-engine",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api",
    // Streamable HTTP only (current MCP transport guidance). SSE is deprecated; mcp-handler can still expose /api/sse if enabled — we keep it off.
    disableSse: true,
    maxDuration: 300,
    verboseLogs: process.env.WORKFLOW_MCP_VERBOSE === "1",
  }
);

const resourceUrl = process.env.WORKFLOW_MCP_RESOURCE_URL?.replace(/\/$/, "");

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function mcpAuthRequired(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return envTruthy("WORKFLOW_MCP_AUTH_REQUIRED") || envTruthy("WORKFLOW_MCP_OAUTH_DEV");
}

/** Handler for `/api/mcp` only (streamable HTTP). */
export const workflowMcpHandler = withMcpAuth(mcp, verifyToken, {
  required: mcpAuthRequired(),
  resourceMetadataPath,
  ...(resourceUrl ? { resourceUrl } : {}),
});

/** Normalize trailing slash so mcp-handler pathname matches `/api/mcp` (not `/api/mcp/`). */
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
