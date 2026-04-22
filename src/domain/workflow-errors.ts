import type { WorkflowExecutionErrorShape } from "./workflow";

export class WorkflowExecutionError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: string;
      retryable?: boolean;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
    this.code = options.code ?? "WORKFLOW_EXECUTION_ERROR";
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function createPermanentWorkflowError(
  message: string,
  code = "NON_RETRYABLE_WORKFLOW_ERROR",
  cause?: unknown
): WorkflowExecutionError {
  return new WorkflowExecutionError(message, {
    code,
    retryable: false,
    cause,
  });
}

export function normalizeWorkflowError(err: unknown): WorkflowExecutionErrorShape {
  if (err instanceof WorkflowExecutionError) {
    return { message: err.message, code: err.code, stack: err.stack };
  }

  if (err instanceof Error) {
    const withCode = err as Error & { code?: string };
    return { message: err.message, code: withCode.code, stack: err.stack };
  }

  return { message: "Unknown execution error", code: "UNKNOWN_ERROR" };
}
