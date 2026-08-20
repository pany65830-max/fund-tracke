import { describe, it, expect } from "vitest";
import { parseSseFundHtml, createSseFundSiteAdapter } from "./sse-fund-site";

const html = `
<ul>
  <li>
    <a href="/c/c_20260818.pdf">关于广发证券股份有限公司为平安中证稀有金属主题交易型开放式指数证券投资基金提供主做市服务的公告</a>
    <span>2026-08-18</span>
  </li>
  <li>
    <a href="/old.pdf">平安中证稀有金属主题交易型开放式指数证券投资基金上市交易公告</a>
    <span>2026-08-17</span>
  </li>
</ul>`;

describe("sse-fund-site", () => {
  it("keeps only same-day dated fund announcements", () => {
    const items = parseSseFundHtml(html, "2026-08-18");
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("主做市");
    expect(items[0].publishedAt.startsWith("2026-08-18")).toBe(true);
    expect(items[0].source).toBe("exchange_web");
  });

  it("returns empty when list HTML has no dated rows", () => {
    expect(parseSseFundHtml("<html><body>加载中</body></html>", "2026-08-18")).toEqual(
      [],
    );
  });

  it("adapter uses parse result from mock fetch", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(html, { status: 200 });
    const items = await createSseFundSiteAdapter(mockFetch).fetchNews("2026-08-18");
    expect(items).toHaveLength(1);
  });
});
