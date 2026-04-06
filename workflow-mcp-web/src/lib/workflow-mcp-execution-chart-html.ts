import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLE = "mcp-app-execution-chart.iife.js";

export function buildWorkflowMcpExecutionChartHtml(): string {
  let script = "";
  try {
    script = readFileSync(join(process.cwd(), "public", BUNDLE), "utf8");
  } catch {
    script =
      'document.getElementById("root").textContent = "Build MCP apps: npm run build:mcp-app";';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Execution analytics · Workflow MCP</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
      background: var(--color-background-secondary, #f4f4f5);
      color: var(--color-text-primary, #18181b);
      padding: 16px;
      line-height: 1.45;
    }
    #root { max-width: 520px; margin: 0 auto; }
    .chart-page-head { margin-bottom: 16px; }
    .chart-page-title { font-size: 1.15rem; font-weight: 700; margin: 0 0 6px; }
    .muted { color: var(--color-text-secondary, #71717a); }
    .tiny { font-size: 0.75rem; }
    code { font-family: var(--font-mono, monospace); font-size: 0.75rem; background: #f4f4f5; padding: 2px 6px; border-radius: 4px; }
    .err { color: #b91c1c; }
    .raw { white-space: pre-wrap; font-size: 0.75rem; font-family: var(--font-mono, monospace); }
    .chart-panel { background: var(--color-background-primary, #fff); border: 1px solid var(--color-border-secondary, #e4e4e7); border-radius: 12px; padding: 16px; }
    .chart-title { margin: 0 0 8px; font-size: 0.9375rem; }
    .chart-caption { margin: 0 0 8px; }
    .chart-svg-wrap { overflow-x: auto; margin: 8px 0; }
    .exec-chart-svg { display: block; max-width: 100%; height: auto; }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 12px 0; font-size: 0.6875rem; color: var(--color-text-secondary, #52525b); }
    .chart-legend-item { display: flex; align-items: center; gap: 6px; }
    .chart-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
    .chart-counts { display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 0.75rem; margin-top: 10px; }
    .chart-count { display: inline-flex; align-items: center; gap: 6px; }
    .chart-empty { margin: 8px 0; font-size: 0.875rem; }
    .mcp-app-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px 16px;
      min-height: 12rem;
    }
    .mcp-app-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--color-border-secondary, #e4e4e7);
      border-top-color: var(--color-text-primary, #18181b);
      border-radius: 50%;
      animation: mcp-app-spin 0.65s linear infinite;
    }
    @keyframes mcp-app-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .mcp-app-spinner { animation: none; }
    }
    .mcp-app-loading-label {
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #71717a);
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="mcp-app-loading" role="status" aria-live="polite" aria-busy="true">
      <div class="mcp-app-spinner" aria-hidden="true"></div>
      <span class="mcp-app-loading-label">Loading</span>
    </div>
  </div>
  <script>${script}</script>
</body>
</html>`;
}
