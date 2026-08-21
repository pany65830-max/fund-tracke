import { describe, it, expect } from "vitest";
import { displayEtfName } from "./etfNames";

describe("displayEtfName", () => {
  it("maps a code-like stored name to the whitelist short name", () => {
    expect(displayEtfName("510300", "510300")).toBe("沪深300ETF华泰柏瑞");
  });
});
