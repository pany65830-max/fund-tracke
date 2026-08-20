import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

export type WeweFeed = {
  institution: Institution;
  name: string;
  feedId?: string;
};

export type WeweCfg = {
  /** Tunnel 或本机根地址，无尾斜杠。空则跳过。 */
  baseUrl: string;
  authCode?: string;
  feeds: WeweFeed[];
  timeoutMs?: number;
  limit?: number;
};

type JsonFeedItem = {
  id?: string;
  url?: string;
  external_url?: string;
  title?: string;
  content_text?: string;
  content_html?: string;
  date_published?: string;
  date_modified?: string;
  authors?: Array<{ name?: string }>;
  author?: { name?: string } | string;
};

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function authorName(item: JsonFeedItem): string {
  if (Array.isArray(item.authors) && item.authors[0]?.name) {
    return item.authors[0].name.trim();
  }
  if (typeof item.author === "string") return item.author.trim();
  if (item.author && typeof item.author === "object" && item.author.name) {
    return item.author.name.trim();
  }
  return "";
}

function matchFeed(name: string, feeds: WeweFeed[]): WeweFeed | undefined {
  const n = name.replace(/\s+/g, "");
  return feeds.find((f) => f.name.replace(/\s+/g, "") === n);
}

export function beijingDateFromIso(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** 把 WeWe JSON Feed 收成当天、且属于配置里 10 个号的 NewsItem。 */
export function parseWeweJsonFeed(
  json: unknown,
  feeds: WeweFeed[],
  tradeDate: string,
): NewsItem[] {
  const root = json as { items?: JsonFeedItem[] };
  const items = Array.isArray(root?.items) ? root.items : [];
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  let seq = 0;
  for (const it of items) {
    const title = stripTags(it.title || "");
    if (title.length < 2) continue;
    const account = authorName(it);
    const feed = matchFeed(account, feeds);
    if (!feed) continue;
    const published = it.date_published || it.date_modified || "";
    const day = beijingDateFromIso(published);
    if (day !== tradeDate) continue;
    const url = it.url || it.external_url || "";
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = stripTags(it.content_text || it.content_html || title).slice(
      0,
      280,
    );
    out.push({
      id: `wewe-${feed.institution}-${seq++}-${tradeDate}`,
      title,
      summary,
      institution: feed.institution,
      category:
        feed.institution === "sse" || feed.institution === "szse"
          ? "exchange"
          : "other",
      source: "wechat",
      publishedAt: Number.isFinite(Date.parse(published))
        ? new Date(published).toISOString()
        : `${tradeDate}T08:00:00+08:00`,
      sourceUrl: url,
    });
  }
  return out;
}

function feedUrl(base: string, authCode: string | undefined, limit: number): string {
  const root = base.replace(/\/$/, "");
  const u = new URL(`${root}/feeds/all.json`);
  u.searchParams.set("limit", String(limit));
  if (authCode) {
    u.searchParams.set("code", authCode);
    u.searchParams.set("auth_code", authCode);
  }
  return u.toString();
}

export function createWeweRssAdapter(
  fetchImpl: typeof fetch = fetch,
  cfg: WeweCfg,
): NewsAdapter {
  return {
    name: "wewe-rss",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const base = (cfg.baseUrl || "").trim();
      if (!base) {
        throw new Error("WEWE_RSS_URL empty");
      }
      const named = cfg.feeds.filter((f) => f.name.trim());
      if (!named.length) {
        throw new Error("wewe-feeds.json empty");
      }
      const timeoutMs = cfg.timeoutMs ?? 8000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(
          feedUrl(base, cfg.authCode, cfg.limit ?? 50),
          {
            signal: controller.signal,
            headers: { Accept: "application/feed+json, application/json" },
          },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        return parseWeweJsonFeed(json, named, tradeDate);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(msg);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
