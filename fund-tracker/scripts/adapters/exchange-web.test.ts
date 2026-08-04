import { describe, it, expect } from "vitest";
import {
  createExchangeWebAdapter,
  isLikelyNewsLink,
  parseAnchorLinks,
} from "./exchange-web";

describe("exchange-web", () => {
  it("parses announcement-like anchors", () => {
    const html = `<html>
      <a href="/home/app">APP下载</a>
      <a href="/disclosure/announcement/1">关于调整交易规则的重要通知公告</a>
      <a href="https://www.sse.com.cn/news/bulletin/123">上交所发布市场监管动态资讯</a>
    </html>`;
    const items = parseAnchorLinks(
      html,
      "https://www.sse.com.cn/",
      "sse",
      "2026-08-03",
    );
    expect(items.length).toBe(2);
    expect(items[0].source).toBe("exchange_web");
    expect(items.every((i) => !i.title.includes("APP"))).toBe(true);
  });

  it("rejects nav junk", () => {
    expect(isLikelyNewsLink("APP下载", "https://www.sse.com.cn/home/app/")).toBe(
      false,
    );
    expect(
      isLikelyNewsLink("English", "http://english.sse.com.cn/"),
    ).toBe(false);
  });

  it("fetch adapter uses mock fetch", async () => {
    const html = `<a href="/disclosure/n/1">深交所发布监管处罚决定书公告示例</a>`;
    const mockFetch: typeof fetch = async () =>
      new Response(html, { status: 200 });
    const adapter = createExchangeWebAdapter(mockFetch);
    const items = await adapter.fetchNews("2026-08-03");
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
