import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

type SourceCfg = {
  institution: Institution;
  name: string;
  listUrl: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

const NAV_JUNK =
  /^(English|APP下载?|微博微信?|简中|一网通办|投资者服务|首页|登录|注册|更多|返回|下载|关于我们|联系我们|网站地图|隐私|声明)/i;

function loadSources(): SourceCfg[] {
  const path = join(__dirname, "../../config/exchange-sources.json");
  return JSON.parse(readFileSync(path, "utf8")) as SourceCfg[];
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Keep announcement-like links; drop homepage nav chrome. */
export function isLikelyNewsLink(title: string, url: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length < 8) return false;
  if (NAV_JUNK.test(t)) return false;
  if (/简中\s*EN/i.test(t)) return false;

  let path = "";
  try {
    const u = new URL(url);
    path = u.pathname.replace(/\/+$/, "");
    if (!path || path === "") return false;
  } catch {
    return false;
  }

  const blob = `${path} ${t}`.toLowerCase();
  if (
    /disclosure|announc|bulletin|notice|news|info|通告|公告|通知|资讯|监管|披露/.test(
      blob,
    )
  ) {
    return true;
  }

  // Require a deeper path + enough Chinese for a real headline
  const depth = path.split("/").filter(Boolean).length;
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return depth >= 2 && cn >= 10;
}

/** Extract <a href> pairs; demo-friendly regex parser. */
export function parseAnchorLinks(
  html: string,
  baseUrl: string,
  institution: Institution,
  tradeDate: string,
): NewsItem[] {
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const url = absolutize(href, baseUrl);
    if (!url || seen.has(url)) continue;
    if (!isLikelyNewsLink(title, url)) continue;
    seen.add(url);
    out.push({
      id: `ex-${institution}-${out.length}-${tradeDate}`,
      title,
      summary: title,
      institution,
      category: "exchange",
      source: "exchange_web",
      publishedAt: `${tradeDate}T08:00:00+08:00`,
      sourceUrl: url,
    });
  }
  return out;
}

export function createExchangeWebAdapter(
  fetchImpl: typeof fetch = fetch,
): NewsAdapter {
  return {
    name: "exchange-web",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const items: NewsItem[] = [];
      const errors: string[] = [];
      for (const src of loadSources()) {
        try {
          const res = await fetchImpl(src.listUrl);
          if (!res.ok) {
            errors.push(`${src.institution} HTTP ${res.status}`);
            continue;
          }
          const html = await res.text();
          items.push(
            ...parseAnchorLinks(html, src.listUrl, src.institution, tradeDate),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${src.institution} ${msg}`);
        }
      }
      if (!items.length && errors.length) {
        throw new Error(errors.join("; "));
      }
      return items;
    },
  };
}
