import "dotenv/config";
import cors from "cors";
import bodyParser = require("body-parser");
import expressModule = require("express");
import type { Request, Response } from "express-serve-static-core";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { unwrapMcpToolCallResult } from "../src/lib/mcp-tool-output";
import { createMcpServer } from "./server";
import { resolveUserIdFromRequest } from "./auth";
import { runWithRequestContext } from "./request-context";
import { MCPClient } from "@mcp-ts/sdk/server";
import { generateText } from "ai";
import { resolveModel } from "../src/lib/ai/provider-registry";
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
      const { tool_slug, arguments: args, context } = req.body ?? {};
      if (!tool_slug) {
        res.status(400).json({ error: "tool_slug is required" });
        return;
      }
      const userId = String(context?.user_id ?? "");
      const sessionId = String(context?.session_id ?? "");
      if (!userId || !sessionId) {
        res.status(400).json({ error: "context.user_id and context.session_id are required" });
        return;
      }
      const client = new MCPClient({ identity: userId, sessionId });
      try {
        await client.connect();
        const raw = await client.callTool(tool_slug, args ?? {});
        res.json({ output: unwrapMcpToolCallResult(raw) });
      } finally {
        try {
          await client.disconnect("script-helper-tool");
        } catch {}
        try {
          client.dispose();
        } catch {}
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Tool call failed" });
    }
  });

  app.post("/script-helper/llm", async (req: Request, res: Response) => {
    if (!requireHelperAuth(req, res)) return;
    try {
      const { prompt, model } = req.body ?? {};
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }
      const { model: resolved } = resolveModel(String(model ?? ""));
      const result = await generateText({ model: resolved, prompt: String(prompt), maxRetries: 2 });
      res.json({ output: result.text });
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
