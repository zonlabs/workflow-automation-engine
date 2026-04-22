import "dotenv/config";
import cors from "cors";
import bodyParser = require("body-parser");
import expressModule = require("express");
import type { Request, Response } from "express-serve-static-core";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serviceRegistry } from "../src/application/service-registry";
import { createMcpServer } from "./server";
import { resolveUserIdFromRequest } from "./auth";
import { runWithRequestContext } from "./request-context";
import { getIssuer } from "./oauth/config";
import { mountWorkflowOAuth } from "./oauth/mount";

export async function startStreamableHttpServer(createServer: () => McpServer) {
  const port = parseInt(process.env.WORKFLOW_MCP_PORT ?? "3002", 10);
  const app = expressModule();
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json({ limit: "2mb" }));

  mountWorkflowOAuth(app);

  const helperToken = process.env.WORKFLOW_SCRIPT_HELPER_TOKEN;

  const resourceUrl =
    process.env.WORKFLOW_MCP_RESOURCE_URL ?? `http://localhost:${port}/mcp`;
  const resourceDocUrl = process.env.WORKFLOW_MCP_RESOURCE_DOC_URL ?? resourceUrl;
  const issuer = getIssuer();

  console.log("[mcp-server] Starting streamable HTTP server", {
    port,
    resourceUrl,
    issuer,
    helperTokenConfigured: !!helperToken,
    workflowScriptRunnerMode: process.env.WORKFLOW_SCRIPT_RUNNER_MODE ?? "local",
    workflowScriptRunnerUrl: process.env.WORKFLOW_SCRIPT_RUNNER_URL ?? null,
    workflowScriptHelperUrl: process.env.WORKFLOW_SCRIPT_HELPER_URL ?? null,
    strictToolDiscovery: process.env.WORKFLOW_SCRIPT_STRICT_TOOL_DISCOVERY ?? null,
    allowContextSessionFallback: process.env.WORKFLOW_SCRIPT_ALLOW_CONTEXT_SESSION_FALLBACK ?? null,
  });

  const resourceMetadataUrlValue = `${resourceUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;

  const WWW_HEADER = {
    HeaderKey: "WWW-Authenticate",
    HeaderValue: `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrlValue}"`,
  };

  function requireHelperAuth(req: Request, res: Response): boolean {
    if (!helperToken) return true;
    const auth = req.headers["authorization"];
    if (!auth || typeof auth !== "string") {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1] !== helperToken) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource: resourceUrl,
      resource_documentation: resourceDocUrl,
    });
  });

  async function authGate(req: Request, res: Response): Promise<string | null> {
    const userId = await resolveUserIdFromRequest(req);
    if (!userId) {
      res.status(401).set(WWW_HEADER.HeaderKey, WWW_HEADER.HeaderValue).json({
        error: "unauthorized",
        error_description: `Missing or invalid bearer token. Use a workflow API key (wfmcp_…) or Supabase JWT, or complete OAuth: ${issuer}/oauth/authorize`,
      });
      return null;
    }
    return userId;
  }

  app.post("/script-helper/tool", async (req: Request, res: Response) => {
    if (!requireHelperAuth(req, res)) return;
    try {
      const { tool_slug, arguments: args, context, server_name } = req.body ?? {};
      console.log("[mcp-server] Received script-helper tool request", {
        toolSlug: tool_slug ?? null,
        userId: context?.user_id ?? null,
        contextSessionId: context?.session_id ?? null,
        serverNameHint: server_name ?? null,
        argumentKeys: Object.keys((args ?? {}) as Record<string, unknown>),
      });
      const result = await serviceRegistry.scriptHelperService.handleToolCall(req.body ?? {});
      console.log("[mcp-server] Script-helper tool request completed", {
        toolSlug: String(tool_slug ?? ""),
        userId: context?.user_id ?? null,
        resolutionMode: result.meta.mode,
        serverUrl: result.meta.serverUrl ?? null,
        serverName: result.meta.serverName ?? null,
      });
      res.json(result);
    } catch (err) {
      console.error("[mcp-server] Script-helper tool request failed", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Tool call failed" });
    }
  });

  app.post("/script-helper/llm", async (req: Request, res: Response) => {
    if (!requireHelperAuth(req, res)) return;
    try {
      const output = await serviceRegistry.scriptHelperService.handleLlmCall(req.body ?? {});
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "LLM call failed" });
    }
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  function isInitializeRequest(body: unknown) {
    return (body as { method?: string })?.method === "initialize";
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    if (req.path.startsWith("/script-helper")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = await authGate(req, res);
    if (!userId) return;

    const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? "";
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };

      const server = createServer();
      await server.connect(transport);
    }

    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return;
    }

    await runWithRequestContext({ userId }, async () => {
      try {
        await transport.handleRequest(req, res, req.body);
        const newSessionId = transport.sessionId;
        if (newSessionId && !transports[newSessionId]) {
          transports[newSessionId] = transport;
        }
      } catch (error) {
        console.error("MCP error:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const userId = await authGate(req, res);
    if (!userId) return;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(404).send("Session not found");
      return;
    }
    await runWithRequestContext({ userId }, async () => {
      await transports[sessionId]!.handleRequest(req, res);
    });
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const userId = await authGate(req, res);
    if (!userId) return;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(404).send("Session not found");
      return;
    }
    await runWithRequestContext({ userId }, async () => {
      await transports[sessionId]!.handleRequest(req, res);
    });
  });

  const httpServer = app.listen(port, (err?: unknown) => {
    if (err) {
      console.error("Failed to start MCP server:", err);
      process.exit(1);
    }
    console.log(`Workflow MCP server listening on http://localhost:${port}/mcp`);
    console.log(`OAuth issuer (authorization server): ${issuer}`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(createServer: () => McpServer) {
  await createServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createMcpServer);
  } else {
    await startStreamableHttpServer(createMcpServer);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
