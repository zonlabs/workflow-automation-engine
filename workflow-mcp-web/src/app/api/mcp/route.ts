import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerWorkflowMcpWebTools } from "@engine/mcp-server/workflow-mcp-web-tools";
import { resolveSupabaseUserIdFromCredential } from "@engine/mcp-server/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    // `mcp-handler` and `@engine/mcp-server` can resolve different physical copies of
    // `@modelcontextprotocol/sdk` (e.g. app `node_modules` vs parent). Types differ; runtime is the same API.
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

/**
 * Production (`next start`, Vercel): Bearer auth is always required.
 * Development (`next dev`): optional by default. Set `WORKFLOW_MCP_OAUTH_DEV=1` or `WORKFLOW_MCP_AUTH_REQUIRED=1` to require Bearer (full OAuth + PKCE with your MCP client).
 */
function mcpAuthRequired(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return envTruthy("WORKFLOW_MCP_AUTH_REQUIRED") || envTruthy("WORKFLOW_MCP_OAUTH_DEV");
}

const handler = withMcpAuth(mcp, verifyToken, {
  required: mcpAuthRequired(),
  resourceMetadataPath,
  ...(resourceUrl ? { resourceUrl } : {}),
});

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}

export async function DELETE(req: Request) {
  return handler(req);
}
