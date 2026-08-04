import { describe, it, expect } from "vitest";
import { createExchangeWebAdapter, parseAnchorLinks } from "./exchange-web";

describe("exchange-web", () => {
  it("parses anchors from html", () => {
    const html = `<html><a href="/a/1">上交所重要通知一则</a><a href="https://www.sse.com.cn/b">另一则公告标题够长</a></html>`;
    const items = parseAnchorLinks(html, "https://www.sse.com.cn/", "sse", "2026-08-03");
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].source).toBe("exchange_web");
    expect(items[0].institution).toBe("sse");
    expect(items[0].sourceUrl.startsWith("http")).toBe(true);
  });

  it("fetch adapter uses mock fetch", async () => {
    const html = `<a href="/n/1">深交所示例资讯标题</a>`;
    const mockFetch: typeof fetch = async () =>
      new Response(html, { status: 200 });
    const adapter = createExchangeWebAdapter(mockFetch);
    const items = await adapter.fetchNews("2026-08-03");
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
