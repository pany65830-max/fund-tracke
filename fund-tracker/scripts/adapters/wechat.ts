import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

export type WechatAccount = {
  institution: Institution;
  /** Sogou search query (usually the公众号名). */
  name: string;
  /** Allowed publisher display names on Sogou (`span.all-time-y2`). */
  publishers?: string[];
  /** Core brand tokens; any publisher whose name contains one is accepted.
   *  This captures sub-accounts (微理财/微资讯/客服) without enumerating each. */
  brands?: string[];
  accountId?: string;
  feedUrl?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function loadAccounts(): WechatAccount[] {
  const path = join(__dirname, "../../config/wechat-accounts.json");
  return JSON.parse(readFileSync(path, "utf8")) as WechatAccount[];
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’");
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function absolutizeSogou(href: string): string {
  const h = decodeHtmlEntities(href.trim());
  if (!h) return h;
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  if (h.startsWith("//")) return `https:${h}`;
  if (h.startsWith("/")) return `https://weixin.sogou.com${h}`;
  return `https://weixin.sogou.com/${h}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function shanghaiDateFromUnix(unixSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

export function isRecentEnough(
  unixSec: number | null,
  tradeDate: string,
  maxAgeDays = 14,
): boolean {
  if (unixSec == null || !Number.isFinite(unixSec)) return true;
  const [y, m, d] = tradeDate.split("-").map(Number);
  const tradeEnd = Date.UTC(y, m - 1, d, 23, 59, 59) / 1000;
  const ageDays = (tradeEnd - unixSec) / 86400;
  return ageDays >= -1 && ageDays <= maxAgeDays;
}

/** Keep items published on tradeDate (Asia/Shanghai). Unknown time → drop when strict. */
export function isOnTradeDate(
  unixSec: number | null,
  tradeDate: string,
  strict = true,
): boolean {
  if (unixSec == null || !Number.isFinite(unixSec)) return !strict;
  return shanghaiDateFromUnix(unixSec) === tradeDate;
}

function publisherAllowed(
  publisher: string,
  accountName: string,
  publishers?: string[],
  brands?: string[],
): boolean {
  const p = publisher.trim();
  if (!p) return false;
  const allow = [
    ...(publishers?.length ? publishers : [accountName]),
    ...(brands || []),
  ]
    .map((x) => x.trim())
    .filter(Boolean);
  return allow.some((a) => a && (p === a || p.includes(a) || a.includes(p)));
}

export function parseRssItems(
  xml: string,
  institution: Institution,
  tradeDate: string,
): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = block.match(
      /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i,
    );
    const link = block.match(/<link>(.*?)<\/link>/i);
    const desc = block.match(
      /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i,
    );
    const t = (title?.[1] || title?.[2] || "").trim();
    const url = (link?.[1] || "").trim();
    if (!t || !url) continue;
    items.push({
      id: `wx-${institution}-${i++}-${tradeDate}`,
      title: t,
      summary: (desc?.[1] || desc?.[2] || t).replace(/<[^>]+>/g, "").trim(),
      institution,
      category:
        institution === "sse" || institution === "szse" ? "exchange" : "other",
      source: "wechat",
      publishedAt: `${tradeDate}T08:00:00+08:00`,
      sourceUrl: url,
    });
  }
  return items;
}

/**
 * Parse Sogou WeChat article search HTML (`ul.news-list`).
 * Filters by publisher display name; parses `timeConvert('unix')`.
 */
export function parseSogouNewsList(
  html: string,
  institution: Institution,
  accountName: string,
  tradeDate: string,
  opts: {
    limit?: number;
    publishers?: string[];
    brands?: string[];
    maxAgeDays?: number;
    sameDayOnly?: boolean;
  } = {},
): NewsItem[] {
  if (/验证码|antispider|请输入验证|captcha/i.test(html)) {
    throw new Error("sogou captcha / anti-spider");
  }

  const limit = opts.limit ?? 10;
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const sameDayOnly = opts.sameDayOnly ?? false;
  const items: NewsItem[] = [];
  const liRe = /<li[^>]*id=["']sogou_vr_11002601_box_[^"']*["'][\s\S]*?<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  let i = 0;

  while ((liMatch = liRe.exec(html)) && items.length < limit * 3) {
    const htmlBlock = liMatch[0];

    const titleA = htmlBlock.match(
      /<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleA) continue;
    const title = stripTags(titleA[2]);
    if (!title || title.length < 4) continue;

    const publisherRaw =
      htmlBlock.match(/class=["']all-time-y2["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      "";
    const publisher = stripTags(publisherRaw);
    if (
      !publisherAllowed(publisher, accountName, opts.publishers, opts.brands)
    )
      continue;

    const info = htmlBlock.match(/class=["']txt-info["'][^>]*>([\s\S]*?)<\/p>/i);
    const summary = info ? stripTags(info[1]) : title;

    const timeConvert = htmlBlock.match(/timeConvert\('(\d+)'\)/);
    const tAttr = htmlBlock.match(/\bt=["']?(\d{9,13})["']?/i);
    let unix: number | null = null;
    if (timeConvert) unix = Number(timeConvert[1]);
    else if (tAttr) {
      const raw = Number(tAttr[1]);
      unix = raw > 1e12 ? Math.floor(raw / 1000) : raw;
    }
    if (sameDayOnly) {
      if (!isOnTradeDate(unix, tradeDate, true)) continue;
    } else if (!isRecentEnough(unix, tradeDate, maxAgeDays)) {
      continue;
    }

    const publishedAt = unix
      ? new Date(unix * 1000).toISOString()
      : `${tradeDate}T08:00:00+08:00`;

    items.push({
      id: `wx-sg-${institution}-${i++}-${tradeDate}`,
      title,
      summary: summary || title,
      institution,
      category:
        institution === "sse" || institution === "szse" ? "exchange" : "other",
      source: "wechat",
      publishedAt,
      sourceUrl: absolutizeSogou(titleA[1]),
    });
  }

  // Prefer newest first when timestamps exist
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items.slice(0, limit);
}

export function sogouSearchUrl(accountName: string, page = 1): string {
  const q = encodeURIComponent(accountName);
  const p = page > 1 ? `&page=${page}` : "";
  return `https://weixin.sogou.com/weixin?type=2&s_from=input&query=${q}&ie=utf8&_sug_=n&_sug_type_=${p}`;
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const maxTries = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://weixin.sogou.com/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // Sogou throws a captcha/anti-spider wall under load — retry with backoff.
      if (/验证码|antispider|请输入验证|captcha/i.test(text)) {
        if (attempt < maxTries - 1) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error("sogou captcha / anti-spider");
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < maxTries - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function createWechatAdapter(
  fetchImpl: typeof fetch = fetch,
  opts: {
    delayMs?: number;
    accounts?: WechatAccount[];
    maxAgeDays?: number;
    sameDayOnly?: boolean;
    pages?: number;
  } = {},
): NewsAdapter {
  const delayMs = opts.delayMs ?? 500;
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const sameDayOnly = opts.sameDayOnly ?? false;
  const pages = Math.max(1, opts.pages ?? 1);
  return {
    name: "wechat",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const accounts = opts.accounts || loadAccounts();
      const out: NewsItem[] = [];
      const errors: string[] = [];

      for (const acc of accounts) {
        try {
          if (acc.feedUrl) {
            const xml = await fetchText(acc.feedUrl, fetchImpl);
            out.push(...parseRssItems(xml, acc.institution, tradeDate));
          } else if (acc.name) {
            // Search the account name AND its core brand token; the brand search
            // surfaces every sub-account (微理财/微资讯/客服) in one query.
            const queries = Array.from(
              new Set(
                [acc.name, ...(acc.brands || []), ...(acc.publishers || [])].filter(
                  Boolean,
                ),
              ),
            );
            const seen = new Set<string>();
            for (const q of queries) {
              for (let page = 1; page <= pages; page++) {
                let html: string;
                try {
                  html = await fetchText(sogouSearchUrl(q, page), fetchImpl);
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  errors.push(`${acc.institution} p${page}: ${msg}`);
                  break;
                }
                if (/验证码|antispider|请输入验证|captcha/i.test(html)) {
                  errors.push(`${acc.institution}: sogou captcha on page ${page}`);
                  break;
                }
                if (!/news-list|sogou_vr_11002601_box/i.test(html)) {
                  break; // no more results
                }
                const batch = parseSogouNewsList(
                  html,
                  acc.institution,
                  acc.name,
                  tradeDate,
                  {
                    publishers: acc.publishers || [acc.name],
                    brands: acc.brands || [acc.name],
                    maxAgeDays,
                    sameDayOnly,
                    limit: 30,
                  },
                );
                if (!batch.length && page > 1) break;
                for (const item of batch) {
                  if (seen.has(item.sourceUrl)) continue;
                  seen.add(item.sourceUrl);
                  out.push(item);
                }
                if (delayMs > 0) await sleep(delayMs);
              }
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${acc.institution}: ${msg}`);
        }
        if (delayMs > 0) await sleep(delayMs);
      }

      if (!out.length && errors.length) {
        throw new Error(errors.join("; "));
      }
      return out;
    },
  };
}
