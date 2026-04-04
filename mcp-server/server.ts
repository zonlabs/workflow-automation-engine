import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkflowMcpCoreTools } from "./workflow-tools-core";
import { registerWorkflowRunTool } from "./workflow-run-tool";

/** Full tool set for long-running MCP (Express): includes BullMQ `workflow_run`. */
export function registerWorkflowMcpTools(server: McpServer): void {
  registerWorkflowMcpCoreTools(server);
  registerWorkflowRunTool(server);
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "workflow-automation-engine",
    version: "1.0.0",
  });
  registerWorkflowMcpTools(server);
  return server;
}
