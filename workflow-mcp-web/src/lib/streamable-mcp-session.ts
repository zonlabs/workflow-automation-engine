import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { registerWorkflowMcpWebTools } from "@engine/mcp-server/workflow-mcp-web-tools";
import { runWithRequestContext } from "@engine/mcp-server/request-context";
import {
  registerWorkflowMcpApp,
  WORKFLOW_MCP_EXECUTION_CHART_URI,
} from "@/lib/register-workflow-mcp-app";

type Session = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
};

declare global {
  var __workflowMcpSessions: Map<string, Session> | undefined;
}

function sessionMap(): Map<string, Session> {
  if (!globalThis.__workflowMcpSessions) {
    globalThis.__workflowMcpSessions = new Map();
  }
  return globalThis.__workflowMcpSessions;
}

function isInitializeBody(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(
      (m) => m && typeof m === "object" && (m as { method?: string }).method === "initialize"
    );
  }
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { method?: string }).method === "initialize"
  );
}

type RequestWithAuth = Request & { auth?: AuthInfo };

function userIdFromRequest(req: RequestWithAuth): string | undefined {
  const u = req.auth?.extra?.userId;
  return typeof u === "string" && u.trim() ? u.trim() : undefined;
}

function jsonRpcSessionNotFound(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_001, message: "Session not found" },
      id: null,
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Streamable HTTP MCP with an in-memory session map (same idea as `mcp-server/main.ts`).
 * `mcp-handler`'s `createMcpHandler` creates a new transport per request, so POST `initialize`
 * and follow-up GET never share a session — OAuth + Cursor break.
 */
export async function handleStreamableMcpRequest(
  req: Request,
  auth?: AuthInfo
): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/mcp") {
    return new Response("Not found", { status: 404 });
  }

  const sessions = sessionMap();
  const reqWithAuth = req as RequestWithAuth;
  reqWithAuth.auth = auth;
  const uid = userIdFromRequest(reqWithAuth);

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    uid ? runWithRequestContext({ userId: uid }, fn) : fn();

  const sessionHeader = req.headers.get("mcp-session-id")?.trim() ?? "";
  let session = sessionHeader ? sessions.get(sessionHeader) : undefined;

  if (req.method === "POST") {
    const bodyText = await req.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32_700, message: "Parse error: invalid JSON" },
          id: null,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!session && isInitializeBody(body)) {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessionclosed: (sid) => {
          if (sid) sessions.delete(sid);
        },
      });
      const server = new McpServer(
        { name: "workflow-mcp-web", version: "1.0.0" },
        {}
      );
      registerWorkflowMcpApp(server);
      registerWorkflowMcpWebTools(
        server as unknown as Parameters<typeof registerWorkflowMcpWebTools>[0],
        {
          executionChartResourceUri: WORKFLOW_MCP_EXECUTION_CHART_URI,
          registerAppToolForExecutionLogs: registerAppTool,
        }
      );
      await server.connect(transport);
      session = { transport, server };
    }

    if (!session) {
      return jsonRpcSessionNotFound();
    }

    return run(async () => {
      const webReq = new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: bodyText,
      }) as RequestWithAuth;
      webReq.auth = auth;
      const webResp = await session!.transport.handleRequest(webReq, { authInfo: auth });
      const sid = session!.transport.sessionId;
      if (sid && !sessions.has(sid)) {
        sessions.set(sid, session!);
      }
      return webResp;
    });
  }

  if (req.method === "GET" || req.method === "DELETE") {
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }
    return run(() =>
      session!.transport.handleRequest(reqWithAuth, { authInfo: auth })
    );
  }

  return new Response(null, { status: 405 });
}
