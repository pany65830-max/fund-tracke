import type { Institution, NewsCategory, NewsItem } from "./schema";

export function filterNews(
  items: NewsItem[],
  opts: {
    institution: Institution | "all";
    category: NewsCategory | "all";
    /** 只保留 publishedAt 以此前缀开头的资讯（解决数据文件混日期问题） */
    tradeDate?: string;
  },
): NewsItem[] {
  return items.filter((n) => {
    if (opts.institution !== "all" && n.institution !== opts.institution) return false;
    if (opts.category !== "all" && n.category !== opts.category) return false;
    if (opts.tradeDate && !n.publishedAt.startsWith(opts.tradeDate)) return false;
    return true;
  });
}
