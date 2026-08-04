import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

type Account = {
  institution: Institution;
  name: string;
  accountId: string;
  feedUrl: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAccounts(): Account[] {
  const path = join(__dirname, "../../config/wechat-accounts.json");
  return JSON.parse(readFileSync(path, "utf8")) as Account[];
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
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
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
      category: institution === "sse" || institution === "szse" ? "exchange" : "other",
      source: "wechat",
      publishedAt: `${tradeDate}T08:00:00+08:00`,
      sourceUrl: url,
    });
  }
  return items;
}

export function createWechatAdapter(
  fetchImpl: typeof fetch = fetch,
): NewsAdapter {
  return {
    name: "wechat",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const out: NewsItem[] = [];
      for (const acc of loadAccounts()) {
        if (!acc.feedUrl) continue;
        const res = await fetchImpl(acc.feedUrl);
        if (!res.ok) {
          throw new Error(`wechat ${acc.institution} HTTP ${res.status}`);
        }
        const xml = await res.text();
        out.push(...parseRssItems(xml, acc.institution, tradeDate));
      }
      return out;
    },
  };
}
