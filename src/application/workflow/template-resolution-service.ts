import { createPermanentWorkflowError } from "../../domain/workflow-errors";
import type {
  WorkflowExecutionContext,
  WorkflowStepResult,
} from "../../domain/workflow";

function parsePath(target: unknown, dottedPath: string): unknown {
  const segments = dottedPath.split(".").filter(Boolean);
  let current: unknown = target;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function resolveExpression(
  rawExpression: string,
  params: WorkflowExecutionContext["params"],
  stepOutputs: Record<number, WorkflowStepResult>
): unknown {
  const expression = rawExpression.trim();

  if (expression.startsWith("params.")) {
    return parsePath(params, expression.slice("params.".length));
  }

  const stepMatch = expression.match(/^steps\.(\d+)\.(.+)$/);
  if (stepMatch) {
    const stepIdx = Number(stepMatch[1]);
    const path = stepMatch[2];
    const stepResult = stepOutputs[stepIdx] ?? stepOutputs[stepIdx + 1];
    if (!stepResult) {
      return undefined;
    }

    let value = parsePath(stepResult, path);
    if (value !== undefined) return value;

    if (path.startsWith("output.content.")) {
      const altPath = path.replace("output.content.", "output.parsed_output.");
      value = parsePath(stepResult, altPath);
      if (value !== undefined) return value;
    }

    if (path.startsWith("output.") && !path.startsWith("output.parsed_output.")) {
      const segments = path.split(".");
      if (
        segments.length >= 2 &&
        segments[1] !== "content" &&
        segments[1] !== "tool_call_log" &&
        segments[1] !== "reasoning_trace" &&
        segments[1] !== "ai_usage"
      ) {
        const altPath = "output.parsed_output." + segments.slice(1).join(".");
        value = parsePath(stepResult, altPath);
        if (value !== undefined) return value;
      }
    }
  }

  return undefined;
}

export function resolveTemplateString(
  template: string,
  params: WorkflowExecutionContext["params"],
  stepOutputs: Record<number, WorkflowStepResult>
): unknown {
  const exactMatch = template.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (exactMatch) {
    const value = resolveExpression(exactMatch[1], params, stepOutputs);
    if (value === undefined) {
      throw createPermanentWorkflowError(
        `Template variable "${exactMatch[1]}" could not be resolved`,
        "TEMPLATE_RESOLUTION_FAILED"
      );
    }
    return value;
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression: string) => {
    const value = resolveExpression(expression, params, stepOutputs);
    if (value === undefined) {
      throw createPermanentWorkflowError(
        `Template variable "${expression}" could not be resolved`,
        "TEMPLATE_RESOLUTION_FAILED"
      );
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

export function resolveVariables(
  value: unknown,
  params: WorkflowExecutionContext["params"],
  stepOutputs: Record<number, WorkflowStepResult>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveVariables(item, params, stepOutputs));
  }

  if (value && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolveVariables(nestedValue, params, stepOutputs);
    }
    return resolved;
  }

  if (typeof value === "string") {
    return resolveTemplateString(value, params, stepOutputs);
  }

  return value;
}
