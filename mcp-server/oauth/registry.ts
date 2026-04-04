import { randomBytes } from "node:crypto";
import { createClient } from "redis";

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

const memory = new Map<string, RegisteredClient>();

const REDIS_PREFIX = "workflow_mcp_oauth_client:";

type RedisConn = ReturnType<typeof createClient>;

let redisClient: RedisConn | null = null;
let redisConnectPromise: Promise<RedisConn | null> | null = null;

function redisUrl(): string | undefined {
  const u = process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim();
  return u || undefined;
}

async function getRedis(): Promise<RedisConn | null> {
  const url = redisUrl();
  if (!url) return null;

  if (redisClient?.isOpen) return redisClient;

  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      const client = createClient({ url });
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

  const r = await getRedis();
  if (r) {
    await r.set(`${REDIS_PREFIX}${clientId}`, JSON.stringify(rec));
  } else {
    memory.set(clientId, rec);
  }
  return rec;
}

export async function getClient(clientId: string): Promise<RegisteredClient | undefined> {
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
  return memory.get(clientId);
}
