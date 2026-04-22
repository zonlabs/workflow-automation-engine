import { generateText } from "ai";
import { resolveModel } from "../../lib/ai/provider-registry";
import { extractMcpToolErrorMessage, unwrapMcpToolCallResult } from "../../lib/mcp-tool-output";
import { callToolAcrossSessions } from "../../../script-runner/mcp-tool-router";

export type ScriptHelperToolRequest = {
  tool_slug?: string;
  arguments?: Record<string, unknown>;
  context?: Record<string, unknown>;
  server_name?: string;
};

export class ScriptHelperService {
  async handleToolCall(payload: ScriptHelperToolRequest) {
    const toolSlug = String(payload?.tool_slug ?? "");
    if (!toolSlug) {
      throw new Error("tool_slug is required");
    }

    const context = (payload?.context ?? {}) as Record<string, unknown>;
    const userId = String(context.user_id ?? "");
    if (!userId) {
      throw new Error("context.user_id is required");
    }

    const contextSessionId =
      context.session_id != null && String(context.session_id).trim()
        ? String(context.session_id).trim()
        : undefined;
    const serverNameHint =
      payload?.server_name != null && String(payload.server_name).trim()
        ? String(payload.server_name).trim()
        : undefined;

    const { raw, meta } = await callToolAcrossSessions(
      userId,
      toolSlug,
      (payload?.arguments ?? {}) as Record<string, unknown>,
      contextSessionId,
      serverNameHint
    );

    const toolErrorMessage = extractMcpToolErrorMessage(raw);
    if (toolErrorMessage) {
      throw new Error(`Tool "${toolSlug}" failed: ${toolErrorMessage}`);
    }

    return {
      output: unwrapMcpToolCallResult(raw),
      meta,
    };
  }

  async handleLlmCall(payload: { prompt?: string; model?: string }) {
    const prompt = String(payload?.prompt ?? "");
    if (!prompt) {
      throw new Error("prompt is required");
    }

    const { model } = resolveModel(String(payload?.model ?? ""));
    const result = await generateText({
      model,
      prompt,
      maxRetries: 2,
    });

    return result.text;
  }
}
