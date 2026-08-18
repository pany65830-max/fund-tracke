import { describe, it, expect } from "vitest";
import {
  parseRssItems,
  parseSogouNewsList,
  createWechatAdapter,
  isRecentEnough,
  sogouSearchUrl,
  decodeHtmlEntities,
} from "./wechat";

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss><channel>
<item><title>微信推文一</title><link>https://mp.weixin.qq.com/s/a</link><description>摘要一</description></item>
<item><title><![CDATA[微信推文二]]></title><link>https://mp.weixin.qq.com/s/b</link><description><![CDATA[摘要二]]></description></item>
</channel></rss>`;

const SAMPLE_SOGOU = `
<html><body>
<ul class="news-list">
  <li id="sogou_vr_11002601_box_0">
    <div class="txt-box">
      <h3><a target="_blank" href="/link?url=abc123&amp;type=2">华泰柏瑞基金发布市场策略观点</a></h3>
      <p class="txt-info">这是摘要内容用于展示</p>
      <div class="s-p">
        <span class="all-time-y2">华泰柏瑞微理财</span>
        <span class="s2"><script>document.write(timeConvert('1785801600'))</script></span>
      </div>
    </div>
  </li>
  <li id="sogou_vr_11002601_box_1">
    <div class="txt-box">
      <h3><a href="/link?url=other">无关账号的文章标题也够长</a></h3>
      <p class="txt-info">别的号</p>
      <div class="s-p">
        <span class="all-time-y2">金融早实习</span>
        <span class="s2"><script>document.write(timeConvert('1785801600'))</script></span>
      </div>
    </div>
  </li>
  <li id="sogou_vr_11002601_box_2">
    <div class="txt-box">
      <h3><a href="/link?url=old">很久以前的官方文章标题</a></h3>
      <p class="txt-info">旧文</p>
      <div class="s-p">
        <span class="all-time-y2">华泰柏瑞微理财</span>
        <span class="s2"><script>document.write(timeConvert('1600000000'))</script></span>
      </div>
    </div>
  </li>
</ul>
</body></html>`;

describe("wechat", () => {
  it("parses RSS items", () => {
    const items = parseRssItems(SAMPLE_RSS, "huatai", "2026-08-03");
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wechat");
    expect(items[0].body).toBeUndefined();
  });

  it("parses Sogou list, filters publisher, decodes amp, drops old", () => {
    const items = parseSogouNewsList(
      SAMPLE_SOGOU,
      "huatai",
      "华泰柏瑞基金",
      "2026-08-04",
      { publishers: ["华泰柏瑞微理财", "华泰柏瑞基金"], maxAgeDays: 14 },
    );
    expect(items.length).toBe(1);
    expect(items[0].title).toContain("华泰柏瑞");
    expect(items[0].sourceUrl).toContain("type=2");
    expect(items[0].sourceUrl).not.toContain("&amp;");
    expect(items[0].summary).toContain("摘要");
  });

  it("throws on captcha page", () => {
    expect(() =>
      parseSogouNewsList(
        "<html>请输入验证码 antispider</html>",
        "huatai",
        "华泰柏瑞基金",
        "2026-08-04",
      ),
    ).toThrow(/captcha/i);
  });

  it("drops junk news (cinema/recruitment) and keeps real fund news", () => {
    const html = `
<ul class="news-list">
  <li id="sogou_vr_11002601_box_0">
    <div class="txt-box">
      <h3><a href="/link?url=a">腾冲艺景华夏影城映前广告招商中</a></h3>
      <p class="txt-info">影城会员卡优惠特惠</p>
      <div class="s-p"><span class="all-time-y2">腾冲艺景华夏影城</span>
      <script>document.write(timeConvert('1785801600'))</script></div>
    </div>
  </li>
  <li id="sogou_vr_11002601_box_1">
    <div class="txt-box">
      <h3><a href="/link?url=b">华夏基金关于旗下ETF分红公告</a></h3>
      <p class="txt-info">基金分红提示</p>
      <div class="s-p"><span class="all-time-y2">华夏基金微理财</span>
      <script>document.write(timeConvert('1785801600'))</script></div>
    </div>
  </li>
</ul>`;
    const items = parseSogouNewsList(html, "huaxia", "华夏基金", "2026-08-04", {
      publishers: ["华夏基金微理财", "华夏基金"],
      brands: ["华夏基金", "华夏财富"],
      maxAgeDays: 14,
    });
    expect(items.length).toBe(1);
    expect(items[0].title).toContain("分红");
  });

  it("isRecentEnough window", () => {
    expect(isRecentEnough(null, "2026-08-04")).toBe(true);
    const day = Math.floor(Date.UTC(2026, 7, 4) / 1000);
    expect(isRecentEnough(day, "2026-08-04")).toBe(true);
    expect(isRecentEnough(day - 20 * 86400, "2026-08-04", 14)).toBe(false);
  });

  it("decodeHtmlEntities", () => {
    expect(decodeHtmlEntities("a&amp;b&ldquo;x&rdquo;")).toBe('a&b“x”');
  });

  it("skips accounts without name/feedUrl (no throw)", async () => {
    const adapter = createWechatAdapter(
      async () => {
        throw new Error("should not fetch");
      },
      { accounts: [{ institution: "huatai", name: "", feedUrl: "" }], delayMs: 0 },
    );
    await expect(adapter.fetchNews("2026-08-03")).resolves.toEqual([]);
  });

  it("uses Sogou when feedUrl empty", async () => {
    const adapter = createWechatAdapter(
      async (input) => {
        const url = String(input);
        expect(url).toContain("weixin.sogou.com");
        return new Response(SAMPLE_SOGOU, { status: 200 });
      },
      {
        accounts: [
          {
            institution: "huatai",
            name: "华泰柏瑞基金",
            publishers: ["华泰柏瑞微理财"],
            feedUrl: "",
          },
        ],
        delayMs: 0,
      },
    );
    const items = await adapter.fetchNews("2026-08-04");
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("prefers RSS when feedUrl set", async () => {
    const adapter = createWechatAdapter(
      async (input) => {
        const url = String(input);
        expect(url).toBe("https://example.com/feed.xml");
        return new Response(SAMPLE_RSS, { status: 200 });
      },
      {
        accounts: [
          {
            institution: "huatai",
            name: "华泰柏瑞基金",
            feedUrl: "https://example.com/feed.xml",
          },
        ],
        delayMs: 0,
      },
    );
    const items = await adapter.fetchNews("2026-08-04");
    expect(items).toHaveLength(2);
    expect(items[0].id.startsWith("wx-huatai")).toBe(true);
  });

  it("sameDayOnly keeps only tradeDate articles", () => {
    const html = `
<ul class="news-list">
  <li id="sogou_vr_11002601_box_0">
    <div class="txt-box">
      <h3><a href="/link?url=a">当天文章标题要够长</a></h3>
      <p class="txt-info">摘要</p>
      <div class="s-p"><span class="all-time-y2">深交所</span>
      <script>document.write(timeConvert('1785801600'))</script></div>
    </div>
  </li>
  <li id="sogou_vr_11002601_box_1">
    <div class="txt-box">
      <h3><a href="/link?url=b">昨天文章标题也要够长</a></h3>
      <p class="txt-info">摘要</p>
      <div class="s-p"><span class="all-time-y2">深交所</span>
      <script>document.write(timeConvert('1785715200'))</script></div>
    </div>
  </li>
</ul>`;
    const items = parseSogouNewsList(html, "szse", "深交所", "2026-08-04", {
      publishers: ["深交所"],
      sameDayOnly: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("当天");
  });
});
