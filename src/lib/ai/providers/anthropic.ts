import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "../provider";
import type {
  ChatParams,
  ChatResponse,
  ChatWithToolsParams,
  ToolChatResponse,
  AIToolCall,
  AIMessage,
} from "../types";

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const { system, messages } = this.splitSystemMessages(params.messages);

    const response = await this.client.messages.create({
      model: params.model,
      system: system || undefined,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 4096,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      content: textBlock?.type === "text" ? textBlock.text : "",
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finish_reason: response.stop_reason ?? "end_turn",
    };
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ToolChatResponse> {
    const { system, messages } = this.splitSystemMessages(params.messages);

    const anthropicMessages = this.buildMessages(messages);

    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: params.model,
      system: system || undefined,
      messages: anthropicMessages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 4096,
    });

    let textContent: string | null = null;
    const toolCalls: AIToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent = block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finish_reason: response.stop_reason ?? "end_turn",
    };
  }

  private splitSystemMessages(
    messages: AIMessage[]
  ): { system: string; messages: AIMessage[] } {
    const systemParts: string[] = [];
    const rest: AIMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content);
      } else {
        rest.push(msg);
      }
    }

    return { system: systemParts.join("\n\n"), messages: rest };
  }

  private buildMessages(
    messages: AIMessage[]
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "assistant" && msg.tool_calls?.length) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        const lastMsg = result[result.length - 1];
        const toolResultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id!,
          content: msg.content,
        };
        if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
        } else {
          result.push({ role: "user", content: [toolResultBlock] });
        }
      } else {
        result.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    return result;
  }
}
