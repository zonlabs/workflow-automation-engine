import OpenAI from "openai";
import type { AIProvider } from "../provider";
import type {
  ChatParams,
  ChatResponse,
  ChatWithToolsParams,
  ToolChatResponse,
  AIToolCall,
} from "../types";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens,
      ...(params.response_format && this.mapResponseFormat(params.response_format)),
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content ?? "",
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
      finish_reason: choice.finish_reason ?? "stop",
    };
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ToolChatResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map(
      (m) => {
        if (m.role === "tool") {
          return {
            role: "tool" as const,
            tool_call_id: m.tool_call_id!,
            content: m.content,
          };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant" as const,
            content: m.content || null,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        return {
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        };
      }
    );

    const tools: OpenAI.ChatCompletionTool[] = params.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as OpenAI.FunctionParameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens,
      ...(params.response_format && this.mapResponseFormat(params.response_format)),
    });

    const choice = response.choices[0];
    const toolCalls: AIToolCall[] = (choice.message.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParseJson(tc.function.arguments),
      })
    );

    return {
      content: choice.message.content,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
      finish_reason: choice.finish_reason ?? "stop",
    };
  }

  private mapResponseFormat(
    fmt: NonNullable<ChatParams["response_format"]>
  ): { response_format?: OpenAI.ChatCompletionCreateParams["response_format"] } {
    if (fmt.type === "json_object") {
      return { response_format: { type: "json_object" } };
    }
    if (fmt.type === "json_schema" && fmt.schema) {
      return {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "response",
            strict: true,
            schema: fmt.schema,
          },
        },
      };
    }
    return {};
  }

  private safeParseJson(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }
}
