import { describe, it, expect } from "vitest";
import { mapIfindNewsRow } from "./ifind-news";
import { mapIfindEtfPayload, loadWhitelist } from "./ifind-etf";
import { toThsCode, bareCode, flattenTables } from "./ifind-client";

describe("ifind helpers", () => {
  it("toThsCode", () => {
    expect(toThsCode("510050")).toBe("510050.SH");
    expect(toThsCode("159915")).toBe("159915.SZ");
  });

  it("flattenTables expands column arrays", () => {
    const rows = flattenTables([
      { thscode: "510050.SH", latest: [1.2], changeRatio: [0.01] },
    ]);
    expect(rows[0].latest).toBe(1.2);
    expect(bareCode(String(rows[0].thscode))).toBe("510050");
  });
});

describe("ifind mappers", () => {
  it("mapIfindNewsRow reads Chinese keys", () => {
    const item = mapIfindNewsRow(
      {
        标题: "华泰柏瑞市场策略会",
        摘要: "摘要",
        正文: "正文全文",
        链接: "https://example.com/n",
        机构: "512760.SH",
      },
      "2026-08-03",
      0,
    );
    expect(item.source).toBe("ifind");
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
      },
      wl,
    );
    expect(dash.productsByFirm.huatai.some((p) => p.code === "512760")).toBe(
      true,
    );
  });
});
