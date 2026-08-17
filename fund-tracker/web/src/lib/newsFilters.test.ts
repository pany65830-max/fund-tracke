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
    publishedAt: "t",
    sourceUrl: "https://example.com/1",
  },
  {
    id: "2",
    title: "b",
    summary: "",
    institution: "sse",
    category: "exchange",
    source: "exchange_web",
    publishedAt: "t",
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
      { ...sample[0], id: "a", publishedAt: "2026-08-13T08:00:00+08:00" },
      // 20:00 UTC = 次日 04:00 北京时间，应归入 08-13
      { ...sample[0], id: "b", publishedAt: "2026-08-12T20:00:00.000Z" },
      { ...sample[0], id: "c", publishedAt: "2026-08-12T08:00:00+08:00" },
    ];
    const res = filterNews(items, {
      institution: "all",
      category: "all",
      tradeDate: "2026-08-13",
    });
    expect(res.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});
