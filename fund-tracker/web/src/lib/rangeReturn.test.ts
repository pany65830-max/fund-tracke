import { describe, it, expect } from "vitest";
import { rangeReturnPct } from "./rangeReturn";

describe("rangeReturnPct", () => {
  it("uses daily change on same day", () => {
    expect(
      rangeReturnPct(
        { code: "1", name: "a", firm: "huatai", nav: 1, changePct: 1.2 },
        { code: "1", name: "a", firm: "huatai", nav: 1.012, changePct: 1.2 },
        true,
      ),
    ).toBe(1.2);
  });

  it("computes nav range", () => {
    const r = rangeReturnPct(
      { code: "1", name: "a", firm: "huatai", nav: 1.0, changePct: 0 },
      { code: "1", name: "a", firm: "huatai", nav: 1.05, changePct: 1 },
      false,
    );
    expect(r).toBeCloseTo(5, 5);
  });
});
