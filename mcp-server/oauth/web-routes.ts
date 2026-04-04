/**
 * Web-standard Response handlers for OAuth + discovery (used by Next.js on Vercel).
 */

import { getIssuer } from "./config";
import { resolveSupabaseUserIdFromCredential } from "../auth";
import { sealAuthCode, openAuthCode } from "./auth-code";
import { verifyPkceChallenge } from "./pkce";
import { getClient, registerClient } from "./registry";
import { isAllowedRedirectUri } from "./redirect-uri";
import { buildOauthAuthorizeHtml } from "./authorize-page";

const CODE_TTL_MS = 10 * 60 * 1000;

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function isSafeRedirectUrl(uri: string): boolean {
  return isAllowedRedirectUri(uri);
}

function errorRedirectResponse(redirectUri: string | null, error: string, state: string | null): Response {
  if (!redirectUri || !isSafeRedirectUrl(redirectUri)) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (state) u.searchParams.set("state", state);
  return Response.redirect(u.toString(), 302);
}

function normalizeClientName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().slice(0, 80);
  return t.length > 0 ? t : undefined;
}

function normalizeLogoUri(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const u = raw.trim();
  return u || undefined;
}

export function oauthAuthorizationServerMetadataResponse(): Response {
  const issuer = getIssuer();
  return new Response(
    JSON.stringify({
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
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function oauthRegisterPost(body: unknown): Promise<Response> {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const redirectUris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return corsJson(
        {
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI: ${uri}`,
        },
        400
      );
    }
  }
  const clientName = normalizeClientName(b.client_name);
  const logoRaw = normalizeLogoUri(b.logo_uri);
  if (logoRaw && !isAllowedRedirectUri(logoRaw)) {
    return corsJson(
      {
        error: "invalid_client_metadata",
        error_description:
          "logo_uri must use the same rules as redirect URIs (https, or http on localhost)",
      },
      400
    );
  }
  const rec = await registerClient({
    redirectUris: redirectUris as string[],
    ...(clientName ? { clientName } : {}),
    ...(logoRaw ? { logoUri: logoRaw } : {}),
  });
  return new Response(
    JSON.stringify({
      client_id: rec.clientId,
      ...(rec.clientName ? { client_name: rec.clientName } : {}),
      ...(rec.logoUri ? { logo_uri: rec.logoUri } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: rec.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function oauthAuthorizeGet(searchParams: URLSearchParams): Promise<Response> {
  const issuer = getIssuer();
  const response_type = searchParams.get("response_type");
  const client_id = searchParams.get("client_id");
  const redirect_uri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const code_challenge = searchParams.get("code_challenge") ?? "";
  const code_challenge_method = searchParams.get("code_challenge_method") ?? "S256";
  const scope = searchParams.get("scope") ?? "";

  if (response_type !== "code") {
    return errorRedirectResponse(redirect_uri, "unsupported_response_type", state);
  }
  if (!client_id || !redirect_uri) {
    return new Response("Missing client_id or redirect_uri", { status: 400 });
  }

  const client = await getClient(client_id);
  if (!client) {
    return new Response(
      "This application is not registered. Use POST /oauth/register with redirect_uris (and optional client_name, logo_uri) first.",
      { status: 400 }
    );
  }
  if (!client.redirectUris.includes(redirect_uri)) {
    return errorRedirectResponse(redirect_uri, "invalid_request", state);
  }

  const html = buildOauthAuthorizeHtml(issuer, client, {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function oauthAuthorizePost(form: Record<string, string>): Promise<Response> {
  const response_type = String(form.response_type ?? "");
  const client_id = String(form.client_id ?? "");
  const redirect_uri = String(form.redirect_uri ?? "");
  const state = String(form.state ?? "");
  const code_challenge = String(form.code_challenge ?? "");
  const code_challenge_method = String(form.code_challenge_method ?? "S256");
  const user_access_token = String(form.user_access_token ?? "").trim();

  if (response_type !== "code" || !client_id || !redirect_uri) {
    return new Response("Invalid request", { status: 400 });
  }

  const client = await getClient(client_id);
  if (!client || !client.redirectUris.includes(redirect_uri)) {
    return errorRedirectResponse(redirect_uri || null, "invalid_request", state || null);
  }

  if (!user_access_token) {
    return new Response("Access token is required", { status: 400 });
  }

  const authUserId = await resolveSupabaseUserIdFromCredential(user_access_token);
  if (!authUserId) {
    return new Response(
      "Invalid credential. Use a workflow API key (wfmcp_…) or a valid session access token (JWT).",
      { status: 400 }
    );
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
    return new Response(msg, { status: 500 });
  }

  const u = new URL(redirect_uri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  return Response.redirect(u.toString(), 302);
}

export async function oauthTokenPost(params: Record<string, string>): Promise<Response> {
  const grantType = params.grant_type;
  if (grantType !== "authorization_code") {
    return corsJson({ error: "unsupported_grant_type" }, 400);
  }

  const code = params.code?.trim();
  const clientId = params.client_id?.trim();
  const redirectUri = params.redirect_uri?.trim();
  const codeVerifier = params.code_verifier?.trim() ?? "";

  if (!code || !clientId || !redirectUri) {
    return corsJson({ error: "invalid_request", error_description: "Missing parameters" }, 400);
  }

  let payload;
  try {
    payload = openAuthCode(code);
  } catch {
    return corsJson({ error: "invalid_grant", error_description: "Invalid authorization code" }, 400);
  }

  if (Date.now() > payload.exp) {
    return corsJson({ error: "invalid_grant", error_description: "Code expired" }, 400);
  }
  if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
    return corsJson({ error: "invalid_grant", error_description: "Code validation failed" }, 400);
  }

  if (payload.code_challenge) {
    if (!codeVerifier) {
      return corsJson({ error: "invalid_request", error_description: "Missing code_verifier" }, 400);
    }
    if (
      !verifyPkceChallenge(
        codeVerifier,
        payload.code_challenge,
        payload.code_challenge_method || "S256"
      )
    ) {
      return corsJson({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }
  }

  if (!payload.access_token) {
    return corsJson({ error: "invalid_grant", error_description: "No token in authorization" }, 400);
  }

  return corsJson({
    access_token: payload.access_token,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "workflow",
  });
}
