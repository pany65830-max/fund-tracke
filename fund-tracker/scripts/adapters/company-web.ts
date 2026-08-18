import type { Institution, NewsItem } from "../../shared/schema.js";
import type { NewsAdapter } from "./types.js";

export type SourceCfg = {
  institution: Institution;
  name: string;
  listUrl: string;
};

/** 默认从本地 config/company-sources.json 加载；在 Cloudflare Worker 等无 import.meta.url
 *  的环境，必须由调用方显式传入 sources。 */
async function loadSources(): Promise<SourceCfg[]> {
  const url = typeof import.meta.url === "string" ? import.meta.url : undefined;
  if (!url) {
    throw new Error(
      "company-web adapter: import.meta.url unavailable. Pass sources explicitly.",
    );
  }
  const [{ readFileSync }, { dirname, join }, { fileURLToPath }] =
    await Promise.all([
      import("node:fs"),
      import("node:path"),
      import("node:url"),
    ]);
  const __dirname = dirname(fileURLToPath(url));
  const path = join(__dirname, "../../config/company-sources.json");
  return JSON.parse(readFileSync(path, "utf8")) as SourceCfg[];
}

// Nav chrome / boilerplate that should never be treated as a news article.
const NAV_JUNK =
  /^(English|APP下载?|微博微信?|简中|一网通办|投资者服务|首页|登录|注册|更多|返回|下载|关于我们|联系我们|网站地图|隐私|声明|企业年金|基金经理|基中基|养老目标|风险揭示|适当性|隐私政策|反洗钱|应急处理|销售机构|你好|客服|搜索|English)/i;

// Static / boilerplate documents that are not time-sensitive announcements.
const BOILERPLATE =
  /法律法规|规则说明|信息公示|公示表|销售人员|采购项目|投资者须知|风险揭示书|客户隐私|网站地图|常见问题|帮助中心|服务协议/;

const POS_KW =
  /公告|披露|新闻|资讯|风险|溢价|ETF|基金|报告|提示|上市|募集|成立|分红|清算|终止|暂停|恢复|招募|发售|发行|净值|评级|分红|中报|年报|季报/;

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Normalize a year/month/day triple to YYYY-MM-DD. */
function normDate(y: string, mo: string, d: string): string {
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Best-effort extraction of YYYY-MM-DD from title text or URL. */
export function extractDate(text: string, url: string): string | null {
  let m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return normDate(m[1], m[2], m[3]);
  let u = "";
  try {
    u = new URL(url).pathname + new URL(url).search;
  } catch {
    u = url;
  }
  m = u.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return normDate(m[1], m[2], m[3]);
  m = u.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return normDate(m[1], m[2], m[3]);
  return null;
}

/** True for anchors that look like a real announcement / news article. */
export function isLikelyCompanyNews(title: string, url: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length < 6) return false;
  if (NAV_JUNK.test(t)) return false;
  if (BOILERPLATE.test(t)) return false;

  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    path = "";
  }
  const blob = `${path} ${t}`.toLowerCase();

  const hasTitleDate = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.test(t);
  const hasPathDate =
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(path) || /(\d{4})(\d{2})(\d{2})/.test(path);
  if (hasTitleDate || hasPathDate) return true;

  const articlePath =
    /disclosure|announc|bulletin|notice|news|info|gonggao|xxpl|\/c\/|\/contents\/|report|article|\.shtml|\.pdf/i.test(
      blob,
    );
  if (articlePath && POS_KW.test(t) && t.length >= 8) return true;
  if (POS_KW.test(t) && t.length >= 12) return true;
  return false;
}

export function parseCompanyLinks(
  html: string,
  baseUrl: string,
  institution: Institution,
  tradeDate: string,
  opts: { maxAgeDays?: number; limit?: number } = {},
): NewsItem[] {
  const maxAgeDays = opts.maxAgeDays ?? 14;
  const limit = opts.limit ?? 12;
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  let seq = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit * 3) {
    const href = m[1];
    const title = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const url = absolutize(href, baseUrl);
    if (!url || seen.has(url)) continue;
    if (!isLikelyCompanyNews(title, url)) continue;
    seen.add(url);

    const dt = extractDate(title, url);
    if (dt) {
      const ageDays =
        (Date.parse(`${tradeDate}T23:59:59+08:00`) -
          Date.parse(`${dt}T23:59:59+08:00`)) /
        86400000;
      if (ageDays < -1 || ageDays > maxAgeDays) continue;
    }
    const publishedAt = dt
      ? `${dt}T08:00:00+08:00`
      : `${tradeDate}T08:00:00+08:00`;
    out.push({
      id: `cw-${institution}-${seq++}-${tradeDate}`,
      title,
      summary: title,
      institution,
      category: "disclosure",
      source: "company_web",
      publishedAt,
      sourceUrl: url,
    });
  }
  return out.slice(0, limit);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function createCompanyWebAdapter(
  fetchImpl: typeof fetch = fetch,
  sources?: SourceCfg[],
): NewsAdapter {
  const sourcesPromise = sources ? undefined : loadSources();
  return {
    name: "company-web",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const cfg = sources ?? (await sourcesPromise!);
      const items: NewsItem[] = [];
      const errors: string[] = [];
      for (const src of cfg) {
        try {
          const res = await fetchImpl(src.listUrl, {
            headers: {
              "User-Agent": UA,
              Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
              "Accept-Language": "zh-CN,zh;q=0.9",
            },
          });
          if (!res.ok) {
            errors.push(`${src.institution} HTTP ${res.status}`);
            continue;
          }
          const html = await res.text();
          items.push(
            ...parseCompanyLinks(html, src.listUrl, src.institution, tradeDate, {
              maxAgeDays: 14,
              limit: 12,
            }),
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
