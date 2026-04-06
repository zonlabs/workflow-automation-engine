/**
 * Shared SVG timeline + summary for execution analytics (dashboard drawer + standalone chart app).
 */

export type ChartLog = {
  status: string;
  created_at: string;
  duration_ms?: number | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function fillForStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === "success") return "#22c55e";
  if (s === "failed" || s === "timeout" || s === "cancelled") return "#ef4444";
  if (s === "running") return "#3b82f6";
  return "#a1a1aa";
}

/**
 * Horizontal bar chart: oldest run left → newest right; bar height ∝ duration (normalized).
 */
export function buildExecutionTimelineSvg(logs: ChartLog[]): string {
  const sorted = [...logs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  if (sorted.length === 0) {
    return '<p class="muted chart-empty">No runs to plot.</p>';
  }

  const W = 340;
  const H = 88;
  const padL = 8;
  const padR = 8;
  const padB = 14;
  const innerW = W - padL - padR;
  const n = sorted.length;
  const gap = 2;
  const barW = Math.max(4, Math.floor((innerW - gap * (n - 1)) / n));
  const maxDur = Math.max(
    ...sorted.map((l) => (typeof l.duration_ms === "number" && l.duration_ms > 0 ? l.duration_ms : 800)),
    1
  );
  const plotH = H - padB - 10;

  let rects = "";
  let x = padL;
  for (const l of sorted) {
    const raw = typeof l.duration_ms === "number" && l.duration_ms > 0 ? l.duration_ms : 400;
    const h = Math.max(6, Math.round((raw / maxDur) * plotH));
    const y = H - padB - h;
    const fill = fillForStatus(l.status);
    rects += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${fill}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>`;
    x += barW + gap;
  }

  const lineY = H - padB;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="exec-chart-svg" role="img" aria-label="Execution timeline (older left, newer right)">
    <line x1="${padL}" y1="${lineY}" x2="${W - padR}" y2="${lineY}" stroke="var(--color-border-secondary, #e4e4e7)" stroke-width="1"/>
    ${rects}
  </svg>`;
}

function countByStatus(logs: ChartLog[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const l of logs) {
    const k = String(l.status || "unknown").toLowerCase();
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

/** HTML block: chart + legend + counts (for drawer or full-page body). */
export function buildExecutionChartPanel(workflowName: string, logs: ChartLog[]): string {
  const safeName = esc(workflowName);
  if (logs.length === 0) {
    return `<div class="chart-panel">
      <p class="chart-title"><strong>${safeName}</strong></p>
      <p class="muted">No execution logs in this window. Run <code>workflow_run</code> or wait for the scheduler.</p>
    </div>`;
  }

  const counts = countByStatus(logs);
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => `<span class="chart-count"><span class="chart-dot" style="background:${fillForStatus(st)}"></span>${esc(st)}: <strong>${n}</strong></span>`)
    .join(" ");

  const legend = `<div class="chart-legend">
    <span class="chart-legend-item"><span class="chart-dot" style="background:#22c55e"></span>success</span>
    <span class="chart-legend-item"><span class="chart-dot" style="background:#ef4444"></span>failed / timeout</span>
    <span class="chart-legend-item"><span class="chart-dot" style="background:#3b82f6"></span>running</span>
    <span class="chart-legend-item"><span class="chart-dot" style="background:#a1a1aa"></span>other</span>
  </div>`;

  return `<div class="chart-panel">
    <p class="chart-title"><strong>${safeName}</strong> · <span class="muted tiny">${logs.length} run(s) shown</span></p>
    <p class="chart-caption muted tiny">Timeline: older ← → newer (bar height ≈ duration)</p>
    <div class="chart-svg-wrap">${buildExecutionTimelineSvg(logs)}</div>
    ${legend}
    <div class="chart-counts">${parts}</div>
  </div>`;
}
