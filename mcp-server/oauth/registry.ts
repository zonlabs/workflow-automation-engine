import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createRedisClient } from "redis";

export type RegisteredClient = {
  clientId: string;
  redirectUris: string[];
  createdAt: number;
  clientName?: string;
  logoUri?: string;
};

export type RegisterClientInput = {
  redirectUris: string[];
  clientName?: string;
  logoUri?: string;
};

const OAUTH_CLIENTS_TABLE = "oauth_dynamic_clients";

const memory = new Map<string, RegisteredClient>();

const REDIS_PREFIX = "workflow_mcp_oauth_client:";

type RedisConn = ReturnType<typeof createRedisClient>;

let redisClient: RedisConn | null = null;
let redisConnectPromise: Promise<RedisConn | null> | null = null;

let supabaseAdmin: SupabaseClient | null | undefined;

type RegistryBackend = "supabase" | "redis" | "memory";

let resolvedBackend: RegistryBackend | null = null;

function redisUrl(): string | undefined {
  const u = process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim();
  return u || undefined;
}

function getSupabaseAdmin(): SupabaseClient | null {
  if (supabaseAdmin !== undefined) {
    return supabaseAdmin;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    supabaseAdmin = null;
  }
  return supabaseAdmin;
}

function getBackend(): RegistryBackend {
  if (resolvedBackend !== null) {
    return resolvedBackend;
  }
  if (getSupabaseAdmin()) {
    resolvedBackend = "supabase";
  } else if (redisUrl()) {
    resolvedBackend = "redis";
  } else {
    resolvedBackend = "memory";
  }
  return resolvedBackend;
}

async function getRedis(): Promise<RedisConn | null> {
  const url = redisUrl();
  if (!url) return null;

  if (redisClient?.isOpen) return redisClient;

  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      const client = createRedisClient({ url });
      client.on("error", (err) => console.error("[oauth-registry] Redis error", err));
      await client.connect();
      redisClient = client;
      return redisClient;
    })().catch((err) => {
      console.error("[oauth-registry] Redis connect failed", err);
      redisConnectPromise = null;
      return null;
    });
  }

  return redisConnectPromise;
}

type OauthClientRow = {
  client_id: string;
  redirect_uris: unknown;
  created_at: string;
  client_name: string | null;
  logo_uri: string | null;
};

function rowToClient(row: OauthClientRow): RegisteredClient {
  const uris = Array.isArray(row.redirect_uris)
    ? (row.redirect_uris as string[])
    : typeof row.redirect_uris === "string"
      ? (JSON.parse(row.redirect_uris) as string[])
      : [];
  return {
    clientId: row.client_id,
    redirectUris: uris,
    createdAt: new Date(row.created_at).getTime(),
    ...(row.client_name ? { clientName: row.client_name } : {}),
    ...(row.logo_uri ? { logoUri: row.logo_uri } : {}),
  };
}

export async function registerClient(input: RegisterClientInput): Promise<RegisteredClient> {
  const { redirectUris, clientName, logoUri } = input;
  const clientId = `mcp-client-${randomBytes(16).toString("hex")}`;
  const rec: RegisteredClient = {
    clientId,
    redirectUris: redirectUris.length > 0 ? redirectUris : ["http://localhost:8080/callback"],
    createdAt: Date.now(),
    ...(clientName ? { clientName } : {}),
    ...(logoUri ? { logoUri } : {}),
  };

  const backend = getBackend();

  if (backend === "supabase") {
    const sb = getSupabaseAdmin()!;
    const { error } = await sb.from(OAUTH_CLIENTS_TABLE).insert({
      client_id: rec.clientId,
      redirect_uris: rec.redirectUris,
      created_at: new Date(rec.createdAt).toISOString(),
      client_name: rec.clientName ?? null,
      logo_uri: rec.logoUri ?? null,
    });
    if (error) {
      console.error("[oauth-registry] Supabase insert failed", error);
      throw new Error(`OAuth client registration failed: ${error.message}`);
    }
    return rec;
  }

  if (backend === "redis") {
    const r = await getRedis();
    if (r) {
      await r.set(`${REDIS_PREFIX}${clientId}`, JSON.stringify(rec));
      return rec;
    }
    resolvedBackend = "memory";
  }

  memory.set(clientId, rec);
  return rec;
}

export async function getClient(clientId: string): Promise<RegisteredClient | undefined> {
  const backend = getBackend();

  if (backend === "supabase") {
    const sb = getSupabaseAdmin()!;
    const { data, error } = await sb
      .from(OAUTH_CLIENTS_TABLE)
      .select("client_id, redirect_uris, created_at, client_name, logo_uri")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      console.error("[oauth-registry] Supabase select failed", error);
      return undefined;
    }
    if (data) {
      return rowToClient(data as OauthClientRow);
    }
    return undefined;
  }

  if (backend === "redis") {
    const r = await getRedis();
    if (r) {
      const raw = await r.get(`${REDIS_PREFIX}${clientId}`);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as RegisteredClient;
      } catch {
        return undefined;
      }
    }
  }

  return memory.get(clientId);
}
