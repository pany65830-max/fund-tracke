import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const REFERER = "https://www.sse.com.cn/home/search?webswd=ETF";

export type SseSearchCfg = {
  /** 上证基金网全文检索接口 */
  endpoint: string;
  /** 搜索空间 ID：53=上证基金网 */
  spaceId: number;
  /** 检索关键词（各自检索后合并去重） */
  keywords: string[];
  /** 单次每关键词拉取条数 */
  pageSize: number;
  /** 最大拉取页数（降序，命中旧数据即停） */
  maxPages: number;
  /** 只保留最近 N 天内的公告（与 tradeDate 对齐） */
  maxAgeDays: number;
};

const DEFAULT_CFG: SseSearchCfg = {
  endpoint: "https://query.sse.com.cn/search/getESSearchDoc.do",
  spaceId: 53,
  keywords: ["ETF", "交易型开放式指数基金"],
  pageSize: 100,
  maxPages: 5,
  maxAgeDays: 7,
};

type SseSearchItem = {
  id: number;
  documentId: string;
  title: string;
  createTime: string; // "2026-08-18 12:50:00" or "2026-08-18 00:00:00"
  url?: string | null;
  extend?: { name: string; value?: string | null }[];
};

type SseSearchResponse = {
  code?: string;
  msg?: string;
  data?: {
    totalSize?: number;
    totalPage?: number;
    knowledgeList?: SseSearchItem[];
  } | null;
};

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseExtend(
  item: SseSearchItem,
): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const e of item.extend ?? []) {
    map[e.name] = e.value ?? undefined;
  }
  return map;
}

function buildUrl(item: SseSearchItem): string {
  // 搜索接口返回的 CURL 指向旧版 shtml 公告页，多年未维护、普遍 404；
  // 改为跳转到上交所站内搜索该标题，用户可找到最新 PDF 原文。
  const q = encodeURIComponent(stripTags(item.title));
  return `https://www.sse.com.cn/home/search?webswd=${q}`;
}

function classifySse(title: string): NewsItem["category"] {
  if (/(认购|申购|赎回|上市|发行|募集|成立)/.test(title)) return "new_product";
  if (/(停牌|复牌|风险|警示|异常|暂停|溢价|折价)/.test(title))
    return "active_etf";
  if (/(公告|披露|报告|通知|决议|做市)/.test(title)) return "disclosure";
  return "exchange";
}

function mapSseItem(item: SseSearchItem): NewsItem {
  const title = stripTags(item.title);
  const create = item.createTime || "";
  // createTime 可能只有日期，补齐时间以便 ISO 化
  const dt = create.includes(":")
    ? create.replace(" ", "T") + "+08:00"
    : `${create}T08:00:00+08:00`;
  return {
    id: `sse-search-${item.documentId || item.id}`,
    title,
    summary: title,
    institution: "sse" as Institution,
    category: classifySse(title),
    source: "exchange_web",
    publishedAt: dt,
    sourceUrl: buildUrl(item),
  };
}

function buildUrlParams(cfg: SseSearchCfg, kw: string, page: number): string {
  const params = new URLSearchParams();
  params.set("searchword", kw);
  params.set("page", String(page));
  params.set("limit", String(cfg.pageSize));
  params.set("spaceId", String(cfg.spaceId));
  params.set("orderByKey", "create_time");
  params.set("searchMode", "fuzzy");
  return `${cfg.endpoint}?${params.toString()}`;
}

export function createSseSearchAdapter(
  fetchImpl: typeof fetch = fetch,
  cfg: Partial<SseSearchCfg> = {},
): NewsAdapter {
  const config = { ...DEFAULT_CFG, ...cfg };
  return {
    name: "sse-search",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const trade = new Date(`${tradeDate}T00:00:00+08:00`).getTime();
      const dayMs = 86400000;
      const cutoff = trade - config.maxAgeDays * dayMs;
      const endOfDay = trade + dayMs;

      const out: NewsItem[] = [];
      const seen = new Set<string>();
      const errors: string[] = [];

      for (const kw of config.keywords) {
        for (let page = 1; page <= config.maxPages; page++) {
          try {
            const res = await fetchImpl(buildUrlParams(config, kw, page), {
              headers: {
                "User-Agent": UA,
                Referer: REFERER,
                Accept: "application/json, text/plain, */*",
              },
            });
            if (!res.ok) {
              errors.push(`sse-search ${kw} p${page} HTTP ${res.status}`);
              break;
            }
            const data = (await res.json()) as SseSearchResponse;
            if (data.code !== "0" || !data.data?.knowledgeList) {
              errors.push(
                `sse-search ${kw} p${page} code=${data.code} msg=${data.msg || ""}`,
              );
              break;
            }
            const list = data.data.knowledgeList;
            if (list.length === 0) break;

            let allOld = true;
            for (const item of list) {
              const ts = new Date(item.createTime).getTime();
              if (Number.isNaN(ts)) continue;
              if (ts > endOfDay) continue; // 未来数据跳过
              if (ts < cutoff) continue;
              allOld = false;
              const key = item.documentId || String(item.id);
              if (seen.has(key)) continue;
              seen.add(key);
              out.push(mapSseItem(item));
            }

            // 按 create_time 降序，若整页都早于 cutoff 则后续页更旧，直接停
            if (allOld) break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`sse-search ${kw} p${page} ${msg}`);
            break;
          }
        }
      }

      if (!out.length && errors.length) {
        throw new Error(`sse-search: ${errors.join("; ")}`);
      }
      return out;
    },
  };
}
