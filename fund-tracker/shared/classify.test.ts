import { describe, it, expect } from "vitest";
import { classifyNews } from "./classify";

describe("classifyNews", () => {
  it("maps disclosure keywords", () => {
    expect(
      classifyNews({ title: "某某基金招募说明书", institution: "huatai" }),
    ).toBe("disclosure");
  });

  it("maps active etf", () => {
    expect(
      classifyNews({ title: "主动ETF业务指引解读", institution: "huaxia" }),
    ).toBe("active_etf");
  });

  it("maps new product", () => {
    expect(
      classifyNews({ title: "新产品发行安排公告", institution: "efunds" }),
    ).toBe("new_product");
  });

  it("maps research", () => {
    expect(
      classifyNews({ title: "市场策略会纪要", institution: "guotai" }),
    ).toBe("research");
  });

  it("maps exchange institutions", () => {
    expect(classifyNews({ title: "任意标题", institution: "sse" })).toBe(
      "exchange",
    );
    expect(classifyNews({ title: "任意标题", institution: "szse" })).toBe(
      "exchange",
    );
  });

  it("falls back to other", () => {
    expect(
      classifyNews({ title: "你好世界", institution: "huatai" }),
    ).toBe("other");
  });
});
