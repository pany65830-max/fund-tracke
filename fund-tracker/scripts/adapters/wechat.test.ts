import { describe, it, expect } from "vitest";
import { parseRssItems, createWechatAdapter } from "./wechat";

const SAMPLE = `<?xml version="1.0"?>
<rss><channel>
<item><title>微信推文一</title><link>https://mp.weixin.qq.com/s/a</link><description>摘要一</description></item>
<item><title><![CDATA[微信推文二]]></title><link>https://mp.weixin.qq.com/s/b</link><description><![CDATA[摘要二]]></description></item>
</channel></rss>`;

describe("wechat", () => {
  it("parses RSS items", () => {
    const items = parseRssItems(SAMPLE, "huatai", "2026-08-03");
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wechat");
    expect(items[0].body).toBeUndefined();
  });

  it("skips accounts without feedUrl (no throw)", async () => {
    const adapter = createWechatAdapter(async () => {
      throw new Error("should not fetch");
    });
    await expect(adapter.fetchNews("2026-08-03")).resolves.toEqual([]);
  });
});
