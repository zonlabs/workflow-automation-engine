# Workflow MCP on Vercel (Next.js + mcp-handler)

This app hosts the workflow automation **MCP server** using [mcp-handler](https://github.com/vercel/mcp-handler) (Streamable HTTP, SSE disabled). It imports tool implementations from the parent `workflow-automation-engine` package via the `@engine/*` path alias.

**Tools:** the MCP route calls **`registerWorkflowMcpWebTools`** from **`mcp-server/workflow-mcp-web-tools.ts`**, matching the Express `mcp-server` tool set (core + **`workflow_run`**). That module is separate from `server.ts` so the Next bundler only pulls MCP-related files.

## `workflow_run` on Vercel (Redis + BullMQ)

`workflow_run` enqueues a BullMQ job. The hosted route must reach the **same Redis** as your **worker** (`REDIS_URL` or equivalent). That usually works; watch for:

| Topic | What to watch |
|--------|----------------|
| **Redis product** | Use a network Redis (Upstash, Redis Cloud, Elasticache, etc.). BullMQ needs standard Redis commands; verify your provider supports blocking ops / pub-sub if you use advanced BullMQ features (basic enqueue is fine on most). |
| **Cold starts** | Each new function instance may open new ioredis connections. At scale, many concurrent instances ⇒ more connections — stay within your Redis `maxclients` (or use a pool-friendly setup). |
| **Latency** | Enqueue is normally fast; slow Redis or TLS far away can push you toward the function timeout. |
| **Build / local** | Without Redis, `next build` may log connection errors while analyzing routes; set `REDIS_URL` in production on Vercel. |

## Alternative: HTTP API instead of MCP `workflow_run`

You can expose **`POST /api/workflows/run`** (or similar) that only enqueues, and either:

- drop `workflow_run` from MCP again and have clients call the API, or  
- keep a thin MCP tool that `fetch`es your own API (same auth story).

**Pros:** MCP bundle can stay smaller; you can add rate limits, API keys, or idempotency in one place.  
**Cons:** two surfaces to secure and document; Cursor/native MCP clients expect a tool, not a random REST call, unless you wrap it.

## Deploy

1. Create a Vercel project with **root directory** `workflow-automation-engine/workflow-mcp-web` (or deploy from monorepo with that subdirectory).
2. In Vercel → Project → Settings → Functions: enable **Fluid compute** and set an appropriate **max duration** for `/api/mcp` (this repo sets `maxDuration = 300` in the route).
3. Add environment variables from `.env.example` (match your worker/Redis/Supabase setup).

## URLs

| Path | Purpose |
|------|---------|
| `POST /api/mcp` | MCP Streamable HTTP (Cursor: use this URL) |
| `GET/POST /oauth/*` | OAuth 2.x for MCP clients (PKCE + dynamic registration) |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata |
| `POST /api/script-helper/tool` | Vercel Sandbox → MCP tool calls |
| `POST /api/script-helper/llm` | Vercel Sandbox → LLM |

## Cursor

```json
{
  "mcpServers": {
    "workflow": {
      "url": "https://YOUR_DEPLOYMENT.vercel.app/api/mcp"
    }
  }
}
```

Authenticate with a Supabase JWT or `wfmcp_…` API key (same as the Express `mcp-server`).

## Notes

- **Redis** (`REDIS_URL`): **required for `workflow_run`** (BullMQ enqueue). Also recommended for OAuth **dynamic client registration** across deploy instances. Without Redis, OAuth clients fall back to in-memory only per instance.
- Set **`WORKFLOW_OAUTH_ISSUER`** and **`WORKFLOW_MCP_RESOURCE_URL`** to your real `https://…` URLs in production (issuer defaults to `https://$VERCEL_URL` if unset).
- **`WORKFLOW_OAUTH_CODE_SECRET`**: required in production for authorization codes (see `mcp-server/oauth/auth-code.ts`).

## Local dev

```bash
cd workflow-mcp-web
cp .env.example .env.local
# fill env; run Redis locally if using OAuth register or queues
npm install
npm run dev
```

MCP URL: `http://localhost:3000/api/mcp`
