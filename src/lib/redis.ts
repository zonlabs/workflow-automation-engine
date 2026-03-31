import IORedis, { RedisOptions } from "ioredis";

function getRequiredString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function resolveRedisUrl(): string {
  const urlFromEnv = getRequiredString(process.env.REDIS_URL);
  if (urlFromEnv) {
    return urlFromEnv;
  }

  const railwayHost = getRequiredString(process.env.REDISHOST);
  const railwayPort = getRequiredString(process.env.REDISPORT);
  const railwayPassword = getRequiredString(process.env.REDISPASSWORD);
  const railwayUser = getRequiredString(process.env.REDISUSER) ?? "default";

  if (railwayHost && railwayPort) {
    const protocol = parseBoolean(process.env.REDIS_TLS) ? "rediss" : "redis";
    if (railwayPassword) {
      return `${protocol}://${encodeURIComponent(railwayUser)}:${encodeURIComponent(
        railwayPassword
      )}@${railwayHost}:${railwayPort}/0`;
    }
    return `${protocol}://${railwayHost}:${railwayPort}/0`;
  }

  const host = getRequiredString(process.env.REDIS_HOST) ?? "localhost";
  const port = getRequiredString(process.env.REDIS_PORT) ?? "6379";
  const password = getRequiredString(process.env.REDIS_PASSWORD);
  const protocol = parseBoolean(process.env.REDIS_TLS) ? "rediss" : "redis";

  if (password) {
    return `${protocol}://default:${encodeURIComponent(password)}@${host}:${port}/0`;
  }
  return `${protocol}://${host}:${port}/0`;
}

export function createRedisConnection(): IORedis {
  const redisUrl = resolveRedisUrl();
  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
  };

  if (redisUrl.startsWith("rediss://")) {
    options.tls = {};
  }

  return new IORedis(redisUrl, options);
}

let sharedConnection: IORedis | null = null;

export function getSharedRedisConnection(): IORedis {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
  }
  return sharedConnection;
}
