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
