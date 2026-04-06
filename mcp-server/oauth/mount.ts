import type { Application, Request, Response } from "express-serve-static-core";
import { getIssuer } from "./config";
import { resolveSupabaseUserIdFromCredential } from "../auth";
import { sealAuthCode, openAuthCode } from "./auth-code";
import { verifyPkceChallenge } from "./pkce";
import { getClient, registerClient } from "./registry";
import { describeRedirectUriPolicyForError, isAllowedRedirectUri } from "./redirect-uri";
import { buildOauthAuthorizeHtml } from "./authorize-page";

const CODE_TTL_MS = 10 * 60 * 1000;

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
export function mountWorkflowOAuth(app: Application): void {
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

  app.post("/oauth/register", async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    for (const uri of redirectUris) {
      if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
        corsJson(
          res,
          {
            error: "invalid_redirect_uri",
            error_description: `Invalid redirect URI: ${uri}. Allowed: ${describeRedirectUriPolicyForError()}`,
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
    const rec = await registerClient({
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

  app.get("/oauth/authorize", async (req: Request, res: Response) => {
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

    const client = await getClient(client_id);
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

    const html = buildOauthAuthorizeHtml(issuer, client, {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope,
    });

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

    const client = await getClient(client_id);
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
    const finalUrl = u.toString();

    res.redirect(finalUrl);
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
