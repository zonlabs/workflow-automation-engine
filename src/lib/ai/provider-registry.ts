import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";

const DEFAULT_PROVIDER = process.env.AI_DEFAULT_PROVIDER ?? "deepseek";
const DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL ?? "deepseek-chat";

type ModelFactory = (modelId: string) => LanguageModel;

const factories = new Map<string, ModelFactory>();

function getFactory(providerName: string): ModelFactory {
  const existing = factories.get(providerName);
  if (existing) return existing;

  let factory: ModelFactory;

  switch (providerName) {
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is required for OpenAI provider.");
      const provider = createOpenAI({ apiKey: key });
      factory = (id) => provider.chat(id);
      break;
    }
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is required for Anthropic provider.");
      const provider = createAnthropic({ apiKey: key });
      factory = (id) => provider.languageModel(id);
      break;
    }
    case "google": {
      const key = process.env.GOOGLE_AI_API_KEY;
      if (!key) throw new Error("GOOGLE_AI_API_KEY is required for Google AI provider.");
      const provider = createGoogleGenerativeAI({ apiKey: key });
      factory = (id) => provider.languageModel(id);
      break;
    }
    case "deepseek": {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error("DEEPSEEK_API_KEY is required for DeepSeek provider.");
      const provider = createDeepSeek({ apiKey: key });
      factory = (id) => provider.languageModel(id);
      break;
    }
    default:
      throw new Error(
        `Unknown AI provider "${providerName}". Supported: openai, anthropic, google, deepseek`
      );
  }

  factories.set(providerName, factory);
  return factory;
}

export interface ResolvedModel {
  model: LanguageModel;
  providerName: string;
  modelId: string;
}

/**
 * Parse a tool_slug like "deepseek/deepseek-chat" or "openai/gpt-4o" into a LanguageModel.
 * Falls back to AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL (or built-in deepseek defaults) when the slug
 * doesn't contain a slash.
 */
export function resolveModel(toolSlug: string): ResolvedModel {
  let providerName: string;
  let modelId: string;

  if (toolSlug.includes("/")) {
    const idx = toolSlug.indexOf("/");
    providerName = toolSlug.slice(0, idx);
    modelId = toolSlug.slice(idx + 1);
  } else {
    providerName = DEFAULT_PROVIDER;
    modelId = toolSlug || DEFAULT_MODEL;
  }

  const factory = getFactory(providerName);
  return { model: factory(modelId), providerName, modelId };
}

export function getDefaultProviderName(): string {
  return DEFAULT_PROVIDER;
}

export function getDefaultModel(): string {
  return DEFAULT_MODEL;
}
