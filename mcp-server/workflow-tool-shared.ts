import { getRequestContext } from "./request-context";

export type JsonObject = Record<string, unknown>;

export function asJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

export type ToolResult = {
  content: Array<{
    type: "text";
    text: string;
    annotations?: { audience?: ("user" | "assistant")[]; priority?: number; lastModified?: string };
  }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export function jsonResponse(output: unknown): ToolResult {
  const structured = asJsonObject(output);
  return {
    content: [{ type: "text", text: JSON.stringify(output) } as const],
    structuredContent: Object.keys(structured).length > 0 ? structured : { value: output },
  };
}

export function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` } as const],
    structuredContent: { error: message },
    isError: true,
  };
}

/** Second argument to MCP tool handlers (auth from mcp-handler / Streamable HTTP). */
export type ToolExtra = { authInfo?: { extra?: Record<string, unknown> } };

/** Prefer AsyncLocalStorage (Express); else MCP auth from mcp-handler / Streamable HTTP. */
export function resolveUserId(argUserId?: string | null, extra?: ToolExtra): string {
  const arg = argUserId?.trim() ?? "";
  const ctxUserId = getRequestContext().userId?.trim() ?? "";
  const authRaw = extra?.authInfo?.extra?.userId;
  const authUserId = typeof authRaw === "string" ? authRaw.trim() : "";
  return arg || ctxUserId || authUserId;
}
