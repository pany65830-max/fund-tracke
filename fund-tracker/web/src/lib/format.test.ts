import { describe, it, expect } from "vitest";
import { formatPct, pctClass } from "./format";

describe("formatPct", () => {
  it("formats with sign", () => {
    expect(formatPct(1.2)).toBe("+1.20%");
    expect(formatPct(-0.5)).toBe("-0.50%");
    expect(pctClass(1)).toBe("up");
    expect(pctClass(-1)).toBe("down");
  });
});
