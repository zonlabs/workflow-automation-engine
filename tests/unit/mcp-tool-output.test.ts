import { describe, expect, it } from "vitest";
import { unwrapMcpToolCallResult } from "../../src/lib/mcp-tool-output";

describe("unwrapMcpToolCallResult", () => {
  it("returns raw when not MCP shape", () => {
    expect(unwrapMcpToolCallResult({ foo: 1 })).toEqual({ foo: 1 });
    expect(unwrapMcpToolCallResult(null)).toBe(null);
  });

  it("parses JSON object from first text content block", () => {
    const raw = {
      content: [{ type: "text", text: '{"results":[{"id":1}]}' }],
    };
    expect(unwrapMcpToolCallResult(raw)).toEqual({ results: [{ id: 1 }] });
  });

  it("parses JSON array from first text content block", () => {
    const raw = {
      content: [{ type: "text", text: '[{"a":1}]' }],
    };
    expect(unwrapMcpToolCallResult(raw)).toEqual([{ a: 1 }]);
  });

  it("skips non-JSON text and uses next block", () => {
    const raw = {
      content: [
        { type: "text", text: "not json" },
        { type: "text", text: '{"ok":true}' },
      ],
    };
    expect(unwrapMcpToolCallResult(raw)).toEqual({ ok: true });
  });
});
