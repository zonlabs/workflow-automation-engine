import type { AIProvider } from "../provider";
import type {
  ChatParams,
  ChatResponse,
  ChatWithToolsParams,
  ToolChatResponse,
  AIToolCall,
  AIMessage,
} from "../types";

// @google/genai is ESM-only; we use dynamic import() to load it from CJS.
let _genaiModule: {
  GoogleGenAI: new (opts: { apiKey: string }) => GoogleGenAIClient;
} | null = null;

interface GoogleGenAIClient {
  models: {
    generateContent: (params: Record<string, unknown>) => Promise<GenAIResponse>;
  };
}

interface GenAIResponse {
  text?: string;
  candidates?: Array<{
    content?: { parts?: GenAIPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface GenAIPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

async function loadModule(): Promise<typeof _genaiModule & {}> {
  if (!_genaiModule) {
    _genaiModule = await import("@google/genai" as string);
  }
  return _genaiModule!;
}

export class GoogleProvider implements AIProvider {
  readonly name = "google";
  private apiKey: string;
  private client: GoogleGenAIClient | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient(): Promise<GoogleGenAIClient> {
    if (!this.client) {
      const mod = await loadModule();
      this.client = new mod.GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const client = await this.getClient();
    const { systemInstruction, contents } = this.buildContents(params.messages);

    const response = await client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: systemInstruction || undefined,
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.max_tokens,
        ...(params.response_format?.type === "json_object"
          ? { responseMimeType: "application/json" }
          : {}),
      },
    });

    return this.extractChatResponse(response);
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ToolChatResponse> {
    const client = await this.getClient();
    const { systemInstruction, contents } = this.buildContents(params.messages);

    const tools =
      params.tools.length > 0
        ? [
            {
              functionDeclarations: params.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: this.convertJsonSchemaToGemini(t.parameters),
              })),
            },
          ]
        : undefined;

    const response = await client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: systemInstruction || undefined,
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.max_tokens,
        tools,
      },
    });

    return this.extractToolResponse(response);
  }

  private buildContents(
    messages: AIMessage[]
  ): { systemInstruction: string; contents: Record<string, unknown>[] } {
    const systemParts: string[] = [];
    const contents: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
        continue;
      }

      if (msg.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.tool_call_id ?? "tool",
                response: this.safeParseJson(msg.content),
              },
            },
          ],
        });
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls?.length) {
        const parts: Record<string, unknown>[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
        contents.push({ role: "model", parts });
        continue;
      }

      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    return { systemInstruction: systemParts.join("\n\n"), contents };
  }

  private extractChatResponse(response: GenAIResponse): ChatResponse {
    const text = response.text ?? "";
    const usage = response.usageMetadata;
    return {
      content: text,
      usage: {
        prompt_tokens: usage?.promptTokenCount ?? 0,
        completion_tokens: usage?.candidatesTokenCount ?? 0,
        total_tokens: usage?.totalTokenCount ?? 0,
      },
      finish_reason: response.candidates?.[0]?.finishReason ?? "STOP",
    };
  }

  private extractToolResponse(response: GenAIResponse): ToolChatResponse {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    let textContent: string | null = null;
    const toolCalls: AIToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        textContent = part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    const usage = response.usageMetadata;
    return {
      content: textContent,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: usage?.promptTokenCount ?? 0,
        completion_tokens: usage?.candidatesTokenCount ?? 0,
        total_tokens: usage?.totalTokenCount ?? 0,
      },
      finish_reason: candidate?.finishReason ?? "STOP",
    };
  }

  private convertJsonSchemaToGemini(
    schema: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!schema || Object.keys(schema).length === 0) return undefined;

    const convert = (s: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      const schemaType = s.type as string | undefined;

      if (schemaType === "object") {
        result.type = "OBJECT";
        if (s.properties) {
          const props: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(
            s.properties as Record<string, Record<string, unknown>>
          )) {
            props[key] = convert(val);
          }
          result.properties = props;
        }
        if (s.required) result.required = s.required;
      } else if (schemaType === "array") {
        result.type = "ARRAY";
        if (s.items) result.items = convert(s.items as Record<string, unknown>);
      } else if (schemaType === "string") {
        result.type = "STRING";
      } else if (schemaType === "number" || schemaType === "integer") {
        result.type = "NUMBER";
      } else if (schemaType === "boolean") {
        result.type = "BOOLEAN";
      }

      if (s.description) result.description = s.description;
      if (s.enum) result.enum = s.enum;

      return result;
    };

    return convert(schema);
  }

  private safeParseJson(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw);
    } catch {
      return { result: raw };
    }
  }
}
