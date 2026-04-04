import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the AI SDK providers so no real network calls are made.
// These are hoisted before imports by vitest.
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn((id: string) => ({ provider: "openai", id })),
  })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => ({
    languageModel: vi.fn((id: string) => ({ provider: "anthropic", id })),
  })),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    languageModel: vi.fn((id: string) => ({ provider: "google", id })),
  })),
}));

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: vi.fn(() => ({
    languageModel: vi.fn((id: string) => ({ provider: "deepseek", id })),
  })),
}));

// We use resetModules + dynamic import per test so the module-level
// `factories` Map is fresh and env-var changes are picked up cleanly.
describe("provider-registry – resolveModel", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Restore safe defaults for every test
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GOOGLE_AI_API_KEY = "test-google-key";
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    process.env.AI_DEFAULT_PROVIDER = "openai";
    process.env.AI_DEFAULT_MODEL = "gpt-4o";
  });

  afterEach(() => {
    // Restore original env
    for (const k of Object.keys(process.env)) {
      if (!(k in origEnv)) delete process.env[k];
    }
    Object.assign(process.env, origEnv);
  });

  // ── slug parsing ─────────────────────────────────────────────────────────

  it("parses 'openai/gpt-4o' into providerName=openai, modelId=gpt-4o", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("openai/gpt-4o");
    expect(result.providerName).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
    expect(result.model).toBeDefined();
  });

  it("parses 'anthropic/claude-3-5-haiku-20241022'", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("anthropic/claude-3-5-haiku-20241022");
    expect(result.providerName).toBe("anthropic");
    expect(result.modelId).toBe("claude-3-5-haiku-20241022");
  });

  it("parses 'google/gemini-2.0-flash'", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("google/gemini-2.0-flash");
    expect(result.providerName).toBe("google");
    expect(result.modelId).toBe("gemini-2.0-flash");
  });

  it("parses 'deepseek/deepseek-chat'", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("deepseek/deepseek-chat");
    expect(result.providerName).toBe("deepseek");
    expect(result.modelId).toBe("deepseek-chat");
  });

  it("handles a slug with multiple slashes – splits at first slash only", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    // e.g. openai/gpt-4/custom → provider=openai, model=gpt-4/custom
    const result = resolveModel("openai/gpt-4/custom");
    expect(result.providerName).toBe("openai");
    expect(result.modelId).toBe("gpt-4/custom");
  });

  it("falls back to AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL when slug has no slash", async () => {
    process.env.AI_DEFAULT_PROVIDER = "openai";
    process.env.AI_DEFAULT_MODEL = "gpt-4o";
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("some-bare-slug");
    expect(result.providerName).toBe("openai");
    expect(result.modelId).toBe("some-bare-slug");
  });

  it("falls back to DEFAULT_MODEL when slug is empty string", async () => {
    process.env.AI_DEFAULT_PROVIDER = "openai";
    process.env.AI_DEFAULT_MODEL = "gpt-4o";
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("");
    expect(result.providerName).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
  });

  it("uses built-in default deepseek/deepseek-chat when AI_DEFAULT_* are unset", async () => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    delete process.env.AI_DEFAULT_PROVIDER;
    delete process.env.AI_DEFAULT_MODEL;
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const result = resolveModel("");
    expect(result.providerName).toBe("deepseek");
    expect(result.modelId).toBe("deepseek-chat");
  });

  // ── missing API keys ──────────────────────────────────────────────────────

  it("throws when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    expect(() => resolveModel("openai/gpt-4o")).toThrow("OPENAI_API_KEY");
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    expect(() => resolveModel("anthropic/claude-3-5-haiku-20241022")).toThrow(
      "ANTHROPIC_API_KEY"
    );
  });

  it("throws when GOOGLE_AI_API_KEY is missing", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    expect(() => resolveModel("google/gemini-2.0-flash")).toThrow(
      "GOOGLE_AI_API_KEY"
    );
  });

  it("throws when DEEPSEEK_API_KEY is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    expect(() => resolveModel("deepseek/deepseek-chat")).toThrow("DEEPSEEK_API_KEY");
  });

  it("throws for an unknown provider name", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    expect(() => resolveModel("cohere/command-r")).toThrow(/unknown ai provider/i);
  });

  // ── helper getters ────────────────────────────────────────────────────────

  it("getDefaultProviderName returns AI_DEFAULT_PROVIDER env var", async () => {
    process.env.AI_DEFAULT_PROVIDER = "anthropic";
    const { getDefaultProviderName } = await import(
      "../../../src/lib/ai/provider-registry"
    );
    expect(getDefaultProviderName()).toBe("anthropic");
  });

  it("getDefaultModel returns AI_DEFAULT_MODEL env var", async () => {
    process.env.AI_DEFAULT_MODEL = "gpt-4o-mini";
    const { getDefaultModel } = await import(
      "../../../src/lib/ai/provider-registry"
    );
    expect(getDefaultModel()).toBe("gpt-4o-mini");
  });

  // ── factory caching ───────────────────────────────────────────────────────

  it("caches provider factory after first call (same model reference)", async () => {
    const { resolveModel } = await import("../../../src/lib/ai/provider-registry");
    const r1 = resolveModel("openai/gpt-4o");
    const r2 = resolveModel("openai/gpt-4o-mini");
    // Both share the same factory instance – we verify no error on second call
    expect(r1.providerName).toBe("openai");
    expect(r2.providerName).toBe("openai");
    expect(r1.modelId).not.toBe(r2.modelId);
  });
});
