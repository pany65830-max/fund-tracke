import { describe, it, expect } from "vitest";
import { createWeweRssAdapter, parseWeweJsonFeed } from "./wewe-rss";
import type { WeweFeed } from "./wewe-rss";

const feeds: WeweFeed[] = [
  { institution: "huaxia", name: "华夏基金" },
  { institution: "sse", name: "上交所发布" },
  { institution: "media", name: "中国证券报" },
];

const feedJson = {
  items: [
    {
      id: "1",
      url: "https://mp.weixin.qq.com/s/aaa",
      title: "华夏基金：产品提示",
      content_text: "摘要",
      date_published: "2026-08-19T02:00:00.000Z",
      authors: [{ name: "华夏基金" }],
    },
    {
      id: "2",
      url: "https://mp.weixin.qq.com/s/bbb",
      title: "银行招聘会",
      date_published: "2026-08-19T03:00:00.000Z",
      authors: [{ name: "华夏银行信用卡" }],
    },
    {
      id: "3",
      url: "https://mp.weixin.qq.com/s/ccc",
      title: "上交所发布昨日稿",
      date_published: "2026-08-18T02:00:00.000Z",
      authors: [{ name: "上交所发布" }],
    },
  ],
};

describe("wewe-rss", () => {
  it("keeps only configured accounts on the trade date", () => {
    const items = parseWeweJsonFeed(feedJson, feeds, "2026-08-19");
    expect(items).toHaveLength(1);
    expect(items[0].institution).toBe("huaxia");
    expect(items[0].source).toBe("wechat");
    expect(items[0].title).toContain("产品提示");
  });

  it("maps exchange accounts to exchange category", () => {
    const items = parseWeweJsonFeed(
      {
        items: [
          {
            url: "https://mp.weixin.qq.com/s/sse1",
            title: "上交所发布：ETF 做市",
            date_published: "2026-08-19T04:00:00.000Z",
            author: { name: "上交所发布" },
          },
        ],
      },
      feeds,
      "2026-08-19",
    );
    expect(items[0].category).toBe("exchange");
    expect(items[0].institution).toBe("sse");
  });

  it("maps 中国证券报 to media / other", () => {
    const items = parseWeweJsonFeed(
      {
        items: [
          {
            url: "https://mp.weixin.qq.com/s/cnstock1",
            title: "盘中利好：直线涨停",
            date_published: "2026-08-20T05:36:26.000Z",
            author: { name: "中国证券报" },
          },
        ],
      },
      feeds,
      "2026-08-20",
    );
    expect(items).toHaveLength(1);
    expect(items[0].institution).toBe("media");
    expect(items[0].category).toBe("other");
    expect(items[0].source).toBe("wechat");
  });

  it("adapter parses mock JSON Feed", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(feedJson), { status: 200 });
    const adapter = createWeweRssAdapter(mockFetch, {
      baseUrl: "http://127.0.0.1:4000",
      authCode: "x",
      feeds,
    });
    const items = await adapter.fetchNews("2026-08-19");
    expect(items).toHaveLength(1);
  });
});
