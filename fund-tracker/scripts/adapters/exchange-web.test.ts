import { describe, it, expect } from "vitest";
import {
  createExchangeWebAdapter,
  exchangeOf,
  mapCninfoAnnouncement,
} from "./exchange-web";

describe("exchange-web (cninfo)", () => {
  it("maps a cninfo ETF announcement to a NewsItem", () => {
    const item = mapCninfoAnnouncement({
      secCode: "159608",
      secName: "稀有金属ETF广发",
      announcementTitle: "稀有金属<em>ETF</em>广发：关于流动性服务商终止的公告",
      announcementTime: 1786896000000,
      adjunctUrl: "finalpage/2026-08-17/1225474019.PDF",
      announcementId: "1225474019",
    });
    expect(item.source).toBe("exchange_web");
    expect(item.institution).toBe("szse");
    expect(item.title).not.toContain("<em>");
    expect(item.sourceUrl).toBe(
      "https://static.cninfo.com.cn/finalpage/2026-08-17/1225474019.PDF",
    );
    expect(item.publishedAt.startsWith("2026-08-17")).toBe(true);
  });

  it("derives exchange from ETF code prefix", () => {
    expect(exchangeOf("510300")).toBe("sse");
    expect(exchangeOf("588000")).toBe("sse");
    expect(exchangeOf("159915")).toBe("szse");
    expect(exchangeOf("159608")).toBe("szse");
  });

  it("fetch adapter parses cninfo JSON via mock fetch", async () => {
    const payload = {
      announcements: [
        {
          secCode: "510300",
          secName: "沪深300ETF",
          announcementTitle: "沪深300ETF：2026年中期报告",
          announcementTime: 1786896000000,
          adjunctUrl: "finalpage/2026-08-17/1.PDF",
          announcementId: "1",
        },
      ],
    };
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(payload), { status: 200 });
    const adapter = createExchangeWebAdapter(mockFetch);
    const items = await adapter.fetchNews("2026-08-17");
    expect(items.length).toBe(1);
    expect(items[0].institution).toBe("sse");
  });

  it("throws soft error when cninfo unreachable", async () => {
    const mockFetch: typeof fetch = async () => new Response("err", { status: 500 });
    const adapter = createExchangeWebAdapter(mockFetch);
    await expect(adapter.fetchNews("2026-08-17")).rejects.toThrow(
      /exchange-web:/,
    );
  });
});
