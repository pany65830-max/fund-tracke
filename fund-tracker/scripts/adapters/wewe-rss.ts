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

type WeweAccount = { id: string; name: string };

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function compactName(name: string): string {
  return name.replace(/\s+/g, "");
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

function feedDefaultAuthor(json: unknown): string {
  const root = json as {
    title?: string;
    author?: { name?: string } | string;
  };
  if (typeof root?.author === "string" && root.author.trim()) {
    return root.author.trim();
  }
  if (root?.author && typeof root.author === "object" && root.author.name) {
    return root.author.name.trim();
  }
  return String(root?.title || "").trim();
}

function matchFeed(name: string, feeds: WeweFeed[]): WeweFeed | undefined {
  const n = compactName(name);
  return feeds.find((f) => compactName(f.name) === n);
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

/** 把 WeWe JSON Feed 收成当天、且属于配置里公众号的 NewsItem。 */
export function parseWeweJsonFeed(
  json: unknown,
  feeds: WeweFeed[],
  tradeDate: string,
  defaultAuthor?: string,
): NewsItem[] {
  const root = json as { items?: JsonFeedItem[] };
  const items = Array.isArray(root?.items) ? root.items : [];
  const fallbackAuthor = (defaultAuthor || feedDefaultAuthor(json)).trim();
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  let seq = 0;
  for (const it of items) {
    const title = stripTags(it.title || "");
    if (title.length < 2) continue;
    const account = authorName(it) || fallbackAuthor;
    const feed = matchFeed(account, feeds);
    if (!feed) continue;
    const published = it.date_published || it.date_modified || "";
    const day = beijingDateFromIso(published);
    if (day !== tradeDate) continue;
    const url = it.url || it.external_url || "";
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
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

function applyAuth(u: URL, authCode: string | undefined): void {
  if (!authCode) return;
  u.searchParams.set("code", authCode);
  u.searchParams.set("auth_code", authCode);
}

export function accountListUrl(base: string, authCode?: string): string {
  const u = new URL(`${base.replace(/\/$/, "")}/feeds`);
  applyAuth(u, authCode);
  return u.toString();
}

export function accountFeedUrl(
  base: string,
  feedId: string,
  authCode: string | undefined,
  limit: number,
): string {
  const u = new URL(`${base.replace(/\/$/, "")}/feeds/${feedId}.json`);
  u.searchParams.set("limit", String(limit));
  applyAuth(u, authCode);
  return u.toString();
}

function allFeedUrl(
  base: string,
  authCode: string | undefined,
  limit: number,
): string {
  const u = new URL(`${base.replace(/\/$/, "")}/feeds/all.json`);
  u.searchParams.set("limit", String(limit));
  applyAuth(u, authCode);
  return u.toString();
}

export function matchAccountsToFeeds(
  accounts: WeweAccount[],
  feeds: WeweFeed[],
): Array<WeweFeed & { id: string }> {
  const out: Array<WeweFeed & { id: string }> = [];
  const seen = new Set<string>();
  for (const acc of accounts) {
    const feed = matchFeed(acc.name, feeds);
    if (!feed || !acc.id || seen.has(acc.id)) continue;
    seen.add(acc.id);
    out.push({ ...feed, id: acc.id });
  }
  return out;
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    signal,
    headers: { Accept: "application/feed+json, application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
      const timeoutMs = cfg.timeoutMs ?? 12000;
      const perFeedLimit = cfg.limit ?? 20;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let accounts: WeweAccount[] = [];
        try {
          const listed = await readJson(
            fetchImpl,
            accountListUrl(base, cfg.authCode),
            controller.signal,
          );
          if (Array.isArray(listed)) {
            accounts = listed
              .map((row) => {
                const r = row as { id?: string; name?: string };
                return { id: String(r.id || ""), name: String(r.name || "") };
              })
              .filter((a) => a.id && a.name);
          }
        } catch {
          accounts = [];
        }

        const targets = matchAccountsToFeeds(accounts, named);
        if (targets.length) {
          const batches = await Promise.allSettled(
            targets.map((t) =>
              readJson(
                fetchImpl,
                accountFeedUrl(base, t.id, cfg.authCode, perFeedLimit),
                controller.signal,
              ).then((json) => parseWeweJsonFeed(json, [t], tradeDate, t.name)),
            ),
          );
          const items: NewsItem[] = [];
          const errors: string[] = [];
          for (const b of batches) {
            if (b.status === "fulfilled") items.push(...b.value);
            else errors.push(String(b.reason?.message || b.reason));
          }
          if (!items.length && errors.length === batches.length) {
            throw new Error(errors.slice(0, 3).join("; "));
          }
          return items;
        }

        const json = await readJson(
          fetchImpl,
          allFeedUrl(base, cfg.authCode, Math.max(perFeedLimit, 200)),
          controller.signal,
        );
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
