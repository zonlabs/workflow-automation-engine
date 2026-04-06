import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLE_NAME = "mcp-app-dashboard.iife.js";

/** HTML shell + inlined IIFE bundle for `registerAppResource` (MCP Apps hosts load this in a sandbox). */
export function buildWorkflowMcpDashboardHtml(): string {
  let script = "";
  try {
    script = readFileSync(join(process.cwd(), "public", BUNDLE_NAME), "utf8");
  } catch {
    script =
      'document.getElementById("root").textContent = "Build the MCP App bundle: npm run build:mcp-app";';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workflow MCP</title>
  <style>
    * { box-sizing: border-box; }
    html {
      height: 100%;
      min-height: 26.25rem;
    }
    body {
      margin: 0;
      min-height: 100%;
      min-height: max(100%, 26.25rem);
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      overflow-y: auto;
      font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
      background: var(--color-background-secondary, #f4f4f5);
      color: var(--color-text-primary, #18181b);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    /* Fills the host when tall (list scrolls in .card-grid). Short iframes get ~420px min height; body may scroll. */
    #root {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-width: 720px;
      margin: 0 auto;
      width: 100%;
      padding: 14px;
      position: relative;
      box-sizing: border-box;
    }
    #root > .mcp-app-loading:only-child {
      margin: auto;
    }
    .mcp-app-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 32px 16px;
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
    .dash {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .dash-header,
    .stats-row {
      flex-shrink: 0;
    }
    .card-grid {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 8px;
    }
    .dash .empty-state {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .dash > .banner,
    .dash > .raw {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .dash > .muted {
      flex: 1;
      min-height: 0;
      margin: 0;
      overflow-y: auto;
    }
    .dash-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .dash-header-left { min-width: 0; flex: 1; }
    .dash-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .brand-logo-wrap {
      flex-shrink: 0;
      line-height: 0;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    }
    .brand-logo-wrap svg { display: block; width: 36px; height: 36px; }
    .brand-engine {
      font-size: 0.8125rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--color-text-primary, #18181b);
    }
    .dash-title {
      font-size: var(--font-heading-lg-size, 1.25rem);
      font-weight: var(--font-weight-bold, 700);
      margin: 0 0 4px;
      letter-spacing: -0.02em;
      color: var(--color-text-primary, #0a0a0a);
    }
    .dash-sub {
      margin: 0;
      font-size: var(--font-text-sm-size, 0.8125rem);
      color: var(--color-text-secondary, #71717a);
    }
    .stats-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #52525b);
    }
    .stats-row .stat strong { color: var(--color-text-primary, #18181b); font-weight: 600; }
    .stats-row .dot { opacity: 0.45; user-select: none; }
    .btn {
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid transparent;
      cursor: pointer;
      transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      position: relative;
    }
    .btn-spinner {
      display: none;
      width: 1em;
      height: 1em;
      flex-shrink: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      animation: btn-spin 0.55s linear infinite;
      box-sizing: border-box;
    }
    .btn-primary .btn-spinner {
      border-color: rgba(255, 255, 255, 0.28);
      border-top-color: #fafafa;
    }
    .btn-secondary .btn-spinner {
      border-color: var(--color-border-secondary, #e4e4e7);
      border-top-color: var(--color-text-primary, #18181b);
    }
    .btn-ghost .btn-spinner {
      border-color: rgba(82, 82, 91, 0.25);
      border-top-color: var(--color-text-secondary, #52525b);
    }
    .btn--loading .btn-spinner {
      display: block;
    }
    .btn--loading .btn-label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .btn--loading:disabled {
      opacity: 1;
      cursor: wait;
    }
    @keyframes btn-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .btn-spinner { animation: none; opacity: 0.75; }
    }
    .btn:disabled:not(.btn--loading) { opacity: 0.55; cursor: not-allowed; }
    .btn:active:not(:disabled) { transform: scale(0.98); }
    .btn-primary {
      background: var(--color-text-primary, #18181b);
      color: var(--color-background-primary, #fafafa);
      border-color: var(--color-text-primary, #18181b);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--color-text-secondary, #3f3f46);
      border-color: var(--color-text-secondary, #3f3f46);
    }
    .btn-secondary {
      background: var(--color-background-primary, #fff);
      color: var(--color-text-primary, #18181b);
      border-color: var(--color-border-secondary, #e4e4e7);
    }
    .btn-secondary:hover:not(:disabled) {
      background: var(--color-background-tertiary, #f4f4f5);
      border-color: var(--color-border-primary, #d4d4d8);
    }
    .btn-ghost {
      background: transparent;
      color: var(--color-text-secondary, #52525b);
      border-color: transparent;
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--color-background-tertiary, #f4f4f5);
      color: var(--color-text-primary, #18181b);
    }
    .btn-sm { padding: 4px 8px; font-size: 0.75rem; font-weight: 600; }
    .card-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .card {
      background: var(--color-background-primary, #fff);
      border: 1px solid var(--color-border-secondary, #e4e4e7);
      border-radius: var(--border-radius-lg, 10px);
      padding: 10px 12px;
      box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
      animation: card-in 0.35s ease backwards;
    }
    .card-head {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
    }
    .card-branch-icon {
      flex-shrink: 0;
      line-height: 0;
      color: var(--color-accent, #6366f1);
      padding: 3px;
      border-radius: 6px;
      border: 1px solid var(--color-border-secondary, #e4e4e7);
      background: var(--color-background-secondary, #fafafa);
    }
    .card-branch-icon svg { width: 22px; height: 22px; display: block; }
    .card-head-main { flex: 1; min-width: 0; }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card:hover {
      border-color: var(--color-border-primary, #d4d4d8);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.07));
    }
    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .card-name {
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0;
      line-height: 1.25;
      color: var(--color-text-primary, #0a0a0a);
      flex: 1;
      min-width: 0;
    }
    .badge {
      flex-shrink: 0;
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 999px;
    }
    .badge-on {
      background: #dcfce7;
      color: #15803d;
    }
    .badge-off {
      background: var(--color-background-tertiary, #f4f4f5);
      color: var(--color-text-tertiary, #a1a1aa);
    }
    .card-id-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 5px;
    }
    .card-id {
      font-size: 0.75rem;
      color: var(--color-text-secondary, #71717a);
      background: var(--color-background-secondary, #f4f4f5);
      padding: 3px 8px;
      border-radius: 6px;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .copy-hint { font-size: 0.6875rem; color: #16a34a; min-width: 3rem; }
    .kind-pill {
      display: inline-block;
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 1px 6px;
      border-radius: 999px;
    }
    .kind-script { background: #eef2ff; color: #4338ca; }
    .kind-dag { background: #ecfdf5; color: #047857; }
    .card-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px 10px;
      margin: 8px 0 0;
      padding: 8px 0 0;
      border-top: 1px solid var(--color-border-secondary, #f4f4f5);
      align-items: start;
    }
    .card-stats .card-tk {
      grid-column: 1 / -1;
      padding-top: 2px;
    }
    .card-stats .card-tk dd {
      font-size: 0.6875rem;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .exec-block {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--color-border-secondary, #f4f4f5);
    }
    .exec-heading {
      margin: 0 0 4px;
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-tertiary, #a1a1aa);
    }
    .exec-heading .stat-label { letter-spacing: 0.05em; }
    .exec-heading .stat-ic { color: inherit; opacity: 0.92; }
    .exec-empty { margin: 0; font-size: 0.75rem; }
    .exec-row-main { margin-bottom: 4px; }
    .exec-row-main > div:first-child {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }
    .exec-when { font-size: 0.75rem; }
    .exec-meta-line { margin: 0; }
    .exec-strong { color: var(--color-text-primary, #3f3f46); font-weight: 600; }
    .exec-pill {
      display: inline-block;
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px 6px;
      border-radius: 999px;
    }
    .exec-pill-ok { background: #dcfce7; color: #15803d; }
    .exec-pill-bad { background: #fee2e2; color: #b91c1c; }
    .exec-pill-run { background: #dbeafe; color: #1d4ed8; }
    .exec-pill-wait { background: #f4f4f5; color: #71717a; }
    .exec-counts {
      font-size: 0.6875rem;
      color: var(--color-text-secondary, #52525b);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
    }
    .exec-counts .dot { opacity: 0.45; user-select: none; }
    .exec-ok strong { color: #15803d; }
    .exec-bad-count strong { color: #b91c1c; }
    .exec-err-preview {
      margin: 6px 0 0;
      font-size: 0.6875rem;
      color: #b91c1c;
      line-height: 1.35;
      padding: 6px 8px;
      background: #fef2f2;
      border-radius: 6px;
      border: 1px solid #fecaca;
      max-height: 4.5em;
      overflow: auto;
      word-break: break-word;
    }
    .drawer-lead { margin: 0 0 12px; font-size: 0.875rem; }
    .table-wrap { overflow-x: auto; margin: 0 -4px; }
    .log-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    .log-table th, .log-table td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--color-border-secondary, #f4f4f5);
      vertical-align: top;
    }
    .log-table th {
      font-weight: 700;
      color: var(--color-text-tertiary, #a1a1aa);
      text-transform: uppercase;
      font-size: 0.625rem;
      letter-spacing: 0.04em;
    }
    .log-err { color: #b91c1c; word-break: break-word; max-width: 140px; }
    .empty-brand { margin-bottom: 12px; line-height: 0; }
    .empty-brand svg { width: 48px; height: 48px; border-radius: 12px; }
    .stat-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .stat-ic {
      display: inline-flex;
      flex-shrink: 0;
      line-height: 0;
      color: var(--color-text-tertiary, #a1a1aa);
    }
    .stat-ic svg { display: block; width: 12px; height: 12px; }
    .card-stats dt {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--color-text-tertiary, #a1a1aa);
      margin: 0 0 1px;
    }
    .card-stats dd { margin: 0; font-size: 0.75rem; line-height: 1.3; color: var(--color-text-primary, #3f3f46); }
    .tiny { font-size: 0.6875rem; }
    .hint-text { font-weight: 600; }
    .card-actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .btn-compact {
      padding: 5px 10px;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 6px;
    }
    .muted { color: var(--color-text-secondary, #71717a); }
    .empty-state {
      text-align: center;
      padding: 32px 16px;
      background: var(--color-background-primary, #fff);
      border: 1px dashed var(--color-border-secondary, #e4e4e7);
      border-radius: var(--border-radius-lg, 12px);
    }
    .empty-title { font-weight: 600; margin: 0 0 8px; }
    .banner {
      padding: 12px 14px;
      border-radius: var(--border-radius-md, 8px);
      font-size: 0.875rem;
      margin-bottom: 12px;
    }
    .banner-err {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 40;
    }
    .drawer-backdrop.open { opacity: 1; pointer-events: auto; }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: min(100vw - 24px, 420px);
      max-width: 100%;
      height: 100%;
      background: var(--color-background-primary, #fff);
      border-left: 1px solid var(--color-border-secondary, #e4e4e7);
      box-shadow: -8px 0 32px rgba(0,0,0,0.12);
      z-index: 50;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      display: flex;
      flex-direction: column;
    }
    .drawer.open { transform: translateX(0); }
    .drawer-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--color-border-secondary, #f4f4f5);
    }
    .drawer-title { margin: 0; font-size: 1rem; font-weight: 600; flex: 1; min-width: 0; }
    .drawer-close { font-size: 1.1rem; line-height: 1; padding: 6px 10px; }
    .drawer-scroll {
      flex: 1;
      overflow: auto;
      padding: 16px;
      font-size: 0.875rem;
    }
    .drawer-meta { margin: 0 0 10px; }
    .drawer-desc { margin: 0 0 12px; color: var(--color-text-secondary, #52525b); line-height: 1.5; }
    .drawer-dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; align-items: baseline; }
    .drawer-dl dt { margin: 0; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-tertiary, #a1a1aa); }
    .drawer-dl dd { margin: 0; }
    .drawer-raw { margin-top: 16px; }
    .drawer-raw summary { cursor: pointer; font-weight: 600; font-size: 0.8125rem; margin-bottom: 8px; }
    .drawer-pre {
      margin: 0;
      padding: 10px;
      background: var(--color-background-secondary, #f4f4f5);
      border-radius: 8px;
      font-size: 0.6875rem;
      overflow: auto;
      max-height: 240px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .drawer-err { color: #b91c1c; margin: 0; }
    .chart-panel { margin: 0; }
    .chart-panel .chart-title { margin: 0 0 8px; font-size: 0.9375rem; }
    .chart-panel .chart-caption { margin: 0 0 8px; }
    .chart-panel .tiny { font-size: 0.75rem; }
    .chart-panel .chart-empty { margin: 0; }
    .chart-svg-wrap {
      margin: 8px 0 10px;
      padding: 10px;
      background: var(--color-background-secondary, #f4f4f5);
      border-radius: 8px;
      border: 1px solid var(--color-border-secondary, #e4e4e7);
      overflow-x: auto;
    }
    .exec-chart-svg { display: block; width: 100%; max-width: 100%; height: auto; min-width: 260px; }
    .chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin: 0 0 10px;
      font-size: 0.6875rem;
      color: var(--color-text-secondary, #52525b);
    }
    .chart-legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .chart-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .chart-counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      font-size: 0.75rem;
      color: var(--color-text-secondary, #52525b);
    }
    .chart-count { display: inline-flex; align-items: center; gap: 6px; }
    .mono { font-family: var(--font-mono, ui-monospace, "Cascadia Code", monospace); }
    .raw { white-space: pre-wrap; font-family: var(--font-mono, monospace); font-size: 0.75rem; }
    code { font-family: var(--font-mono, monospace); font-size: 0.8125rem; background: var(--color-background-tertiary, #f4f4f5); padding: 2px 6px; border-radius: 4px; }
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
