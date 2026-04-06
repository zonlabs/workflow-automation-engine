import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listWorkflowsMcpResult } from "@engine/mcp-server/workflow-tools-core";
import { buildWorkflowMcpDashboardHtml } from "@/lib/workflow-mcp-dashboard-html";
import { buildWorkflowMcpExecutionChartHtml } from "@/lib/workflow-mcp-execution-chart-html";

export const WORKFLOW_MCP_DASHBOARD_URI = "ui://workflow-engine/dashboard.html";
export const WORKFLOW_MCP_EXECUTION_CHART_URI = "ui://workflow-engine/execution-chart.html";

/**
 * Registers MCP App HTML resources (dashboard + execution chart) and `workflow_open_dashboard`.
 * Execution chart UI is attached to `execution_log_list` / `execution_log_get` via
 * `registerWorkflowMcpWebTools(server, { executionChartResourceUri: WORKFLOW_MCP_EXECUTION_CHART_URI })`
 * (see `streamable-mcp-session.ts`).
 */
export function registerWorkflowMcpApp(server: McpServer): void {
  registerAppResource(
    server,
    "Workflow MCP dashboard",
    WORKFLOW_MCP_DASHBOARD_URI,
    {
      description: "Interactive table of workflows (MCP Apps UI).",
    },
    async () => ({
      contents: [
        {
          uri: WORKFLOW_MCP_DASHBOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildWorkflowMcpDashboardHtml(),
        },
      ],
    })
  );

  registerAppTool(
    server,
    "workflow_open_dashboard",
    {
      title: "Open workflow dashboard (MCP App)",
      description:
        "Shows your workflows in an interactive MCP App UI when the host supports it; otherwise the JSON payload matches workflow_list.",
      inputSchema: {
        user_id: z
          .string()
          .optional()
          .describe("Supabase auth.users id (UUID). Defaults to the Bearer-authenticated user."),
        limit: z.number().optional(),
      },
      _meta: {
        ui: { resourceUri: WORKFLOW_MCP_DASHBOARD_URI },
      },
    },
    async ({ user_id, limit }, extra) => listWorkflowsMcpResult({ user_id, limit }, extra)
  );

  registerAppResource(
    server,
    "Workflow execution chart",
    WORKFLOW_MCP_EXECUTION_CHART_URI,
    {
      description:
        "Timeline chart for execution log tool results (`execution_log_list` / `execution_log_get` share this MCP App UI).",
    },
    async () => ({
      contents: [
        {
          uri: WORKFLOW_MCP_EXECUTION_CHART_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildWorkflowMcpExecutionChartHtml(),
        },
      ],
    })
  );
}
