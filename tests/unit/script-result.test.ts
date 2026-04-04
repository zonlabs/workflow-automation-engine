import { describe, expect, it } from "vitest";
import { getScriptFailureMessage } from "../../src/lib/script-result";

describe("getScriptFailureMessage", () => {
  it("returns null for success-like payloads", () => {
    expect(getScriptFailureMessage(null)).toBeNull();
    expect(getScriptFailureMessage({ status: "ok" })).toBeNull();
    expect(getScriptFailureMessage({ success: true })).toBeNull();
  });

  it("detects status error", () => {
    expect(getScriptFailureMessage({ status: "error", error: "boom" })).toBe("boom");
    expect(getScriptFailureMessage({ status: "error", message: "nope" })).toBe("nope");
  });

  it("detects success false", () => {
    expect(getScriptFailureMessage({ success: false, message: "bad" })).toBe("bad");
    expect(getScriptFailureMessage({ success: false, error: "e" })).toBe("e");
  });
});
