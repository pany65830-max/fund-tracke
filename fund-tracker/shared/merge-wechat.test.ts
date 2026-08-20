import { describe, it, expect } from "vitest";
import { keepUncoveredNews, mergeWechatNews } from "./merge-wechat";
import type { NewsItem } from "./schema";

function n(partial: Partial<NewsItem> & Pick<NewsItem, "id" | "source">): NewsItem {
  return {
    title: partial.title ?? partial.id,
    summary: "",
    institution: "huaxia",
    category: "other",
    publishedAt: "2026-08-19T08:00:00+08:00",
    sourceUrl: "https://mp.weixin.qq.com/s/x",
    ...partial,
  };
}

describe("mergeWechatNews", () => {
  it("keeps previous wechat when new fetch is empty", () => {
    const prev = [n({ id: "wx-old", source: "wechat", title: "官方号旧文" })];
    const incoming = [n({ id: "cw-1", source: "company_web", title: "官网公告" })];
    const out = mergeWechatNews(incoming, prev, false);
    expect(out.map((x) => x.id).sort()).toEqual(["cw-1", "wx-old"]);
  });

  it("replaces wechat when new fetch has items", () => {
    const prev = [n({ id: "wx-old", source: "wechat" })];
    const incoming = [
      n({ id: "cw-1", source: "company_web" }),
      n({ id: "wx-new", source: "wechat", title: "新推文" }),
    ];
    const out = mergeWechatNews(incoming, prev, true);
    expect(out.find((x) => x.source === "wechat")?.id).toBe("wx-new");
    expect(out).toHaveLength(2);
  });
});

describe("keepUncoveredNews", () => {
  it("keeps previous institutions that the new fetch missed", () => {
    const prev = [
      n({ id: "cw-hx", source: "company_web", institution: "huaxia", title: "华夏旧" }),
      n({ id: "cw-ht", source: "company_web", institution: "huatai", title: "华泰旧" }),
    ];
    const incoming = [
      n({ id: "cw-ef", source: "company_web", institution: "efunds", title: "易方达新" }),
    ];
    const out = keepUncoveredNews(incoming, prev);
    expect(out.map((x) => x.id).sort()).toEqual(["cw-ef", "cw-ht", "cw-hx"]);
  });

  it("replaces an institution when the new fetch has that institution", () => {
    const prev = [
      n({ id: "cw-ef-old", source: "company_web", institution: "efunds", title: "易方达旧" }),
    ];
    const incoming = [
      n({ id: "cw-ef-new", source: "company_web", institution: "efunds", title: "易方达新" }),
    ];
    const out = keepUncoveredNews(incoming, prev);
    expect(out.map((x) => x.id)).toEqual(["cw-ef-new"]);
  });
});
