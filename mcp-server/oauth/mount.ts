import type { Express, Request, Response } from "express";
import { getIssuer } from "./config";
import { resolveSupabaseUserIdFromCredential } from "../auth";
import { sealAuthCode, openAuthCode } from "./auth-code";
import { verifyPkceChallenge } from "./pkce";
import { getClient, registerClient } from "./registry";
import { isAllowedRedirectUri } from "./redirect-uri";

const CODE_TTL_MS = 10 * 60 * 1000;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function normalizeClientName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().slice(0, 80);
  return t.length > 0 ? t : undefined;
}

function normalizeLogoUri(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const u = raw.trim();
  if (!u) return undefined;
  return u;
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
    return `<div class="app-logo-box" aria-hidden="true">
      <img class="app-logo-img" src="${src}" alt="" referrerpolicy="no-referrer" decoding="async" onerror="this.onerror=null;this.remove();this.parentElement.querySelector('.app-logo-fallback').classList.add('visible');" />
      <span class="app-logo-fallback">${initial}</span>
    </div>`;
  }
  return `<div class="app-logo-box" aria-hidden="true"><span class="app-logo-fallback visible">${initial}</span></div>`;
}

function formatRedirectDisplay(uri: string): string {
  try {
    const u = new URL(uri);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return uri;
  }
}

function isSafeRedirectUrl(uri: string): boolean {
  return isAllowedRedirectUri(uri);
}

function errorRedirect(res: Response, redirectUri: string | null, error: string, state: string | null) {
  if (!redirectUri || !isSafeRedirectUrl(redirectUri)) {
    res.status(400).send(`OAuth error: ${error}`);
    return;
  }
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (state) u.searchParams.set("state", state);
  res.redirect(u.toString());
}

function corsJson(res: Response, body: unknown, status = 200) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(body);
}

/**
 * OAuth 2.x authorization server for MCP clients (PKCE + dynamic registration).
 * Inspired by https://github.com/alphavantage/alpha_vantage_mcp/blob/main/mcp/src/av_mcp/oauth.py
 */
export function mountWorkflowOAuth(app: Express): void {
  const issuer = getIssuer();

  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ["openid", "email", "workflow"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      subject_types_supported: ["public"],
    });
  });

  app.post("/oauth/register", (req: Request, res: Response) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    for (const uri of redirectUris) {
      if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
        corsJson(
          res,
          {
            error: "invalid_redirect_uri",
            error_description: `Invalid redirect URI: ${uri}`,
          },
          400
        );
        return;
      }
    }
    const clientName = normalizeClientName(body.client_name);
    const logoRaw = normalizeLogoUri(body.logo_uri);
    if (logoRaw && !isAllowedRedirectUri(logoRaw)) {
      corsJson(
        res,
        {
          error: "invalid_client_metadata",
          error_description: "logo_uri must use the same rules as redirect URIs (https, or http on localhost)",
        },
        400
      );
      return;
    }
    const rec = registerClient({
      redirectUris,
      ...(clientName ? { clientName } : {}),
      ...(logoRaw ? { logoUri: logoRaw } : {}),
    });
    res.status(201);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({
      client_id: rec.clientId,
      ...(rec.clientName ? { client_name: rec.clientName } : {}),
      ...(rec.logoUri ? { logo_uri: rec.logoUri } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: rec.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/oauth/authorize", (req: Request, res: Response) => {
    const q = req.query;
    const response_type = typeof q.response_type === "string" ? q.response_type : null;
    const client_id = typeof q.client_id === "string" ? q.client_id : null;
    const redirect_uri = typeof q.redirect_uri === "string" ? q.redirect_uri : null;
    const state = typeof q.state === "string" ? q.state : null;
    const code_challenge = typeof q.code_challenge === "string" ? q.code_challenge : "";
    const code_challenge_method =
      typeof q.code_challenge_method === "string" ? q.code_challenge_method : "S256";
    const scope = typeof q.scope === "string" ? q.scope : "";

    if (response_type !== "code") {
      errorRedirect(res, redirect_uri, "unsupported_response_type", state);
      return;
    }
    if (!client_id || !redirect_uri) {
      res.status(400).send("Missing client_id or redirect_uri");
      return;
    }

    const client = getClient(client_id);
    if (!client) {
      res
        .status(400)
        .send(
          "This application is not registered. Use POST /oauth/register with redirect_uris (and optional client_name, logo_uri) first."
        );
      return;
    }
    if (!client.redirectUris.includes(redirect_uri)) {
      errorRedirect(res, redirect_uri, "invalid_request", state);
      return;
    }

    const action = `${issuer}/oauth/authorize`;
    const appLabel = displayClientName(client);
    const logoBlock = buildAppLogoMarkup(client, appLabel);
    const redirectLabel = formatRedirectDisplay(redirect_uri);
    const checkSvg = `<svg class="perm-check" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 9.5L8 13l6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Authorize API access · Workflow Automation Engine · ${esc(appLabel)}</title>
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
    .shell { width: 100%; max-width: 28rem; }
    .card {
      background: #ffffff;
      border: 1px solid #d4d4d4;
      border-radius: 10px;
      padding: 1.75rem 1.75rem 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 0.35rem;
      letter-spacing: -0.02em;
      color: #0a0a0a;
      line-height: 1.25;
    }
    .resource-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: #404040;
      margin: 0 0 1.35rem;
      letter-spacing: -0.01em;
    }
    .app-block {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 1.25rem;
    }
    .app-logo-box {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
      position: relative;
    }
    .app-logo-img {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .app-logo-fallback {
      font-size: 1.125rem;
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
    .app-copy { min-width: 0; }
    .lead {
      margin: 0 0 0.35rem;
      font-size: 0.9375rem;
      line-height: 1.45;
      color: #171717;
    }
    .lead strong { font-weight: 600; }
    .redirect {
      margin: 0;
      font-size: 0.8125rem;
      color: #737373;
      line-height: 1.4;
    }
    .redirect code {
      font-size: 0.78rem;
      font-family: ui-monospace, monospace;
      color: #404040;
      word-break: break-all;
    }
    .perms {
      list-style: none;
      margin: 0 0 1.25rem;
      padding: 0;
    }
    .perms li {
      display: flex;
      gap: 0.65rem;
      align-items: flex-start;
      font-size: 0.875rem;
      line-height: 1.45;
      color: #262626;
      margin-bottom: 0.65rem;
    }
    .perms li:last-child { margin-bottom: 0; }
    .perm-check {
      flex-shrink: 0;
      margin-top: 2px;
      color: #0a0a0a;
    }
    .hint {
      font-size: 0.8125rem;
      line-height: 1.5;
      color: #525252;
      margin: 0 0 1rem;
      padding: 0.75rem 0.85rem;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
    }
    .hint code { font-size: 0.75rem; }
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
      border-color: #0a0a0a;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08);
    }
    textarea::placeholder { color: #a3a3a3; }
    .actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.65rem;
      margin-top: 1.25rem;
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
    .fineprint {
      margin-top: 1rem;
      font-size: 0.6875rem;
      color: #737373;
      text-align: center;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1 class="title">Authorize API access</h1>
      <p class="resource-name">Workflow Automation Engine</p>
      <div class="app-block">
        ${logoBlock}
        <div class="app-copy">
          <p class="lead"><strong>${esc(appLabel)}</strong> wants access to the following:</p>
          <p class="redirect">Redirecting to <code>${esc(redirectLabel)}</code></p>
        </div>
      </div>
      <ul class="perms">
        <li>${checkSvg}<span>Full access to your workflows, schedules, and execution history for this account</span></li>
        <li>${checkSvg}<span>Allow the application to run workflows using credentials you provide below</span></li>
      </ul>
      <p class="hint">Paste a <strong>workflow API key</strong> (<code>wfmcp_…</code>) from your app settings, or your <strong>signed-in session access token</strong> (JWT). That same value is returned as the OAuth access token for MCP.</p>
      <form method="post" action="${esc(action)}">
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value="${esc(client_id)}" />
        <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}" />
        <input type="hidden" name="state" value="${esc(state ?? "")}" />
        <input type="hidden" name="code_challenge" value="${esc(code_challenge)}" />
        <input type="hidden" name="code_challenge_method" value="${esc(code_challenge_method)}" />
        <input type="hidden" name="scope" value="${esc(scope)}" />
        <label for="user_access_token">API key or access token</label>
        <textarea id="user_access_token" name="user_access_token" required autocomplete="off" spellcheck="false" placeholder="wfmcp_… or eyJhbGciOiJIUzI1NiIs…"></textarea>
        <div class="actions">
          <button type="button" class="btn-cancel" onclick="if (history.length > 1) history.back(); else window.close();">Cancel</button>
          <button type="submit" class="btn-submit">Authorize</button>
        </div>
      </form>
    </div>
    <p class="fineprint">You can revoke workflow API keys anytime in your app settings.</p>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(html);
  });

  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    const b = req.body as Record<string, string | undefined>;
    const response_type = String(b.response_type ?? "");
    const client_id = String(b.client_id ?? "");
    const redirect_uri = String(b.redirect_uri ?? "");
    const state = String(b.state ?? "");
    const code_challenge = String(b.code_challenge ?? "");
    const code_challenge_method = String(b.code_challenge_method ?? "S256");
    const user_access_token = String(b.user_access_token ?? "").trim();

    if (response_type !== "code" || !client_id || !redirect_uri) {
      res.status(400).send("Invalid request");
      return;
    }

    const client = getClient(client_id);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      errorRedirect(res, redirect_uri || null, "invalid_request", state || null);
      return;
    }

    if (!user_access_token) {
      res.status(400).send("Access token is required");
      return;
    }

    const authUserId = await resolveSupabaseUserIdFromCredential(user_access_token);
    if (!authUserId) {
      res
        .status(400)
        .send("Invalid credential. Use a workflow API key (wfmcp_…) or a valid session access token (JWT).");
      return;
    }

    const exp = Date.now() + CODE_TTL_MS;
    let code: string;
    try {
      code = sealAuthCode({
        access_token: user_access_token,
        exp,
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Server configuration error";
      res.status(500).send(msg);
      return;
    }

    const u = new URL(redirect_uri);
    u.searchParams.set("code", code);
    if (state) u.searchParams.set("state", state);
    res.redirect(u.toString());
  });

  app.post("/oauth/token", (req: Request, res: Response) => {
    const params =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, string>)
        : {};

    const grantType = params.grant_type;
    if (grantType !== "authorization_code") {
      corsJson(res, { error: "unsupported_grant_type" }, 400);
      return;
    }

    const code = params.code?.trim();
    const clientId = params.client_id?.trim();
    const redirectUri = params.redirect_uri?.trim();
    const codeVerifier = params.code_verifier?.trim() ?? "";

    if (!code || !clientId || !redirectUri) {
      corsJson(res, { error: "invalid_request", error_description: "Missing parameters" }, 400);
      return;
    }

    let payload;
    try {
      payload = openAuthCode(code);
    } catch {
      corsJson(res, { error: "invalid_grant", error_description: "Invalid authorization code" }, 400);
      return;
    }

    if (Date.now() > payload.exp) {
      corsJson(res, { error: "invalid_grant", error_description: "Code expired" }, 400);
      return;
    }
    if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
      corsJson(res, { error: "invalid_grant", error_description: "Code validation failed" }, 400);
      return;
    }

    if (payload.code_challenge) {
      if (!codeVerifier) {
        corsJson(res, { error: "invalid_request", error_description: "Missing code_verifier" }, 400);
        return;
      }
      if (
        !verifyPkceChallenge(
          codeVerifier,
          payload.code_challenge,
          payload.code_challenge_method || "S256"
        )
      ) {
        corsJson(res, { error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
        return;
      }
    }

    if (!payload.access_token) {
      corsJson(res, { error: "invalid_grant", error_description: "No token in authorization" }, 400);
      return;
    }

    corsJson(res, {
      access_token: payload.access_token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "workflow",
    });
  });
}
