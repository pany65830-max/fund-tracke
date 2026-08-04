import { describe, it, expect } from "vitest";
import { mapIfindNewsRow } from "./ifind-news";
import { mapIfindEtfPayload, loadWhitelist } from "./ifind-etf";

describe("ifind mappers", () => {
  it("mapIfindNewsRow reads Chinese keys", () => {
    const item = mapIfindNewsRow(
      {
        标题: "华泰柏瑞市场策略会",
        摘要: "摘要",
        正文: "正文全文",
        链接: "https://example.com/n",
        机构: "华泰柏瑞",
      },
      "2026-08-03",
      0,
    );
    expect(item.source).toBe("ifind");
    expect(item.institution).toBe("huatai");
    expect(item.category).toBe("research");
    expect(item.body).toBe("正文全文");
  });

  it("mapIfindEtfPayload filters whitelist", () => {
    const wl = loadWhitelist();
    const dash = mapIfindEtfPayload(
      {
        indices: [{ code: "000300", name: "沪深300", last: 1, changePct: 0.1 }],
        sectors: [{ name: "半导体", changePct: 1 }],
        products: [
          { code: "512760", name: "芯片ETF", changePct: 2, amount: 1 },
          { code: "999999", name: "非白名单", changePct: 9 },
        ],
        hotInflow: [{ code: "512760", name: "芯片ETF", value: 1 }],
        hotGainers: [],
        hotTurnover: [],
      },
      wl,
    );
    expect(dash.productsByFirm.huatai.some((p) => p.code === "512760")).toBe(true);
    expect(
      Object.values(dash.productsByFirm)
        .flat()
        .some((p) => p.code === "999999"),
    ).toBe(false);
  });
});
