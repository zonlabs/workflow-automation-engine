import type { MCPClient } from "@mcp-ts/sdk/server";
import type { AIToolDefinition } from "./types";

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * List MCP tools from the connected session and convert them to AI-provider-neutral
 * tool definitions that can be passed to any provider's chatWithTools method.
 */
export async function listMcpToolsAsAITools(
  client: MCPClient,
  filter?: string[]
): Promise<AIToolDefinition[]> {
  const rawTools = await listRawMcpTools(client);

  const filtered =
    !filter || filter.includes("*")
      ? rawTools
      : rawTools.filter((t) => filter.includes(t.name));

  return filtered.map((t) => ({
    name: t.name,
    description: t.description ?? `MCP tool: ${t.name}`,
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

/**
 * Call an MCP tool and format the result as a string for AI conversation context.
 */
export async function callMcpToolFromAI(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ result: string; is_error: boolean }> {
  try {
    const output = await callTool(client, toolName, args);

    const errorMessage = extractMcpError(output);
    if (errorMessage) {
      return { result: errorMessage, is_error: true };
    }

    if (typeof output === "string") {
      return { result: output, is_error: false };
    }

    return { result: JSON.stringify(output, null, 2), is_error: false };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown MCP tool error";
    return { result: `Error calling ${toolName}: ${message}`, is_error: true };
  }
}

async function listRawMcpTools(client: MCPClient): Promise<McpToolInfo[]> {
  const anyClient = client as unknown as {
    listTools?: () => Promise<{ tools: McpToolInfo[] }>;
    getTools?: () => Promise<McpToolInfo[]>;
    request?: (payload: unknown) => Promise<{ result?: { tools?: McpToolInfo[] } }>;
  };

  if (typeof anyClient.listTools === "function") {
    const resp = await anyClient.listTools();
    return resp.tools ?? [];
  }

  if (typeof anyClient.getTools === "function") {
    return anyClient.getTools();
  }

  if (typeof anyClient.request === "function") {
    const resp = await anyClient.request({
      jsonrpc: "2.0",
      id: `list-tools-${Date.now()}`,
      method: "tools/list",
      params: {},
    });
    return resp?.result?.tools ?? [];
  }

  console.warn(
    "[tool-adapter] MCPClient does not expose a tool listing method; AI agent will have no tools."
  );
  return [];
}

async function callTool(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const anyClient = client as unknown as {
    callTool?: (...p: unknown[]) => Promise<unknown>;
    executeTool?: (...p: unknown[]) => Promise<unknown>;
    request?: (payload: unknown) => Promise<unknown>;
  };

  if (typeof anyClient.callTool === "function") {
    return anyClient.callTool(toolName, args);
  }
  if (typeof anyClient.executeTool === "function") {
    return anyClient.executeTool(toolName, args);
  }
  if (typeof anyClient.request === "function") {
    return anyClient.request({
      jsonrpc: "2.0",
      id: `ai-tool-${Date.now()}`,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    });
  }

  throw new Error(
    `MCPClient does not expose a supported tool execution method`
  );
}

function extractMcpError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const candidate = result as {
    isError?: boolean;
    content?: Array<{ text?: unknown }>;
  };
  if (candidate.isError !== true) return null;
  const first = Array.isArray(candidate.content) ? candidate.content[0] : undefined;
  if (first && typeof first.text === "string" && first.text.trim().length > 0) {
    return first.text;
  }
  return "MCP tool returned an error response";
}
