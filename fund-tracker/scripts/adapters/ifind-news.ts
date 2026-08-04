import type { Institution, NewsItem } from "../../shared/schema.js";
import { classifyNews } from "../../shared/classify.js";
import type { NewsAdapter } from "./types.js";
import {
  bareCode,
  flattenTables,
  getAccessToken,
  ifindPost,
  loadCodesFromWhitelist,
  toThsCode,
} from "./ifind-shared.js";

function mapInstitutionByCode(
  code: string,
  codeFirm: Map<string, Institution>,
): Institution {
  return codeFirm.get(bareCode(code)) || codeFirm.get(code) || "huatai";
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function mapIfindNewsRow(
  row: Record<string, unknown>,
  tradeDate: string,
  idx: number,
): NewsItem {
  const title = String(row.reportTitle || row.title || row.标题 || "").trim();
  const summary = String(row.secName || row.摘要 || row.summary || "");
  const body = String(row.body || row.正文 || "") || undefined;
  const pdf = String(row.pdfURL || row.pdfUrl || row.链接 || row.url || "").trim();
  const sourceUrl = pdf.startsWith("http")
    ? pdf
    : pdf
      ? `https://${pdf}`
      : "https://www.51ifind.com/";
  const thscode = String(row.thscode || row.机构 || "");
  const { codeFirm } = loadCodesFromWhitelist();
  const institution = mapInstitutionByCode(thscode, codeFirm);
  return {
    id: String(row.seq || row.id || `ifind-news-${idx}-${tradeDate}`),
    title: title || `未命名资讯-${idx}`,
    summary,
    body: body || undefined,
    institution,
    category: classifyNews({ title, summary, institution }),
    source: "ifind",
    publishedAt: String(
      row.ctime || row.时间 || row.publishedAt || `${tradeDate}T08:00:00+08:00`,
    ),
    sourceUrl,
  };
}

export function mapReportRow(
  row: Record<string, unknown>,
  tradeDate: string,
  idx: number,
  codeFirm: Map<string, Institution>,
): NewsItem | null {
  const title = String(row.reportTitle || row.title || "").trim();
  if (!title) return null;
  const thscode = String(row.thscode || row.THSCODE || "");
  const institution = mapInstitutionByCode(thscode, codeFirm);
  const pdf = String(row.pdfURL || row.pdfUrl || "").trim();
  const sourceUrl = pdf.startsWith("http")
    ? pdf
    : pdf
      ? `https://${pdf}`
      : "https://www.51ifind.com/";
  const summary = String(row.secName || title);
  return {
    id: String(row.seq || `ifind-rpt-${idx}-${tradeDate}`),
    title,
    summary,
    institution,
    category: classifyNews({ title, summary, institution }),
    source: "ifind",
    publishedAt: String(
      row.ctime || row.reportDate || `${tradeDate}T08:00:00+08:00`,
    ),
    sourceUrl,
  };
}

export function createIfindNewsAdapter(
  fetchImpl: typeof fetch = fetch,
): NewsAdapter {
  return {
    name: "ifind-news",
    async fetchNews(tradeDate: string): Promise<NewsItem[]> {
      const { codes, codeFirm } = loadCodesFromWhitelist();
      if (!codes.length) return [];
      const accessToken = await getAccessToken(fetchImpl);
      const begin = addDays(tradeDate, -7);
      const json = await ifindPost(
        "report_query",
        {
          codes: codes.map(toThsCode).join(","),
          functionpara: { reportType: "901" },
          beginrDate: begin,
          endrDate: tradeDate,
          outputpara:
            "reportDate:Y,thscode:Y,secName:Y,ctime:Y,reportTitle:Y,pdfURL:Y,seq:Y",
        },
        accessToken,
        fetchImpl,
      );
      const rows = flattenTables(json.tables);
      const items: NewsItem[] = [];
      rows.forEach((row, idx) => {
        const item = mapReportRow(row, tradeDate, idx, codeFirm);
        if (item) items.push(item);
      });
      return items;
    },
  };
}
