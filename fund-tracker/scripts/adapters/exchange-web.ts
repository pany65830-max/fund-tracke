import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type CninfoCfg = {
  /** 巨潮全文检索接口（沪深交易所联合官方披露平台） */
  endpoint: string;
  /** 检索关键词，多个关键词各自检索后合并 */
  keywords: string[];
  /** 单次每关键词拉取条数 */
  pageSize: number;
  /** 只保留最近 N 天内的公告（与 tradeDate 对齐） */
  maxAgeDays: number;
};

function loadCfg(): CninfoCfg {
  const path = join(__dirname, "../../config/exchange-sources.json");
  return JSON.parse(readFileSync(path, "utf8")) as CninfoCfg;
}

const DEFAULT_CNINFO_CFG: CninfoCfg = {
  endpoint: "https://www.cninfo.com.cn/new/fulltextSearch/full",
  keywords: ["ETF"],
  pageSize: 30,
  maxAgeDays: 7,
};

/** ETF 代码前缀判断归属市场：51/56/58 开头=上交所，15/16 开头=深交所 */
export function exchangeOf(code: string): Institution {
  if (/^(51|56|58)/.test(code)) return "sse";
  if (/^(15|16)/.test(code)) return "szse";
  return "sse";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function classifyCninfo(title: string): NewsItem["category"] {
  if (/(认购|申购|赎回|上市|发行|募集|成立)/.test(title)) return "new_product";
  if (/(停牌|复牌|风险|警示|异常|暂停)/.test(title)) return "active_etf";
  if (/(公告|披露|报告|通知|决议)/.test(title)) return "disclosure";
  return "exchange";
}

type CninfoAnnouncement = {
  secCode: string;
  secName: string;
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl: string;
  announcementId: string;
};

/** 把巨潮返回的公告映射成统一的 NewsItem（source=exchange_web） */
export function mapCninfoAnnouncement(a: CninfoAnnouncement): NewsItem {
  const ts = a.announcementTime;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const publishedAt = `${y}-${m}-${day}T08:00:00+08:00`;
  const title = stripTags(a.announcementTitle);
  const inst = exchangeOf(a.secCode);
  const url = `https://static.cninfo.com.cn/${a.adjunctUrl}`;
  return {
    id: `ex-${a.announcementId}-${a.secCode}`,
    title,
    summary: title,
    institution: inst,
    category: classifyCninfo(title),
    source: "exchange_web",
    publishedAt,
    sourceUrl: url,
  };
}

export function createExchangeWebAdapter(
  fetchImpl: typeof fetch = fetch,
  cfg?: CninfoCfg,
): NewsAdapter {
  return {
    name: "exchange-web",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const config = cfg ?? loadCfg();
      const items: NewsItem[] = [];
      const errors: string[] = [];

      // 以 tradeDate 为锚点，取 [tradeDate - maxAgeDays, tradeDate] 区间公告
      const trade = new Date(`${tradeDate}T00:00:00+08:00`).getTime();
      const dayMs = 86400000;
      const cutoff = trade - config.maxAgeDays * dayMs;
      const endOfDay = trade + dayMs;

      for (const kw of config.keywords) {
        try {
          const res = await fetchImpl(config.endpoint, {
            method: "POST",
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `searchkey=${encodeURIComponent(kw)}&pageNum=1&pageSize=${config.pageSize}&sortName=pubdate&sortType=desc`,
          });
          if (!res.ok) {
            errors.push(`cninfo HTTP ${res.status}`);
            continue;
          }
          const data = (await res.json()) as {
            announcements?: CninfoAnnouncement[];
          };
          for (const a of data.announcements ?? []) {
            const ts = a.announcementTime;
            if (ts < cutoff || ts > endOfDay) continue;
            items.push(mapCninfoAnnouncement(a));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`cninfo ${kw} ${msg}`);
        }
      }

      if (!items.length && errors.length) {
        throw new Error(`exchange-web: ${errors.join("; ")}`);
      }
      return items;
    },
  };
}
