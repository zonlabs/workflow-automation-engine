import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerWorkflowMcpCoreTools,
  type RegisterWorkflowMcpCoreToolsOptions,
} from "./workflow-tools-core";
import { registerWorkflowRunTool } from "./workflow-run-tool";

export type RegisterWorkflowMcpWebToolsOptions = RegisterWorkflowMcpCoreToolsOptions;

/**
 * Registers the full workflow MCP tool set for the Next.js `workflow-mcp-web` app
 * (same tools as Express `mcp-server`): Supabase-backed tools + `workflow_run` (BullMQ).
 *
 * Requires **`REDIS_URL`** (or `REDIS_*` / Railway-style vars) reachable from the host —
 * same Redis as the BullMQ **worker**. See `workflow-mcp-web/README.md` for operational notes.
 */
export function registerWorkflowMcpWebTools(
  server: McpServer,
  options?: RegisterWorkflowMcpWebToolsOptions
): void {
  registerWorkflowMcpCoreTools(server, options);
  registerWorkflowRunTool(server);
}
