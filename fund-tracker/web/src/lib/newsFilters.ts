import type { Institution, NewsCategory, NewsItem } from "./schema";

export function filterNews(
  items: NewsItem[],
  opts: { institution: Institution | "all"; category: NewsCategory | "all" },
): NewsItem[] {
  return items.filter((n) => {
    if (opts.institution !== "all" && n.institution !== opts.institution) return false;
    if (opts.category !== "all" && n.category !== opts.category) return false;
    return true;
  });
}
