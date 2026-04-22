/**
 * MCP tools/call returns CallToolResult: { content: [{ type: 'text', text: '...' }], ... }.
 * Zapier and others often put JSON (object or array) in the first text block — unwrap for scripts.
 */
export function unwrapMcpToolCallResult(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const content = obj.content;
  if (!Array.isArray(content)) return raw;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type !== "text" || typeof b.text !== "string") continue;
    const t = b.text.trim();
    if (!t) continue;
    const c0 = t[0];
    if (c0 !== "{" && c0 !== "[") continue;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      continue;
    }
  }
  return raw;
}

export function extractMcpToolErrorMessage(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const candidate = result as {
    isError?: boolean;
    content?: Array<{ text?: unknown; type?: string }>;
  };

  const firstText = Array.isArray(candidate.content)
    ? (candidate.content.find((contentBlock) => typeof contentBlock.text === "string")?.text as string | undefined)?.trim()
    : undefined;

  if (candidate.isError === true) {
    return firstText || "MCP tool call returned error response";
  }

  if (!firstText) {
    return null;
  }

  const normalizedText = firstText.toLowerCase();
  const errorPatterns = [
    "error:",
    "mcp error",
    "not accessible",
    "permission denied",
    "forbidden",
    "unauthorized",
    "not found",
    "rate limit",
    "bad credentials",
  ];

  if (errorPatterns.some((pattern) => normalizedText.startsWith(pattern) || normalizedText.includes(pattern))) {
    return firstText;
  }

  return null;
}
