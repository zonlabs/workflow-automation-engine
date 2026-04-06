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

/** Header / empty state only — matches OAuth `logo.svg`. Not shown on each workflow row. */
const WORKFLOW_ENGINE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="32" height="32" aria-hidden="true"><rect width="256" height="256" rx="48" fill="#0a0a0a"/><polygon points="57,58 99,50 105,198 63,206" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/><polygon points="103,54 145,46 151,194 109,202" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/><polygon points="149,50 191,42 197,190 155,198" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/></svg>`;

/** Branching / flow icon for individual workflow cards (not the product logo). */
const WORKFLOW_GRAPH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5" r="2.25"/><circle cx="5" cy="19" r="2.25"/><circle cx="19" cy="12" r="2.25"/><path d="M5 7.25v7.5"/><path d="M7.1 12h6.4a1.6 1.6 0 0 0 1.6-1.6V8.5"/></svg>`;

function statIc(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Icons for card stat labels (Type, Steps, …). */
const STAT_ICON_TYPE = statIc(
  `<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`
);
const STAT_ICON_STEPS = statIc(
  `<circle cx="4" cy="6" r="1.25" fill="currentColor"/><circle cx="4" cy="12" r="1.25" fill="currentColor"/><circle cx="4" cy="18" r="1.25" fill="currentColor"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>`
);
const STAT_ICON_SCHEDULES = statIc(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`);
const STAT_ICON_TOOLING = statIc(
  `<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`
);
const STAT_ICON_EXECUTIONS = statIc(`<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`);

function statLabel(text: string, iconSvg: string): string {
  return `<span class="stat-label"><span class="stat-ic" aria-hidden="true">${iconSvg}</span>${esc(text)}</span>`;
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "Just now";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function execStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "success") return "exec-pill exec-pill-ok";
  if (s === "failed" || s === "timeout" || s === "cancelled") return "exec-pill exec-pill-bad";
  if (s === "running") return "exec-pill exec-pill-run";
  return "exec-pill exec-pill-wait";
}

function asExec(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function renderExecutionSection(ex: Record<string, unknown> | undefined): string {
  if (!ex) {
    return `<div class="exec-block"><h3 class="exec-heading">${statLabel("Executions", STAT_ICON_EXECUTIONS)}</h3><p class="muted exec-empty">No run data loaded.</p></div>`;
  }
  const lastAt = ex.last_run_at as string | null | undefined;
  const status = String(ex.last_status ?? "");
  const runs = Number(ex.runs_in_window ?? 0);
  const ok = Number(ex.success_count ?? 0);
  const bad = Number(ex.failed_count ?? 0);
  const other = Number(ex.other_count ?? 0);
  const dur = ex.last_duration_ms;
  const durLabel =
    typeof dur === "number" && dur >= 0 ? `${dur < 1000 ? dur + " ms" : (dur / 1000).toFixed(1) + " s"}` : "—";
  const err = typeof ex.last_error_preview === "string" ? ex.last_error_preview : "";
  const by = typeof ex.last_triggered_by === "string" && ex.last_triggered_by ? ex.last_triggered_by : null;

  if (!lastAt && runs === 0) {
    return `<div class="exec-block">
      <h3 class="exec-heading">${statLabel("Executions", STAT_ICON_EXECUTIONS)}</h3>
      <p class="muted exec-empty">No runs yet. Use <code>workflow_run</code> or a schedule to see history here.</p>
    </div>`;
  }

  const errHtml = err ? `<p class="exec-err-preview" title="${esc(err)}">${esc(err)}</p>` : "";

  return `<div class="exec-block">
    <h3 class="exec-heading">${statLabel("Executions", STAT_ICON_EXECUTIONS)}</h3>
    <div class="exec-row-main">
      <div>
        <span class="${execStatusClass(status)}">${esc(status || "—")}</span>
        <span class="exec-when muted">${esc(fmtRelative(lastAt))}</span>
      </div>
      <div class="exec-meta-line muted tiny">
        Last duration: <strong class="exec-strong">${esc(durLabel)}</strong>
        ${by ? ` · Trigger: <strong class="exec-strong">${esc(by)}</strong>` : ""}
      </div>
    </div>
    <div class="exec-counts">
      <span title="Runs in recent window (up to 15)"><strong>${runs}</strong> recent</span>
      <span class="dot">·</span>
      <span class="exec-ok"><strong>${ok}</strong> ok</span>
      <span class="dot">·</span>
      <span class="exec-bad-count"><strong>${bad}</strong> failed</span>
      ${other > 0 ? `<span class="dot">·</span><span><strong>${other}</strong> other</span>` : ""}
    </div>
    ${errHtml}
  </div>`;
}

function formatExecutionLogsDrawer(text: string, workflowTitle: string): string {
  try {
    const o = JSON.parse(text) as { logs?: unknown[] };
    const logs = Array.isArray(o.logs) ? o.logs : [];
    if (logs.length === 0) {
      return `<p class="drawer-lead muted">No execution logs for <strong>${esc(workflowTitle)}</strong> yet.</p>
        <p class="muted tiny">Trigger a run with <code>workflow_run</code> or wait for the scheduler.</p>`;
    }
    const rows = logs
      .map((L) => {
        const row = L as Record<string, unknown>;
        const st = String(row.status ?? "");
        const created = String(row.created_at ?? "");
        const dm = row.duration_ms;
        const dur =
          typeof dm === "number" && dm >= 0 ? (dm < 1000 ? `${dm} ms` : `${(dm / 1000).toFixed(1)} s`) : "—";
        const em = typeof row.error_message === "string" ? row.error_message.trim() : "";
        const errCell = em ? esc(em.slice(0, 100)) + (em.length > 100 ? "…" : "") : "—";
        const trig = typeof row.triggered_by === "string" ? row.triggered_by : "—";
        return `<tr>
          <td><span class="${execStatusClass(st)}">${esc(st)}</span></td>
          <td class="mono tiny">${esc(fmtRelative(created))}</td>
          <td>${esc(dur)}</td>
          <td class="tiny">${esc(trig)}</td>
          <td class="log-err tiny">${errCell}</td>
        </tr>`;
      })
      .join("");
    return `<p class="drawer-lead"><strong>${esc(workflowTitle)}</strong> · recent logs</p>
      <div class="table-wrap">
        <table class="log-table">
          <thead><tr><th>Status</th><th>When</th><th>Duration</th><th>Trigger</th><th>Error</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch {
    return `<pre class="drawer-pre">${esc(text)}</pre>`;
  }
}

function dashBrandHeader(): string {
  return `<div class="dash-brand">
    <div class="brand-logo-wrap" aria-hidden="true">${WORKFLOW_ENGINE_LOGO_SVG}</div>
    <span class="brand-engine">Workflow Engine</span>
  </div>`;
}

let mcpApp: App | null = null;

function textFromResult(result: CallToolResult): string | null {
  const block = result.content?.find((c) => c.type === "text" && "text" in c) as
    | { type: "text"; text: string }
    | undefined;
  return block?.text ?? null;
}

function setButtonLoading(btn: HTMLButtonElement, loading: boolean): void {
  if (loading) {
    btn.classList.add("btn--loading");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  } else {
    btn.classList.remove("btn--loading");
    btn.disabled = false;
    btn.setAttribute("aria-busy", "false");
  }
}

/** Refresh / Try again (error state) — whichever exists. */
function setDashboardRefreshLoading(loading: boolean): void {
  const btn = (document.getElementById("dash-refresh") ??
    document.getElementById("dash-retry")) as HTMLButtonElement | null;
  if (btn) setButtonLoading(btn, loading);
}

async function refreshDashboardData(): Promise<void> {
  if (!mcpApp) return;
  setDashboardRefreshLoading(true);
  try {
    const res = await mcpApp.callServerTool({
      name: "workflow_open_dashboard",
      arguments: {},
    });
    renderFromToolResult(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const r = document.getElementById("root");
    if (r) {
      r.innerHTML = `<div class="dash">
        <div class="banner banner-err">${esc(msg)}</div>
        <button type="button" class="btn btn-primary" id="dash-retry" aria-busy="false">
          <span class="btn-spinner" aria-hidden="true"></span>
          <span class="btn-label">Try again</span>
        </button>
      </div>`;
      document.getElementById("dash-retry")?.addEventListener("click", () => void refreshDashboardData());
    }
  } finally {
    setDashboardRefreshLoading(false);
  }
}

function closeDrawer(): void {
  const d = document.getElementById("dash-drawer");
  const backdrop = document.getElementById("dash-backdrop");
  if (d) {
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.classList.remove("open");
}

function openDrawer(title: string, bodyHtml: string): void {
  const d = document.getElementById("dash-drawer");
  const backdrop = document.getElementById("dash-backdrop");
  const dh = document.getElementById("dash-drawer-head");
  const db = document.getElementById("dash-drawer-body");
  if (dh) dh.textContent = title;
  if (db) db.innerHTML = bodyHtml;
  if (d) {
    d.classList.add("open");
    d.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.classList.add("open");
}

function formatWorkflowDetailJson(text: string): string {
  try {
    const o = JSON.parse(text) as { workflow?: Record<string, unknown> };
    const w = o.workflow;
    if (!w || typeof w !== "object") {
      return `<pre class="drawer-pre">${esc(text)}</pre>`;
    }
    const name = typeof w.name === "string" ? w.name : "Workflow";
    const desc = typeof w.description === "string" && w.description ? `<p class="drawer-desc">${esc(w.description)}</p>` : "";
    const active = w.is_active === true;
    const steps = Array.isArray(w.workflow_steps) ? w.workflow_steps.length : 0;
    const schedules = Array.isArray(w.scheduled_workflows) ? w.scheduled_workflows.length : 0;
    const hasScript = typeof w.script_code === "string" && String(w.script_code).length > 0;
    const mode = hasScript ? "Script workflow" : steps > 0 ? `${steps} DAG step(s)` : "Empty definition";
    return `
      <p class="drawer-lead"><strong>${esc(name)}</strong></p>
      <p class="drawer-meta"><span class="badge ${active ? "badge-on" : "badge-off"}">${active ? "Active" : "Inactive"}</span></p>
      ${desc}
      <dl class="drawer-dl">
        <dt>Mode</dt><dd>${esc(mode)}</dd>
        <dt>Schedules</dt><dd>${String(schedules)}</dd>
        <dt>Workflow ID</dt><dd class="mono">${esc(String(w.id ?? ""))}</dd>
      </dl>
      <details class="drawer-raw"><summary>Raw JSON</summary><pre class="drawer-pre">${esc(JSON.stringify(w, null, 2))}</pre></details>`;
  } catch {
    return `<pre class="drawer-pre">${esc(text)}</pre>`;
  }
}

async function copyText(text: string, hintEl: HTMLElement | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (hintEl) {
      hintEl.textContent = "Copied";
      setTimeout(() => {
        hintEl.textContent = "";
      }, 1600);
    }
  } catch {
    if (hintEl) hintEl.textContent = "Copy failed";
  }
}

function renderFromToolResult(result: CallToolResult): void {
  const root = document.getElementById("root");
  if (!root) return;

  if (result.isError) {
    const t = textFromResult(result);
    root.innerHTML = `<div class="dash"><div class="banner banner-err">${esc(t ?? "Tool error")}</div></div>`;
    return;
  }

  const raw = textFromResult(result);
  if (!raw) {
    root.innerHTML = '<div class="dash"><p class="muted">No data.</p></div>';
    return;
  }

  let data: { workflows?: unknown[] };
  try {
    data = JSON.parse(raw) as { workflows?: unknown[] };
  } catch {
    root.innerHTML = `<div class="dash"><pre class="raw">${esc(raw)}</pre></div>`;
    return;
  }

  const workflows = Array.isArray(data.workflows) ? data.workflows : [];
  const activeCount = workflows.filter((w) => (w as { is_active?: boolean }).is_active === true).length;

  if (workflows.length === 0) {
    root.innerHTML = `
      <div class="dash">
        <header class="dash-header">
          <div class="dash-header-left">
            ${dashBrandHeader()}
            <h1 class="dash-title">Workflows</h1>
            <p class="dash-sub">Runs, logs, and definitions — Workflow MCP</p>
          </div>
          <button type="button" class="btn btn-primary" id="dash-refresh" aria-busy="false">
            <span class="btn-spinner" aria-hidden="true"></span>
            <span class="btn-label" id="dash-refresh-label">Refresh</span>
          </button>
        </header>
        <div class="empty-state">
          <div class="empty-brand">${WORKFLOW_ENGINE_LOGO_SVG}</div>
          <p class="empty-title">No workflows yet</p>
          <p class="muted">Create one via <code>workflow_upsert_script</code> or the web app, then refresh.</p>
        </div>
      </div>`;
    attachHandlers(root);
    return;
  }

  const cards = workflows
    .map((w, i) => {
      const o = w as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name : "Untitled";
      const id = typeof o.id === "string" ? o.id : "";
      const isActive = o.is_active === true;
      const stepCount = typeof o.step_count === "number" ? o.step_count : 0;
      const kind = o.workflow_kind === "dag" ? "DAG" : "Script";
      const kindClass = o.workflow_kind === "dag" ? "kind-dag" : "kind-script";
      const toolkitLabel =
        typeof o.toolkit_label === "string"
          ? o.toolkit_label
          : Array.isArray(o.toolkits) && (o.toolkits as string[]).length > 0
            ? (o.toolkits as string[]).join(", ")
            : stepCount === 0
              ? "Script entrypoint"
              : "—";
      const sched = typeof o.schedule_count === "number" ? o.schedule_count : 0;
      const execHtml = renderExecutionSection(asExec(o.execution));

      return `
        <article class="card" style="animation-delay: ${Math.min(i * 40, 400)}ms">
          <div class="card-head">
            <div class="card-branch-icon" aria-hidden="true">${WORKFLOW_GRAPH_ICON}</div>
            <div class="card-head-main">
              <div class="card-title-row">
                <h2 class="card-name">${esc(name)}</h2>
                <span class="badge ${isActive ? "badge-on" : "badge-off"}">${isActive ? "Active" : "Inactive"}</span>
              </div>
              <div class="card-id-row">
                <code class="card-id mono" title="${esc(id)}">${esc(id.slice(0, 10))}…</code>
                <button type="button" class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(id)}" aria-label="Copy workflow ID"><span class="btn-spinner" aria-hidden="true"></span><span class="btn-label">Copy ID</span></button>
                <span class="copy-hint mono" aria-live="polite"></span>
              </div>
            </div>
          </div>
          <dl class="card-stats">
            <div><dt>${statLabel("Type", STAT_ICON_TYPE)}</dt><dd><span class="kind-pill ${kindClass}">${esc(kind)}</span></dd></div>
            <div><dt>${statLabel("Steps", STAT_ICON_STEPS)}</dt><dd>${stepCount === 0 ? '<span class="muted tiny">0 (script / none)</span>' : String(stepCount)}</dd></div>
            <div><dt>${statLabel("Schedules", STAT_ICON_SCHEDULES)}</dt><dd>${String(sched)}</dd></div>
            <div class="card-tk"><dt>${statLabel("Tooling", STAT_ICON_TOOLING)}</dt><dd>${esc(toolkitLabel)}</dd></div>
          </dl>
          ${execHtml}
          <div class="card-actions">
            <button type="button" class="btn btn-secondary btn-compact" data-chart="${esc(id)}" data-chart-name="${esc(name)}" aria-busy="false"><span class="btn-spinner" aria-hidden="true"></span><span class="btn-label">Execution chart</span></button>
            <button type="button" class="btn btn-secondary btn-compact" data-logs="${esc(id)}" data-logs-name="${esc(name)}" aria-busy="false"><span class="btn-spinner" aria-hidden="true"></span><span class="btn-label">Execution logs</span></button>
            <button type="button" class="btn btn-secondary btn-compact" data-details="${esc(id)}" aria-busy="false"><span class="btn-spinner" aria-hidden="true"></span><span class="btn-label">View details</span></button>
          </div>
        </article>`;
    })
    .join("");

  root.innerHTML = `
    <div class="dash">
      <header class="dash-header">
        <div class="dash-header-left">
          ${dashBrandHeader()}
          <h1 class="dash-title">Workflows</h1>
          <p class="dash-sub">Runs, logs, and definitions — Workflow MCP</p>
        </div>
        <button type="button" class="btn btn-primary" id="dash-refresh" aria-busy="false">
          <span class="btn-spinner" aria-hidden="true"></span>
          <span class="btn-label" id="dash-refresh-label">Refresh</span>
        </button>
      </header>
      <div class="stats-row">
        <span class="stat"><strong>${workflows.length}</strong> total</span>
        <span class="stat dot">·</span>
        <span class="stat"><strong>${activeCount}</strong> active</span>
      </div>
      <div class="card-grid">${cards}</div>
    </div>
    <div class="drawer-backdrop" id="dash-backdrop" role="presentation"></div>
    <aside class="drawer" id="dash-drawer" aria-hidden="true">
      <div class="drawer-top">
        <h3 class="drawer-title" id="dash-drawer-head">Details</h3>
        <button type="button" class="btn btn-ghost drawer-close" id="dash-drawer-close" aria-label="Close">✕</button>
      </div>
      <div class="drawer-scroll" id="dash-drawer-body"></div>
    </aside>`;

  attachHandlers(root);
}

function attachHandlers(root: HTMLElement): void {
  root.querySelector("#dash-refresh")?.addEventListener("click", () => void refreshDashboardData());

  root.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const el = e.currentTarget as HTMLButtonElement;
      const id = el.getAttribute("data-copy") ?? "";
      const row = el.closest(".card-id-row");
      const hint = row?.querySelector(".copy-hint") as HTMLElement | null;
      void (async () => {
        setButtonLoading(el, true);
        try {
          await copyText(id, hint);
        } finally {
          setButtonLoading(el, false);
        }
      })();
    });
  });

  root.querySelectorAll("[data-details]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const wid = (btn as HTMLElement).getAttribute("data-details");
      if (!wid || !mcpApp) return;
      const b = btn as HTMLButtonElement;
      setButtonLoading(b, true);
      try {
        const res = await mcpApp.callServerTool({
          name: "workflow_get",
          arguments: { workflow_id: wid },
        });
        const text = textFromResult(res);
        if (res.isError || !text) {
          openDrawer("Error", `<p class="drawer-err">${esc(text ?? "Unknown error")}</p>`);
        } else {
          let title = "Workflow";
          try {
            const o = JSON.parse(text) as { workflow?: { name?: string } };
            if (typeof o.workflow?.name === "string") title = o.workflow.name;
          } catch {
            /* keep default */
          }
          openDrawer(title, formatWorkflowDetailJson(text));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        openDrawer("Error", `<p class="drawer-err">${esc(msg)}</p>`);
      } finally {
        setButtonLoading(b, false);
      }
    });
  });

  root.querySelectorAll("[data-chart]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const wid = (btn as HTMLElement).getAttribute("data-chart");
      const wname = (btn as HTMLElement).getAttribute("data-chart-name") ?? "Workflow";
      if (!wid || !mcpApp) return;
      const b = btn as HTMLButtonElement;
      setButtonLoading(b, true);
      try {
        const res = await mcpApp.callServerTool({
          name: "execution_log_list",
          arguments: { workflow_id: wid, limit: 40 },
        });
        const text = textFromResult(res);
        if (res.isError || !text) {
          openDrawer("Chart", `<p class="drawer-err">${esc(text ?? "Unknown error")}</p>`);
        } else {
          try {
            const o = JSON.parse(text) as {
              workflow_name?: string;
              logs?: unknown[];
            };
            const logs = (Array.isArray(o.logs) ? o.logs : []) as ChartLog[];
            const name = typeof o.workflow_name === "string" ? o.workflow_name : wname;
            openDrawer(`Execution chart`, buildExecutionChartPanel(name, logs));
          } catch {
            openDrawer("Chart", `<pre class="drawer-pre">${esc(text)}</pre>`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        openDrawer("Chart", `<p class="drawer-err">${esc(msg)}</p>`);
      } finally {
        setButtonLoading(b, false);
      }
    });
  });

  root.querySelectorAll("[data-logs]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const wid = (btn as HTMLElement).getAttribute("data-logs");
      const wname = (btn as HTMLElement).getAttribute("data-logs-name") ?? "Workflow";
      if (!wid || !mcpApp) return;
      const b = btn as HTMLButtonElement;
      setButtonLoading(b, true);
      try {
        const res = await mcpApp.callServerTool({
          name: "execution_log_list",
          arguments: { workflow_id: wid, limit: 15 },
        });
        const text = textFromResult(res);
        if (res.isError || !text) {
          openDrawer("Logs", `<p class="drawer-err">${esc(text ?? "Unknown error")}</p>`);
        } else {
          openDrawer(`Execution logs`, formatExecutionLogsDrawer(text, wname));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        openDrawer("Logs", `<p class="drawer-err">${esc(msg)}</p>`);
      } finally {
        setButtonLoading(b, false);
      }
    });
  });

  document.getElementById("dash-drawer-close")?.addEventListener("click", closeDrawer);
  document.getElementById("dash-backdrop")?.addEventListener("click", closeDrawer);
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeDrawer();
}

async function main(): Promise<void> {
  const app = new App(
    { name: "workflow-mcp-dashboard", version: "1.0.0" },
    { tools: {} },
    { autoResize: true }
  );
  mcpApp = app;

  app.ontoolresult = (params: CallToolResult) => {
    renderFromToolResult(params);
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  };

  await app.connect();
  document.addEventListener("keydown", onGlobalKeydown);
}

void main().catch((e) => {
  console.error(e);
  const root = document.getElementById("root");
  if (root) root.textContent = String(e instanceof Error ? e.message : e);
});
