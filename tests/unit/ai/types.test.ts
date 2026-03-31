import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "../../../src/lib/ai/types";

describe("estimateCostUsd", () => {
  it("returns correct cost for gpt-4o with known usage", () => {
    // 1M input @ $2.50 + 500k output @ $10 = $2.50 + $5.00 = $7.50
    const cost = estimateCostUsd("gpt-4o", 1_000_000, 500_000);
    expect(cost).toBeCloseTo(7.5, 6);
  });

  it("returns correct cost for gpt-4o-mini", () => {
    // 100k input @ $0.15/M + 50k output @ $0.60/M
    const cost = estimateCostUsd("gpt-4o-mini", 100_000, 50_000);
    expect(cost).toBeCloseTo(0.015 + 0.03, 6);
  });

  it("returns correct cost for claude-sonnet-4-20250514", () => {
    const cost = estimateCostUsd("claude-sonnet-4-20250514", 200_000, 100_000);
    expect(cost).toBeCloseTo((200_000 / 1_000_000) * 3 + (100_000 / 1_000_000) * 15, 8);
  });

  it("returns correct cost for gemini-2.0-flash", () => {
    const cost = estimateCostUsd("gemini-2.0-flash", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.1 + 0.4, 6);
  });

  it("returns correct cost for gemini-2.5-pro-preview-05-06", () => {
    const cost = estimateCostUsd("gemini-2.5-pro-preview-05-06", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.25 + 10, 6);
  });

  it("returns correct cost for gpt-4.1-nano", () => {
    const cost = estimateCostUsd("gpt-4.1-nano", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.1 + 0.4, 6);
  });

  it("returns undefined for an unknown model", () => {
    const cost = estimateCostUsd("unknown-model-xyz", 100_000, 50_000);
    expect(cost).toBeUndefined();
  });

  it("returns 0 when both token counts are 0", () => {
    const cost = estimateCostUsd("gpt-4o", 0, 0);
    expect(cost).toBe(0);
  });

  it("handles only prompt tokens (zero completion)", () => {
    const cost = estimateCostUsd("gpt-4o", 1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 6);
  });

  it("handles only completion tokens (zero prompt)", () => {
    const cost = estimateCostUsd("gpt-4o", 0, 1_000_000);
    expect(cost).toBeCloseTo(10, 6);
  });

  it("scales proportionally for small token counts", () => {
    const cost1 = estimateCostUsd("gpt-4o", 1000, 500);
    const cost2 = estimateCostUsd("gpt-4o", 2000, 1000);
    expect(cost2).toBeCloseTo(cost1! * 2, 10);
  });
});
