import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildExecutionChartPanel, type ChartLog } from "./execution-chart-svg";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function textFromResult(result: CallToolResult): string | null {
  const block = result.content?.find((c) => c.type === "text" && "text" in c) as
    | { type: "text"; text: string }
    | undefined;
  return block?.text ?? null;
}

function renderFromToolResult(result: CallToolResult): void {
  const root = document.getElementById("root");
  if (!root) return;

  if (result.isError) {
    const t = textFromResult(result);
    root.innerHTML = `<div class="chart-page"><p class="err">${esc(t ?? "Tool error")}</p></div>`;
    return;
  }

  const raw = textFromResult(result);
  if (!raw) {
    root.innerHTML = '<div class="chart-page"><p class="muted">No data.</p></div>';
    return;
  }

  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    let name = "Recent executions";
    let logs: ChartLog[] = [];
    if (Array.isArray(o.logs)) {
      logs = o.logs as ChartLog[];
      name = typeof o.workflow_name === "string" ? o.workflow_name : "Recent executions";
    } else if (o.execution_log && typeof o.execution_log === "object") {
      const el = o.execution_log as Record<string, unknown>;
      name = typeof o.workflow_name === "string" ? o.workflow_name : "Workflow";
      logs = [
        {
          status: String(el.status ?? ""),
          created_at: String(el.created_at ?? el.started_at ?? ""),
          duration_ms: typeof el.duration_ms === "number" ? el.duration_ms : null,
        },
      ];
    }
    root.innerHTML = `<div class="chart-page">
      <header class="chart-page-head">
        <h1 class="chart-page-title">Execution analytics</h1>
        <p class="muted tiny">Workflow MCP · from <code>execution_log_list</code> / <code>execution_log_get</code></p>
      </header>
      ${buildExecutionChartPanel(name, logs)}
    </div>`;
  } catch {
    root.innerHTML = `<div class="chart-page"><pre class="raw">${esc(raw)}</pre></div>`;
  }
}

async function main(): Promise<void> {
  const app = new App(
    { name: "workflow-mcp-execution-chart", version: "1.0.0" },
    { tools: {} },
    { autoResize: true }
  );

  app.ontoolresult = (params: CallToolResult) => {
    renderFromToolResult(params);
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  };

  await app.connect();
}

void main().catch((e) => {
  console.error(e);
  const root = document.getElementById("root");
  if (root) root.textContent = String(e instanceof Error ? e.message : e);
});
