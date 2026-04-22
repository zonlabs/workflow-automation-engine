import { normalizeWorkflowError } from "../../domain/workflow-errors";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isTransientError(err: unknown): boolean {
  const normalized = normalizeWorkflowError(err);
  const haystack = `${normalized.code ?? ""} ${normalized.message}`.toLowerCase();
  const transientMarkers = [
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "enotfound",
    "eai_again",
    "429",
    "rate limit",
    "temporarily unavailable",
    "network",
    "socket hang up",
    "service unavailable",
  ];

  return transientMarkers.some((marker) => haystack.includes(marker));
}

export function isAuthError(err: unknown): boolean {
  const normalized = normalizeWorkflowError(err);
  const haystack = `${normalized.code ?? ""} ${normalized.message}`.toLowerCase();
  const authMarkers = ["unauthorized", "forbidden", "401", "403", "token", "expired", "oauth"];
  return authMarkers.some((marker) => haystack.includes(marker));
}

export function getRetryDelayMs(attempt: number): number {
  const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
  const jitter = Math.floor(Math.random() * 300);
  return backoff + jitter;
}
