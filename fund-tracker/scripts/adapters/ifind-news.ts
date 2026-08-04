import type { Institution, NewsItem } from "../../shared/schema.js";
import { classifyNews } from "../../shared/classify.js";
import type { NewsAdapter } from "./types.js";

type Row = Record<string, unknown>;

function pick(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function mapInstitution(raw: string): Institution {
  const s = raw.toLowerCase();
  if (s.includes("华夏") || s.includes("huaxia")) return "huaxia";
  if (s.includes("易方达") || s.includes("efund")) return "efunds";
  if (s.includes("国泰") || s.includes("guotai")) return "guotai";
  if (s.includes("华泰") || s.includes("huatai")) return "huatai";
  if (s.includes("上交") || s.includes("sse")) return "sse";
  if (s.includes("深交") || s.includes("szse")) return "szse";
  return "huatai";
}

export function mapIfindNewsRow(row: Row, tradeDate: string, idx: number): NewsItem {
  const title = pick(row, "标题", "title", "Title");
  const summary = pick(row, "摘要", "summary", "Summary");
  const body = pick(row, "正文", "body", "Content") || undefined;
  const sourceUrl =
    pick(row, "链接", "url", "Url", "sourceUrl") || "https://example.com/ifind-missing";
  const institution = mapInstitution(
    pick(row, "机构", "institution", "公司", "company") || "华泰柏瑞",
  );
  const publishedAt =
    pick(row, "时间", "publishedAt", "datetime") || `${tradeDate}T08:00:00+08:00`;
  const category = classifyNews({ title, summary, institution });
  return {
    id: pick(row, "id", "ID") || `ifind-news-${idx}-${tradeDate}`,
    title: title || `未命名资讯-${idx}`,
    summary,
    body: body || undefined,
    institution,
    category,
    source: "ifind",
    publishedAt,
    sourceUrl,
  };
}

export function createIfindNewsAdapter(
  fetchImpl: typeof fetch = fetch,
): NewsAdapter {
  return {
    name: "ifind-news",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const token = process.env.IFIND_TOKEN;
      if (!token) throw new Error("IFIND_TOKEN missing");
      const base = process.env.IFIND_BASE_URL || "";
      const path = process.env.IFIND_NEWS_PATH || "/api/news";
      const url = new URL(path, base.endsWith("/") ? base : base + "/");
      url.searchParams.set("date", tradeDate);
      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`ifind-news HTTP ${res.status}`);
      const data = (await res.json()) as { rows?: Row[] } | Row[];
      const rows = Array.isArray(data) ? data : data.rows || [];
      return rows.map((r, i) => mapIfindNewsRow(r, tradeDate, i));
    },
  };
}
