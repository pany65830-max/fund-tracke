import type { Institution, NewsCategory, NewsItem } from "./schema";

/** 取 publishedAt 对应的北京时间日期（YYYY-MM-DD），用于按「交易日」精确过滤。 */
function beijingDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function filterNews(
  items: NewsItem[],
  opts: {
    institution: Institution | "all";
    category: NewsCategory | "all";
    /** 只保留「北京时间发布日期=当日」的资讯（解决数据文件混日期问题） */
    tradeDate?: string;
  },
): NewsItem[] {
  return items.filter((n) => {
    if (opts.institution !== "all" && n.institution !== opts.institution) return false;
    if (opts.category !== "all" && n.category !== opts.category) return false;
    if (opts.tradeDate && beijingDate(n.publishedAt) !== opts.tradeDate) return false;
    return true;
  });
}
