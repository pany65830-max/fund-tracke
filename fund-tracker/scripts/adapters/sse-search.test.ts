import { describe, it, expect } from "vitest";
import { createSseSearchAdapter } from "./sse-search.js";
import type { NewsItem } from "../../shared/schema.js";

function makeFetch(items: Array<{ title: string; createTime: string; documentId: string }>) {
  let page = 0;
  return async () => {
    page++;
    const batch = items.slice((page - 1) * 10, page * 10);
    return {
      ok: true,
      json: async () => ({
        code: "0",
        data: {
          totalSize: items.length,
          knowledgeList: batch,
        },
      }),
    } as unknown as Response;
  };
}

describe("sse-search adapter", () => {
  it("maps search results to NewsItem and filters by date", async () => {
    const items = [
      { title: "华泰ETF停牌公告", createTime: "2026-08-18 10:00:00", documentId: "D1" },
      { title: "华夏ETF上市", createTime: "2026-08-17 09:00:00", documentId: "D2" },
      { title: " old 公告", createTime: "2026-08-10 08:00:00", documentId: "D3" },
    ];
    const adapter = createSseSearchAdapter(makeFetch(items) as unknown as typeof fetch, {
      keywords: ["ETF"],
      pageSize: 10,
      maxPages: 1,
      maxAgeDays: 7,
    });
    const news = await adapter.fetchNews("2026-08-18");
    expect(news.length).toBe(2);
    expect(news[0].institution).toBe("sse");
    expect(news[0].source).toBe("exchange_web");
    expect(news[0].category).toBe("active_etf");
    expect(news[1].category).toBe("new_product");
    expect(news.every((n: NewsItem) => n.publishedAt.startsWith("2026-08-1"))).toBe(true);
  });

  it("dedupes by documentId across keywords", async () => {
    const items = [
      { title: "A", createTime: "2026-08-18 10:00:00", documentId: "D1" },
    ];
    // same fetch reused for both keywords, should dedupe
    const fetchFn = makeFetch(items) as unknown as typeof fetch;
    const adapter = createSseSearchAdapter(fetchFn, {
      keywords: ["ETF", "交易型开放式指数基金"],
      pageSize: 10,
      maxPages: 1,
      maxAgeDays: 7,
    });
    const news = await adapter.fetchNews("2026-08-18");
    expect(news.length).toBe(1);
  });

  it("builds sourceUrl to SSE site search", async () => {
    const items = [
      {
        title: "B",
        createTime: "2026-08-18 10:00:00",
        documentId: "D1",
      },
    ];
    const adapter = createSseSearchAdapter(makeFetch(items) as unknown as typeof fetch, {
      keywords: ["ETF"],
      pageSize: 10,
      maxPages: 1,
      maxAgeDays: 7,
    });
    const news = await adapter.fetchNews("2026-08-18");
    expect(news[0].sourceUrl).toBe("https://www.sse.com.cn/home/search?webswd=B");
  });
});
