import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkflowMcpCoreTools } from "./workflow-tools-core";
import { registerWorkflowRunTool } from "./workflow-run-tool";

/**
 * Registers the full workflow MCP tool set for the Next.js `workflow-mcp-web` app
 * (same tools as Express `mcp-server`): Supabase-backed tools + `workflow_run` (BullMQ).
 *
 * Requires **`REDIS_URL`** (or `REDIS_*` / Railway-style vars) reachable from the host —
 * same Redis as the BullMQ **worker**. See `workflow-mcp-web/README.md` for operational notes.
 */
export function registerWorkflowMcpWebTools(server: McpServer): void {
  registerWorkflowMcpCoreTools(server);
  registerWorkflowRunTool(server);
}
