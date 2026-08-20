import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const LIST_URL = "http://etf.sse.com.cn/disclosure/";

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function classifySse(title: string): NewsItem["category"] {
  if (/(认购|申购|赎回|上市|发行|募集|成立)/.test(title)) return "new_product";
  if (/(停牌|复牌|风险|警示|异常|暂停|溢价|折价)/.test(title))
    return "active_etf";
  if (/(公告|披露|报告|通知|决议|做市)/.test(title)) return "disclosure";
  return "exchange";
}

/**
 * 从基金专区列表 HTML 抽出「标题 + YYYY-MM-DD」。
 * 日期必须能解析，否则丢弃（不默认今天）。
 */
export function parseSseFundHtml(
  html: string,
  tradeDate: string,
  baseUrl = LIST_URL,
): NewsItem[] {
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  let seq = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 40) {
    const title = stripTags(m[2]);
    if (title.length < 8) continue;
    if (!/公告|披露|基金|ETF|做市|上市|停牌|复牌/.test(title)) continue;
    const ctx = stripTags(html.slice(m.index, m.index + 500));
    const dm = `${title} ${ctx}`.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!dm) continue;
    const dt = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
    if (dt !== tradeDate) continue;
    const href = absolutize(m[1], baseUrl);
    const sourceUrl =
      href && /^https?:/i.test(href)
        ? href
        : `https://www.sse.com.cn/home/search?webswd=${encodeURIComponent(title)}`;
    const key = `${dt}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `sse-fund-${tradeDate}-${seq++}`,
      title,
      summary: title,
      institution: "sse" as Institution,
      category: classifySse(title),
      source: "exchange_web",
      publishedAt: `${dt}T08:00:00+08:00`,
      sourceUrl,
    });
  }
  return out;
}

export function createSseFundSiteAdapter(
  fetchImpl: typeof fetch = fetch,
  listUrl = LIST_URL,
): NewsAdapter {
  return {
    name: "sse-fund-site",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const res = await fetchImpl(listUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          Referer: "http://etf.sse.com.cn/",
        },
      });
      if (!res.ok) {
        throw new Error(`sse-fund-site HTTP ${res.status}`);
      }
      const html = await res.text();
      return parseSseFundHtml(html, tradeDate, listUrl);
    },
  };
}
