import { createHmac } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { supabase } from "../src/lib/supabase";

const WORKFLOW_API_KEY_PREFIX = "wfmcp_";

export function hashWorkflowApiKey(raw: string, pepper: string): string {
  return createHmac("sha256", pepper).update(raw, "utf8").digest("hex");
}

function getApiKeyPepper(): string | null {
  const p = process.env.WORKFLOW_API_KEY_PEPPER?.trim();
  if (!p || p.length < 16) return null;
  return p;
}

async function resolveUserIdFromApiKey(raw: string): Promise<string | null> {
  const pepper = getApiKeyPepper();
  if (!pepper) return null;

  const hash = hashWorkflowApiKey(raw, pepper);
  const { data, error } = await supabase
    .from("workflow_user_api_keys")
    .select("id, user_id")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  void supabase
    .from("workflow_user_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  const uid = String(data.user_id ?? "").trim();
  return uid.length > 0 ? uid : null;
}

/**
 * Resolves Supabase auth user id from Bearer: Supabase JWT or workflow API key (wfmcp_…).
 * Matches `workflows.user_id` / MCP session `identity` (UUID string).
 */
export async function resolveSupabaseUserIdFromCredential(token: string): Promise<string | null> {
  const t = token.trim();
  if (!t) return null;

  if (t.startsWith(WORKFLOW_API_KEY_PREFIX)) {
    return resolveUserIdFromApiKey(t);
  }

  const { data, error } = await supabase.auth.getUser(t);
  if (error || !data?.user?.id) return null;
  return String(data.user.id);
}

/** @deprecated Use resolveSupabaseUserIdFromCredential (returns auth UUID, not email). */
export async function resolvePrincipalEmailFromCredential(token: string): Promise<string | null> {
  return resolveSupabaseUserIdFromCredential(token);
}

/** Returns Supabase user id for workflow `user_id` columns (JWT or API key). */
export async function resolveUserIdFromRequest(req: {
  headers: IncomingHttpHeaders;
}): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || typeof authHeader !== "string") return null;

  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return null;

  const token = tokenMatch[1]?.trim();
  if (!token) return null;

  return resolveSupabaseUserIdFromCredential(token);
}
