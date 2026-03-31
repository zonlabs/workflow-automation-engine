import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Capture the URL passed to the IORedis constructor so we can assert on it.
// Must be a regular function (not arrow) to allow `new IORedis(...)` calls.
const mockIORedis = vi.fn();
vi.mock("ioredis", () => ({
  default: mockIORedis,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

// We use resetModules + dynamic import per test so the module-level shared
// connection singleton is reset and env var changes are picked up.
describe("redis – URL resolution", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockIORedis.mockReset();
    // Regular function (not arrow) so `new IORedis(...)` works as a constructor.
    mockIORedis.mockImplementation(function () { return { status: "connecting" }; });

    // Clear all redis-related env vars
    for (const k of [
      "REDIS_URL",
      "REDISHOST",
      "REDISPORT",
      "REDISPASSWORD",
      "REDISUSER",
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_PASSWORD",
      "REDIS_TLS",
    ]) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in origEnv)) delete process.env[k];
    }
    Object.assign(process.env, origEnv);
  });

  // ── REDIS_URL ────────────────────────────────────────────────────────────

  it("uses REDIS_URL directly when provided", async () => {
    process.env.REDIS_URL = "redis://myhost:1234/0";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();
    expect(mockIORedis).toHaveBeenCalledWith(
      "redis://myhost:1234/0",
      expect.any(Object)
    );
  });

  it("trims whitespace from REDIS_URL", async () => {
    process.env.REDIS_URL = "  redis://myhost:1234/0  ";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();
    expect(mockIORedis).toHaveBeenCalledWith(
      "redis://myhost:1234/0",
      expect.any(Object)
    );
  });

  // ── Railway-style env vars (REDISHOST / REDISPORT) ───────────────────────

  it("builds redis:// URL from REDISHOST + REDISPORT (no password)", async () => {
    process.env.REDISHOST = "railway-host.railway.internal";
    process.env.REDISPORT = "6379";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();
    expect(mockIORedis).toHaveBeenCalledWith(
      "redis://railway-host.railway.internal:6379/0",
      expect.any(Object)
    );
  });

  it("embeds password in Railway URL when REDISPASSWORD is set", async () => {
    process.env.REDISHOST = "railway-host.railway.internal";
    process.env.REDISPORT = "6379";
    process.env.REDISPASSWORD = "secret pass";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl).toContain(encodeURIComponent("secret pass"));
    expect(usedUrl).toContain("railway-host.railway.internal:6379");
  });

  it("uses REDISUSER in Railway URL (defaults to 'default')", async () => {
    process.env.REDISHOST = "host";
    process.env.REDISPORT = "6380";
    process.env.REDISPASSWORD = "pw";
    process.env.REDISUSER = "myuser";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl).toContain("myuser");
  });

  it("uses 'default' as REDISUSER when REDISUSER is not set", async () => {
    process.env.REDISHOST = "host";
    process.env.REDISPORT = "6380";
    process.env.REDISPASSWORD = "pw";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl).toContain("default");
  });

  it("uses rediss:// for Railway URL when REDIS_TLS=true", async () => {
    process.env.REDISHOST = "host";
    process.env.REDISPORT = "6380";
    process.env.REDIS_TLS = "true";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl.startsWith("rediss://")).toBe(true);
  });

  // ── Generic REDIS_HOST / REDIS_PORT ──────────────────────────────────────

  it("builds URL from REDIS_HOST + REDIS_PORT (no password)", async () => {
    process.env.REDIS_HOST = "my-redis";
    process.env.REDIS_PORT = "6380";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    expect(mockIORedis).toHaveBeenCalledWith(
      "redis://my-redis:6380/0",
      expect.any(Object)
    );
  });

  it("embeds password in generic URL", async () => {
    process.env.REDIS_HOST = "my-redis";
    process.env.REDIS_PORT = "6380";
    process.env.REDIS_PASSWORD = "p@ssword!";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl).toContain(encodeURIComponent("p@ssword!"));
    expect(usedUrl).toContain("my-redis:6380");
  });

  it("uses rediss:// for generic URL when REDIS_TLS=true", async () => {
    process.env.REDIS_HOST = "my-redis";
    process.env.REDIS_PORT = "6380";
    process.env.REDIS_TLS = "true";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl.startsWith("rediss://")).toBe(true);
  });

  // ── Default fallback ──────────────────────────────────────────────────────

  it("falls back to redis://localhost:6379/0 when no env vars are set", async () => {
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    expect(mockIORedis).toHaveBeenCalledWith(
      "redis://localhost:6379/0",
      expect.any(Object)
    );
  });

  // ── TLS flag variations ───────────────────────────────────────────────────

  it.each(["1", "true", "yes", "on", "TRUE", "YES", "ON"])(
    "recognises REDIS_TLS=%s as truthy",
    async (val) => {
      process.env.REDIS_TLS = val;
      const { createRedisConnection } = await import("../../src/lib/redis");
      createRedisConnection();

      const usedUrl: string = mockIORedis.mock.calls[0][0];
      expect(usedUrl.startsWith("rediss://")).toBe(true);
    }
  );

  it("does not use TLS when REDIS_TLS=false", async () => {
    process.env.REDIS_TLS = "false";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const usedUrl: string = mockIORedis.mock.calls[0][0];
    expect(usedUrl.startsWith("redis://")).toBe(true);
    expect(usedUrl.startsWith("rediss://")).toBe(false);
  });

  // ── TLS options ───────────────────────────────────────────────────────────

  it("adds tls:{} to IORedis options when URL starts with rediss://", async () => {
    process.env.REDIS_URL = "rediss://secure-host:6380/0";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const opts: Record<string, unknown> = mockIORedis.mock.calls[0][1];
    expect(opts.tls).toBeDefined();
  });

  it("does not add tls option for plain redis:// URL", async () => {
    process.env.REDIS_URL = "redis://localhost:6379/0";
    const { createRedisConnection } = await import("../../src/lib/redis");
    createRedisConnection();

    const opts: Record<string, unknown> = mockIORedis.mock.calls[0][1];
    expect(opts.tls).toBeUndefined();
  });

  // ── Shared connection singleton ───────────────────────────────────────────

  it("getSharedRedisConnection returns the same instance on repeated calls", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getSharedRedisConnection } = await import("../../src/lib/redis");

    const a = getSharedRedisConnection();
    const b = getSharedRedisConnection();

    expect(a).toBe(b);
    // Constructor should only be called once
    expect(mockIORedis).toHaveBeenCalledTimes(1);
  });
});
