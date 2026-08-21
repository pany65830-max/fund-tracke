import { describe, it, expect } from "vitest";
import {
  createWeweRssAdapter,
  matchAccountsToFeeds,
  parseWeweJsonFeed,
} from "./wewe-rss";
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

  it("uses feed title when an item has no author (per-account JSON)", () => {
    const items = parseWeweJsonFeed(
      {
        title: "华夏基金",
        items: [
          {
            url: "https://mp.weixin.qq.com/s/hx1",
            title: "华夏基金：产品提示",
            date_modified: "2026-08-19T02:00:00.000Z",
          },
        ],
      },
      feeds,
      "2026-08-19",
      "华夏基金",
    );
    expect(items).toHaveLength(1);
    expect(items[0].institution).toBe("huaxia");
  });

  it("matches WeWe account list to configured names", () => {
    const matched = matchAccountsToFeeds(
      [
        { id: "MP_1", name: "华夏基金" },
        { id: "MP_2", name: "未配置的号" },
      ],
      feeds,
    );
    expect(matched).toEqual([{ institution: "huaxia", name: "华夏基金", id: "MP_1" }]);
  });

  it("adapter fetches each matched account instead of all.json", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/feeds") || url.includes("/feeds?")) {
        return new Response(
          JSON.stringify([
            { id: "MP_WXS_1", name: "华夏基金" },
            { id: "MP_WXS_2", name: "中国证券报" },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("MP_WXS_1.json")) {
        return new Response(JSON.stringify(feedJson), { status: 200 });
      }
      if (url.includes("MP_WXS_2.json")) {
        return new Response(
          JSON.stringify({
            title: "中国证券报",
            items: [
              {
                url: "https://mp.weixin.qq.com/s/cnstock1",
                title: "盘中利好",
                date_modified: "2026-08-19T05:00:00.000Z",
                authors: [{ name: "中国证券报" }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error("unexpected " + url);
    };
    const adapter = createWeweRssAdapter(mockFetch, {
      baseUrl: "http://127.0.0.1:4000",
      authCode: "x",
      feeds,
    });
    const items = await adapter.fetchNews("2026-08-19");
    expect(items.map((n) => n.institution).sort()).toEqual(["huaxia", "media"]);
  });
});
