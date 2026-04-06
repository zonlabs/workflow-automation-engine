import type { RegisteredClient } from "./registry";

/** Keep in sync with workflow-mcp-web/public/logo.svg */
const ENGINE_BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-hidden="true"><rect width="256" height="256" fill="#000000"/><polygon points="57,58 99,50 105,198 63,206" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/><polygon points="103,54 145,46 151,194 109,202" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/><polygon points="149,50 191,42 197,190 155,198" fill="none" stroke="#e8e8e8" stroke-width="3" stroke-linejoin="miter"/></svg>`;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function displayClientName(client: { clientName?: string }): string {
  const n = client.clientName?.trim();
  return n && n.length > 0 ? n : "Connected application";
}

function initialGlyph(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "?";
  const ch = [...t][0];
  return ch && ch.length > 0 ? ch : "?";
}

function buildAppLogoMarkup(client: { logoUri?: string }, displayName: string): string {
  const initial = esc(initialGlyph(displayName));
  if (client.logoUri) {
    const src = esc(client.logoUri);
    return `<div class="party-logo app-logo-box" aria-hidden="true">
      <img class="app-logo-img" src="${src}" alt="" referrerpolicy="no-referrer" decoding="async" onerror="this.onerror=null;this.remove();this.parentElement.querySelector('.app-logo-fallback').classList.add('visible');" />
      <span class="app-logo-fallback">${initial}</span>
    </div>`;
  }
  return `<div class="party-logo app-logo-box" aria-hidden="true"><span class="app-logo-fallback visible">${initial}</span></div>`;
}

function formatRedirectDisplay(uri: string): string {
  try {
    const u = new URL(uri);
    const path = u.pathname === "/" ? "" : u.pathname;
    const tail = `${path}${u.search}${u.hash}`;
    // For http(s), origin is meaningful. For custom schemes (cursor://, vscode://, …)
    // `URL#origin` is often the literal string "null", which would display as "null/…".
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `${u.origin}${tail}`;
    }
    return u.href;
  } catch {
    return uri;
  }
}

export type AuthorizePageParams = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
};

/** HTML for GET /oauth/authorize (shared by Express and Vercel). */
export function buildOauthAuthorizeHtml(
  issuer: string,
  client: RegisteredClient,
  p: AuthorizePageParams
): string {
  const action = `${issuer}/oauth/authorize`;
  const appLabel = displayClientName(client);
  const logoBlock = buildAppLogoMarkup(client, appLabel);
  const redirectLabel = formatRedirectDisplay(p.redirect_uri);
  const checkSvg = `<svg class="perm-check" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 9.5L8 13l6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const flowConnector = `<div class="flow-lines" aria-hidden="true">
    <div class="flow-line flow-line-out"></div>
    <div class="flow-line flow-line-in"></div>
  </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Authorize API access · Workflow Engine · ${esc(appLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #e8e8e8;
      color: #171717;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      -webkit-font-smoothing: antialiased;
    }
    .shell { width: 100%; max-width: 26rem; }
    .card {
      background: #ffffff;
      border: 1px solid #d4d4d4;
      border-radius: 10px;
      padding: 1.35rem 1.25rem 1.25rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .title {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 0 0.85rem;
      letter-spacing: -0.02em;
      color: #0a0a0a;
      line-height: 1.25;
      text-align: center;
    }
    .consent-identities {
      margin: 0 0 1rem;
      padding: 0.15rem 0 0.35rem;
      background: transparent;
      border: 0;
      border-radius: 0;
    }
    .consent-row {
      display: grid;
      grid-template-columns: auto auto auto;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
    }
    .party {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
      flex: 0 0 auto;
    }
    .party-logo {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e5e5e5;
      background: #ffffff;
    }
    .party-logo svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .party-meta {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
      justify-content: center;
    }
    .party-kicker {
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #8a8a8a;
      line-height: 1.15;
    }
    .request-copy {
      margin: 0.45rem auto 0;
      max-width: 22rem;
      font-size: 0.8rem;
      color: #404040;
      line-height: 1.35;
      text-align: center;
    }
    .request-copy strong {
      color: #111827;
      font-weight: 600;
    }
    .flow-between {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0.2rem;
    }
    .flow-lines {
      width: clamp(44px, 10vw, 72px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
    }
    .flow-line {
      position: relative;
      width: 100%;
      height: 2px;
      border-radius: 999px;
      background: transparent;
      overflow: hidden;
    }
    .flow-line::before {
      content: "";
      position: absolute;
      inset: 0;
      opacity: 0.95;
      background-repeat: no-repeat;
    }
    .flow-line-out::before {
      background-image: linear-gradient(
        90deg,
        rgba(37, 99, 235, 0) 0%,
        rgba(37, 99, 235, 0.96) 18%,
        rgba(37, 99, 235, 0.96) 82%,
        rgba(37, 99, 235, 0) 100%
      );
      background-size: 52px 100%;
      filter: drop-shadow(0 0 8px rgba(37, 99, 235, 0.28));
      animation: flow-single-ltr 1.35s linear infinite;
    }
    .flow-line-in::before {
      background-image: linear-gradient(
        90deg,
        rgba(22, 163, 74, 0) 0%,
        rgba(22, 163, 74, 0.96) 18%,
        rgba(22, 163, 74, 0.96) 82%,
        rgba(22, 163, 74, 0) 100%
      );
      background-size: 52px 100%;
      filter: drop-shadow(0 0 8px rgba(22, 163, 74, 0.28));
      animation: flow-single-rtl 1.35s linear infinite;
    }
    @keyframes flow-single-ltr {
      from { background-position-x: -60px; }
      to { background-position-x: 130px; }
    }
    @keyframes flow-single-rtl {
      from { background-position-x: 130px; }
      to { background-position-x: -60px; }
    }
    @media (max-width: 560px) {
      .consent-row {
        grid-template-columns: minmax(0, 1fr);
        justify-items: stretch;
        gap: 0.5rem;
      }
      .flow-between {
        justify-content: flex-start;
        padding-left: 40px;
      }
      .flow-lines {
        width: min(150px, 62vw);
      }
    }
    .app-logo-box {
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 2px;
    }
    .app-logo-img {
      position: absolute;
      inset: 2px;
      z-index: 2;
      width: calc(100% - 4px);
      height: calc(100% - 4px);
      object-fit: contain;
      border-radius: 6px;
    }
    .app-logo-fallback {
      font-size: 0.875rem;
      font-weight: 700;
      color: #171717;
      display: none;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      position: relative;
      z-index: 1;
    }
    .app-logo-fallback.visible { display: flex; }
    .access-preface {
      margin: 0 0 0.5rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: #525252;
      line-height: 1.35;
    }
    .redirect {
      margin: 0.4rem auto 0;
      max-width: 22rem;
      padding-top: 0.4rem;
      border-top: 1px solid #ededed;
      font-size: 0.6875rem;
      color: #737373;
      line-height: 1.35;
      text-align: center;
    }
    .redirect code {
      font-size: 0.78rem;
      font-family: ui-monospace, monospace;
      color: #404040;
      word-break: break-all;
    }
    .perms {
      list-style: none;
      margin: 0 0 1rem;
      padding: 0;
    }
    .perms li {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      font-size: 0.8125rem;
      line-height: 1.4;
      color: #262626;
      margin-bottom: 0.45rem;
    }
    .perms li:last-child { margin-bottom: 0; }
    .perm-check {
      flex-shrink: 0;
      margin-top: 2px;
      color: #0a0a0a;
    }
    .hint {
      font-size: 0.75rem;
      line-height: 1.45;
      color: #525252;
      margin: 0 0 0.85rem;
      padding: 0.55rem 0.65rem;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
    }
    .hint code { font-size: 0.75rem; }
    .hint a {
      color: #0a0a0a;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .hint a:hover { color: #404040; }
    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
      color: #0a0a0a;
    }
    textarea {
      width: 100%;
      min-height: 5.5rem;
      padding: 0.65rem 0.75rem;
      font-family: ui-monospace, "Cascadia Code", monospace;
      font-size: 0.78rem;
      line-height: 1.45;
      border-radius: 8px;
      border: 1px solid #d4d4d4;
      background: #ffffff;
      color: #171717;
      resize: vertical;
      transition: border-color 0.12s, box-shadow 0.12s;
    }
    textarea:focus {
      outline: none;
      border-color: #cbd5e1;
      box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.22);
    }
    textarea::placeholder { color: #a3a3a3; }
    .actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.65rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .btn-cancel {
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid #d4d4d4;
      background: #ffffff;
      color: #171717;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .btn-cancel:hover { background: #fafafa; border-color: #a3a3a3; }
    .btn-submit {
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0.5rem 1.15rem;
      border-radius: 8px;
      border: 1px solid #0a0a0a;
      background: #0a0a0a;
      color: #ffffff;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .btn-submit:hover { background: #262626; border-color: #262626; }
    .btn-submit[disabled] {
      background: #525252;
      border-color: #525252;
      cursor: progress;
      opacity: 0.95;
    }
    .btn-submit-inner {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .btn-spinner {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 999px;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      display: none;
      animation: spin 0.85s linear infinite;
    }
    .btn-submit.is-loading .btn-spinner { display: inline-block; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .fineprint {
      margin-top: 1rem;
      font-size: 0.6875rem;
      color: #737373;
      text-align: center;
      line-height: 1.45;
    }
    .fineprint a {
      color: #525252;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .fineprint a:hover { color: #171717; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1 class="title">Authorize API access</h1>
      <div class="consent-identities">
        <div class="consent-row">
          <div class="party">
            <div class="party-logo" aria-hidden="true">${ENGINE_BRAND_SVG}</div>
          </div>
          <div class="flow-between">${flowConnector}</div>
          <div class="party">
            ${logoBlock}
          </div>
        </div>
        <p class="request-copy"><strong>${esc(appLabel)}</strong> is requesting access to <strong>Workflow Engine</strong>.</p>
        <p class="redirect">Returns to <code>${esc(redirectLabel)}</code></p>
      </div>
      <p class="access-preface">Requested permissions:</p>
      <ul class="perms">
        <li>${checkSvg}<span>Full access to your workflows, schedules, and execution history for this account</span></li>
        <li>${checkSvg}<span>Allow the application to run workflows using credentials you provide below</span></li>
      </ul>
      <p class="hint">Get an API key at <a href="https://mcp-assistant.in/settings/api-keys" target="_blank" rel="noopener noreferrer">mcp-assistant.in/settings/api-keys</a>. Paste a <strong>workflow API key</strong> (<code>wfmcp_…</code>) or your <strong>signed-in session access token</strong> (JWT).</p>
      <form method="post" action="${esc(action)}" id="oauth-authorize-form">
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value="${esc(p.client_id)}" />
        <input type="hidden" name="redirect_uri" value="${esc(p.redirect_uri)}" />
        <input type="hidden" name="state" value="${esc(p.state ?? "")}" />
        <input type="hidden" name="code_challenge" value="${esc(p.code_challenge)}" />
        <input type="hidden" name="code_challenge_method" value="${esc(p.code_challenge_method)}" />
        <input type="hidden" name="scope" value="${esc(p.scope)}" />
        <label for="user_access_token">API key or access token</label>
        <textarea id="user_access_token" name="user_access_token" required autocomplete="off" spellcheck="false" placeholder="wfmcp_… or eyJhbGciOiJIUzI1NiIs…"></textarea>
        <div class="actions">
          <button type="button" class="btn-cancel" onclick="if (history.length > 1) history.back(); else window.close();">Cancel</button>
          <button type="submit" class="btn-submit" id="oauth-authorize-submit">
            <span class="btn-submit-inner">
              <span class="btn-spinner" aria-hidden="true"></span>
              <span class="btn-submit-label">Authorize</span>
            </span>
          </button>
        </div>
      </form>
    </div>
    <p class="fineprint">You can create or revoke API keys anytime at <a href="https://mcp-assistant.in/settings/api-keys" target="_blank" rel="noopener noreferrer">mcp-assistant.in/settings/api-keys</a>.</p>
  </div>
  <script>
    (function () {
      var form = document.getElementById("oauth-authorize-form");
      var submit = document.getElementById("oauth-authorize-submit");
      if (!form || !submit) return;
      form.addEventListener("submit", function () {
        if (!(submit instanceof HTMLButtonElement)) return;
        if (submit.disabled) return;
        submit.disabled = true;
        submit.classList.add("is-loading");
        submit.setAttribute("aria-busy", "true");
        var label = submit.querySelector(".btn-submit-label");
        if (label) label.textContent = "Authorizing...";
      });
    })();
  </script>
</body>
</html>`;
}
