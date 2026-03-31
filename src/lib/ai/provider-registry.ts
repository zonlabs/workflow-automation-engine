import type { AIProvider } from "./provider";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { GoogleProvider } from "./providers/google";

const DEFAULT_PROVIDER = process.env.AI_DEFAULT_PROVIDER ?? "openai";
const DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL ?? "gpt-4o";

const providers = new Map<string, AIProvider>();

function getOrCreateProvider(providerName: string): AIProvider {
  const existing = providers.get(providerName);
  if (existing) return existing;

  let provider: AIProvider;

  switch (providerName) {
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        throw new Error(
          "OPENAI_API_KEY is required for OpenAI provider. Set it in your environment."
        );
      }
      provider = new OpenAIProvider(key);
      break;
    }
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error(
          "ANTHROPIC_API_KEY is required for Anthropic provider. Set it in your environment."
        );
      }
      provider = new AnthropicProvider(key);
      break;
    }
    case "google": {
      const key = process.env.GOOGLE_AI_API_KEY;
      if (!key) {
        throw new Error(
          "GOOGLE_AI_API_KEY is required for Google AI provider. Set it in your environment."
        );
      }
      provider = new GoogleProvider(key);
      break;
    }
    default:
      throw new Error(
        `Unknown AI provider "${providerName}". Supported: openai, anthropic, google`
      );
  }

  providers.set(providerName, provider);
  return provider;
}

export interface ResolvedProviderModel {
  provider: AIProvider;
  providerName: string;
  model: string;
}

/**
 * Parse a tool_slug like "openai/gpt-4o" into provider + model.
 * Falls back to AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL when the slug
 * doesn't contain a slash (e.g. just "gpt-4o" assumes the default provider).
 */
export function resolveProviderAndModel(toolSlug: string): ResolvedProviderModel {
  let providerName: string;
  let model: string;

  if (toolSlug.includes("/")) {
    const idx = toolSlug.indexOf("/");
    providerName = toolSlug.slice(0, idx);
    model = toolSlug.slice(idx + 1);
  } else {
    providerName = DEFAULT_PROVIDER;
    model = toolSlug || DEFAULT_MODEL;
  }

  const provider = getOrCreateProvider(providerName);
  return { provider, providerName, model };
}

export function getProvider(name: string): AIProvider {
  return getOrCreateProvider(name);
}

export function getDefaultProviderName(): string {
  return DEFAULT_PROVIDER;
}

export function getDefaultModel(): string {
  return DEFAULT_MODEL;
}
