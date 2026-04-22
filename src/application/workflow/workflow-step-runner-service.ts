import type { MCPClient } from "@mcp-ts/sdk/server";
import { extractMcpToolErrorMessage } from "../../lib/mcp-tool-output";
import type {
  WorkflowStepRow,
  WorkflowStepResult,
} from "../../domain/workflow";
import { createPermanentWorkflowError, normalizeWorkflowError } from "../../domain/workflow-errors";
import { delay, getRetryDelayMs, isAuthError, isTransientError } from "./retry-policy";
import { executeWorkflowAiStep } from "./workflow-ai-step-service";

async function persistRefreshedSessionIfPossible(identity: string, sessionId: string, client: MCPClient) {
  const anyStorage = (await import("@mcp-ts/sdk/server")).storage as unknown as {
    updateSession?: (...args: unknown[]) => Promise<unknown>;
    updateSessionData?: (...args: unknown[]) => Promise<unknown>;
  };
  const anyClient = client as unknown as {
    getSession?: () => unknown;
    getSessionData?: () => unknown;
  };

  const sessionData = anyClient.getSessionData?.() ?? anyClient.getSession?.();
  if (!sessionData) {
    return;
  }

  try {
    if (typeof anyStorage.updateSession === "function") {
      await anyStorage.updateSession(identity, sessionId, sessionData);
      return;
    }
    if (typeof anyStorage.updateSessionData === "function") {
      await anyStorage.updateSessionData(identity, sessionId, sessionData);
    }
  } catch {
    // Keep session persistence best-effort.
  }
}

async function callMcpTool(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const anyClient = client as unknown as {
    callTool?: (...params: unknown[]) => Promise<unknown>;
    executeTool?: (...params: unknown[]) => Promise<unknown>;
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
      id: `workflow-${Date.now()}`,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    });
  }

  throw createPermanentWorkflowError(
    "MCP client does not expose a supported tool execution method",
    "UNSUPPORTED_MCP_CLIENT"
  );
}

export async function executeWorkflowMcpStep(
  client: MCPClient,
  step: WorkflowStepRow,
  resolvedArgs: Record<string, unknown>,
  identity: string,
  sessionId: string
): Promise<unknown> {
  const maxRetries = Math.max(0, step.max_retries ?? 0);
  const allowRetries = step.retry_on_failure ?? true;
  const maxAttempts = allowRetries ? maxRetries + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await callMcpTool(client, step.tool_slug, resolvedArgs);
      const toolErrorMessage = extractMcpToolErrorMessage(result);
      if (toolErrorMessage) {
        throw createPermanentWorkflowError(
          `Step ${step.step_number} (${step.tool_slug}) returned MCP error: ${toolErrorMessage}`,
          "MCP_TOOL_CALL_ERROR"
        );
      }
      await persistRefreshedSessionIfPossible(identity, sessionId, client);
      return result;
    } catch (error) {
      const finalAttempt = attempt >= maxAttempts;
      const authFailure = isAuthError(error);
      const transientFailure = isTransientError(error);

      if (!finalAttempt && authFailure) {
        await client.disconnect(`auth-reconnect-step-${step.step_number}`);
        await client.connect();
      }

      if (!finalAttempt && (authFailure || transientFailure)) {
        await delay(getRetryDelayMs(attempt));
        continue;
      }

      if (transientFailure) {
        throw error;
      }

      throw createPermanentWorkflowError(
        `Step ${step.step_number} (${step.tool_slug}) failed permanently: ${normalizeWorkflowError(error).message}`,
        "STEP_EXECUTION_FAILED",
        error
      );
    }
  }

  throw new Error("Unreachable step retry branch");
}

export function buildStepResult(input: {
  step: WorkflowStepRow;
  output: unknown;
  startedAt: number;
}): WorkflowStepResult {
  return {
    stepId: input.step.id,
    stepNumber: input.step.step_number,
    stepName: input.step.name,
    toolSlug: input.step.tool_slug,
    output: input.output,
    durationMs: Date.now() - input.startedAt,
  };
}

export { executeWorkflowAiStep };
