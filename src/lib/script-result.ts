/**
 * Detect business-level failure objects returned from workflow scripts
 * (scripts that catch errors and return { status: "error" } instead of throwing).
 */
export function getScriptFailureMessage(output: unknown): string | null {
  if (output === null || output === undefined) {
    return null;
  }
  if (typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const o = output as Record<string, unknown>;

  if (o.status === "error") {
    if (typeof o.error === "string" && o.error.trim()) {
      return o.error;
    }
    if (o.message != null && String(o.message).trim()) {
      return String(o.message);
    }
    return "Script returned status error";
  }

  if (o.success === false) {
    if (typeof o.message === "string" && o.message.trim()) {
      return o.message;
    }
    if (typeof o.error === "string" && o.error.trim()) {
      return o.error;
    }
    return "Script returned success: false";
  }

  if (o.failed === true) {
    if (typeof o.message === "string" && o.message.trim()) {
      return o.message;
    }
    return "Script returned failed: true";
  }

  return null;
}
