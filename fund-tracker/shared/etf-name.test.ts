import { describe, it, expect } from "vitest";
import { isCodeLikeName, pickEtfDisplayName } from "./etf-name";

describe("pickEtfDisplayName", () => {
  it("rejects numeric shortName from iFinD", () => {
    expect(isCodeLikeName("510300", "510300")).toBe(true);
    expect(isCodeLikeName("510300.SH", "510300")).toBe(true);
    expect(isCodeLikeName("沪深300ETF华泰柏瑞", "510300")).toBe(false);
  });

  it("prefers whitelist when API name is a code", () => {
    expect(pickEtfDisplayName("510300", "510300", "沪深300ETF华泰柏瑞")).toBe(
      "沪深300ETF华泰柏瑞",
    );
    expect(pickEtfDisplayName("510300", "沪深300ETF", "沪深300ETF华泰柏瑞")).toBe(
      "沪深300ETF",
    );
  });
});
