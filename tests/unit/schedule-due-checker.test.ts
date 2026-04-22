import { describe, expect, it } from "vitest";
import { isScheduleDue } from "../../src/application/scheduling/schedule-due-checker";

describe("isScheduleDue", () => {
  it("returns true when the next cron tick is inside the window", () => {
    const lastCheckedAt = new Date("2026-04-23T04:59:00.000Z");
    const now = new Date("2026-04-23T05:01:00.000Z");

    expect(isScheduleDue("30 10 * * *", lastCheckedAt, now, "Asia/Kolkata")).toBe(true);
  });

  it("returns false when the next cron tick is still in the future", () => {
    const lastCheckedAt = new Date("2026-04-23T04:00:00.000Z");
    const now = new Date("2026-04-23T04:15:00.000Z");

    expect(isScheduleDue("0 10 * * *", lastCheckedAt, now, "Asia/Kolkata")).toBe(false);
  });

  it("returns false for invalid cron expressions", () => {
    expect(isScheduleDue("invalid cron", new Date(), new Date(), "Asia/Kolkata")).toBe(false);
  });
});
