import { describe, it, expect } from "vitest";
import { filterNews } from "./newsFilters";
import type { NewsItem } from "./schema";

const sample: NewsItem[] = [
  {
    id: "1",
    title: "a",
    summary: "",
    institution: "huatai",
    category: "research",
    source: "ifind",
    publishedAt: "2026-08-13T08:00:00+08:00",
    sourceUrl: "https://example.com/1",
  },
  {
    id: "2",
    title: "b",
    summary: "",
    institution: "sse",
    category: "exchange",
    source: "exchange_web",
    publishedAt: "2026-08-13T08:00:00+08:00",
    sourceUrl: "https://example.com/2",
  },
];

describe("filterNews", () => {
  it("filters by institution and category", () => {
    expect(
      filterNews(sample, { institution: "huatai", category: "all" }),
    ).toHaveLength(1);
    expect(
      filterNews(sample, { institution: "all", category: "exchange" }),
    ).toHaveLength(1);
  });

  it("filters by tradeDate using Beijing time", () => {
    const items: NewsItem[] = [
      { ...sample[0], id: "a", title: "x", publishedAt: "2026-08-13T08:00:00+08:00" },
      // 20:00 UTC = 次日 04:00 北京时间，应归入 08-13
      { ...sample[0], id: "b", title: "y", publishedAt: "2026-08-12T20:00:00.000Z" },
      { ...sample[0], id: "c", title: "z", publishedAt: "2026-08-12T08:00:00+08:00" },
    ];
    const res = filterNews(items, {
      institution: "all",
      category: "all",
      tradeDate: "2026-08-13",
    });
    expect(res.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("dedupes same institution + title and sorts newest first", () => {
    const items: NewsItem[] = [
      { ...sample[0], id: "d1", title: "重复标题", publishedAt: "2026-08-13T09:00:00+08:00" },
      { ...sample[0], id: "d2", title: "重复标题", publishedAt: "2026-08-13T08:00:00+08:00" },
      { ...sample[0], id: "old", title: "较早", publishedAt: "2026-08-13T07:00:00+08:00" },
      { ...sample[0], id: "new", title: "较新", publishedAt: "2026-08-13T10:00:00+08:00" },
    ];
    const res = filterNews(items, {
      institution: "all",
      category: "all",
      tradeDate: "2026-08-13",
    });
    // 重复标题只留 1 条；按时间倒序：较新(10:00) > 重复(08:00) > 较早(07:00)
    expect(res.map((n) => n.id)).toEqual(["new", "d2", "old"]);
  });
});
