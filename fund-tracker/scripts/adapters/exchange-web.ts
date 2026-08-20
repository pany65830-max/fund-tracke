import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

export type CninfoCfg = {
  /** 巨潮公告查询（沪深交易所联合官方披露平台） */
  endpoint: string;
  /** 检索关键词，多个关键词各自检索后合并 */
  keywords: string[];
  /** 单次每关键词拉取条数（巨潮硬限约 30） */
  pageSize: number;
  /** 每关键词最多翻页数 */
  maxPages?: number;
  /** 只保留最近 N 天内的公告（0 = 仅当天） */
  maxAgeDays: number;
  /** hisAnnouncement 的 column；默认只打一列，避免打满 Worker 时限 */
  columns?: string[];
};

/** 默认从本地 config/exchange-sources.json 加载；在 Cloudflare Worker 等无 import.meta.url
 *  的环境，必须由调用方显式传入 cfg。 */
async function loadCfg(): Promise<CninfoCfg> {
  const url = typeof import.meta.url === "string" ? import.meta.url : undefined;
  if (!url) {
    throw new Error(
      "exchange-web adapter: import.meta.url unavailable. Pass cfg explicitly.",
    );
  }
  const [{ readFileSync }, { dirname, join }, { fileURLToPath }] =
    await Promise.all([
      import("node:fs"),
      import("node:path"),
      import("node:url"),
    ]);
  const __dirname = dirname(fileURLToPath(url));
  const path = join(__dirname, "../../config/exchange-sources.json");
  return JSON.parse(readFileSync(path, "utf8")) as CninfoCfg;
}

async function loadWhitelist(): Promise<Set<string>> {
  const url = typeof import.meta.url === "string" ? import.meta.url : undefined;
  if (!url) return new Set();
  const [{ readFileSync }, { dirname, join }, { fileURLToPath }] =
    await Promise.all([
      import("node:fs"),
      import("node:path"),
      import("node:url"),
    ]);
  const __dirname = dirname(fileURLToPath(url));
  const path = join(__dirname, "../../config/etf-whitelist.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    Array<{ code: string }>
  >;
  return collectWhitelistCodes(raw);
}

const DEFAULT_CNINFO_CFG: CninfoCfg = {
  endpoint: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
  keywords: ["ETF", "交易型开放式指数基金"],
  pageSize: 30,
  maxPages: 2,
  maxAgeDays: 0,
  columns: ["szse"],
};

/** 从 etf-whitelist.json 或 Worker PRODUCTS 抽出六位代码。 */
export function collectWhitelistCodes(
  products:
    | Array<{ code: string }>
    | Record<string, Array<{ code: string }>>,
): Set<string> {
  const out = new Set<string>();
  const lists = Array.isArray(products) ? [products] : Object.values(products);
  for (const list of lists) {
    for (const p of list) {
      const c = String(p.code || "").replace(/\.(SH|SZ)$/i, "");
      if (c) out.add(c);
    }
  }
  return out;
}

/** ETF 代码前缀判断归属市场：51/56/58 开头=上交所，15/16 开头=深交所 */
export function exchangeOf(code: string): Institution {
  if (/^(51|56|58)/.test(code)) return "sse";
  if (/^(15|16)/.test(code)) return "szse";
  return "sse";
}

export function isWhitelistedCode(code: string, whitelist: Set<string>): boolean {
  if (!whitelist.size) return true;
  const c = String(code || "").replace(/\.(SH|SZ)$/i, "");
  return whitelist.has(c);
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

export type CninfoAnnouncement = {
  secCode: string;
  secName: string;
  announcementTitle: string;
  announcementTime: number | string;
  adjunctUrl: string;
  announcementId: string;
};

export function parseAnnouncementTime(t: number | string): number {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  const s = String(t ?? "").trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const withTz = s.includes("T")
    ? s
    : `${s.replace(" ", "T")}${/Z|[+-]\d\d/.test(s) ? "" : "+08:00"}`;
  const ms = Date.parse(withTz);
  return Number.isNaN(ms) ? 0 : ms;
}

function beijingDayFromMs(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** 把巨潮返回的公告映射成统一的 NewsItem（source=exchange_web） */
export function mapCninfoAnnouncement(a: CninfoAnnouncement): NewsItem {
  const ms = parseAnnouncementTime(a.announcementTime);
  const day = beijingDayFromMs(ms);
  const publishedAt = `${day}T08:00:00+08:00`;
  const title = stripTags(a.announcementTitle);
  const inst = exchangeOf(a.secCode);
  const adjunct = a.adjunctUrl || "";
  const url = /^https?:\/\//i.test(adjunct)
    ? adjunct
    : adjunct
      ? `https://static.cninfo.com.cn/${adjunct.replace(/^\//, "")}`
      : `https://www.cninfo.com.cn/new/disclosure/detail?stockCode=${encodeURIComponent(a.secCode)}&announcementId=${encodeURIComponent(a.announcementId)}`;
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

function buildForm(
  config: CninfoCfg,
  kw: string,
  page: number,
  column: string,
  tradeDate: string,
): string {
  const params = new URLSearchParams();
  params.set("pageNum", String(page));
  params.set("pageSize", String(config.pageSize));
  params.set("column", column);
  params.set("tabName", "fulltext");
  params.set("plate", "");
  params.set("stock", "");
  params.set("searchkey", kw);
  params.set("secid", "");
  params.set("category", "");
  params.set("trade", "");
  params.set("seDate", `${tradeDate}~${tradeDate}`);
  params.set("sortName", "");
  params.set("sortType", "");
  params.set("isHLtitle", "true");
  return params.toString();
}

export function createExchangeWebAdapter(
  fetchImpl: typeof fetch = fetch,
  cfg?: CninfoCfg,
  whitelist?: Set<string>,
): NewsAdapter {
  const cfgPromise = cfg ? undefined : loadCfg();
  const wlPromise = whitelist ? undefined : loadWhitelist();
  return {
    name: "exchange-web",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const config = { ...DEFAULT_CNINFO_CFG, ...(cfg ?? (await cfgPromise!)) };
      const codes = whitelist ?? (await wlPromise!) ?? new Set<string>();
      const items: NewsItem[] = [];
      const errors: string[] = [];
      const seen = new Set<string>();

      const trade = new Date(`${tradeDate}T00:00:00+08:00`).getTime();
      const dayMs = 86400000;
      const cutoff = trade - (config.maxAgeDays ?? 0) * dayMs;
      const endOfDay = trade + dayMs;
      const maxPages = config.maxPages ?? 1;
      const columns = config.columns?.length ? config.columns : ["szse"];

      for (const column of columns) {
        for (const kw of config.keywords) {
          for (let page = 1; page <= maxPages; page++) {
            try {
              const res = await fetchImpl(config.endpoint, {
                method: "POST",
                headers: {
                  "User-Agent": "Mozilla/5.0",
                  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                  Origin: "https://www.cninfo.com.cn",
                  Referer:
                    "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
                },
                body: buildForm(config, kw, page, column, tradeDate),
              });
              if (!res.ok) {
                errors.push(`cninfo HTTP ${res.status}`);
                break;
              }
              const data = (await res.json()) as {
                announcements?: CninfoAnnouncement[];
                hasMore?: boolean;
                totalAnnouncement?: number;
              };
              const list = data.announcements ?? [];
              if (!list.length) break;
              for (const a of list) {
                if (!isWhitelistedCode(a.secCode, codes)) continue;
                const ts = parseAnnouncementTime(a.announcementTime);
                if (!ts || ts < cutoff || ts > endOfDay) continue;
                const item = mapCninfoAnnouncement(a);
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                items.push(item);
              }
              if (list.length < config.pageSize || data.hasMore === false) break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              errors.push(`cninfo ${kw} ${msg}`);
              break;
            }
          }
        }
      }

      if (!items.length && errors.length) {
        throw new Error(`exchange-web: ${errors.join("; ")}`);
      }
      return items;
    },
  };
}
