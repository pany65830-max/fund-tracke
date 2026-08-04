import { describe, it, expect } from "vitest";
import { isTradingDay, previousTradingDay } from "./calendar";

describe("calendar", () => {
  const holidays = new Set(["2026-08-03"]); // Monday holiday for test

  it("marks Saturday as non-trading", () => {
    expect(isTradingDay("2026-08-01", new Set())).toBe(false);
  });

  it("marks holiday Monday as non-trading", () => {
    expect(isTradingDay("2026-08-03", holidays)).toBe(false);
  });

  it("finds previous trading day across weekend", () => {
    expect(previousTradingDay("2026-08-03", new Set())).toBe("2026-07-31");
  });
});
