import { describe, it, expect } from "vitest";
import { dedupeNews } from "./dedupe";
import type { NewsItem } from "./schema";

function item(partial: Partial<NewsItem> & Pick<NewsItem, "id" | "title" | "source">): NewsItem {
  return {
    summary: "",
    institution: "huatai",
    category: "other",
    publishedAt: "2026-08-03T07:00:00+08:00",
    sourceUrl: "https://example.com/x",
    ...partial,
  };
}

describe("dedupeNews", () => {
  it("keeps ifind body version over wechat", () => {
    const result = dedupeNews([
      item({
        id: "w",
        title: "同一标题",
        source: "wechat",
      }),
      item({
        id: "i",
        title: "同一 标题",
        source: "ifind",
        body: "全文内容",
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("i");
    expect(result[0].body).toBe("全文内容");
  });
});
