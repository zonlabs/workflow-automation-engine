import type {
  ChatParams,
  ChatResponse,
  ChatWithToolsParams,
  ToolChatResponse,
} from "./types";

export interface AIProvider {
  readonly name: string;

  chat(params: ChatParams): Promise<ChatResponse>;

  chatWithTools(params: ChatWithToolsParams): Promise<ToolChatResponse>;
}
