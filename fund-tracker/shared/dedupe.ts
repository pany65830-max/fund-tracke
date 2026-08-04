import type { NewsItem } from "./schema.js";

export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

function score(item: NewsItem): number {
  let s = 0;
  if (item.body && item.body.length > 0) s += 100 + item.body.length;
  if (item.source === "ifind") s += 10;
  return s;
}

/** Same institution + normalized title; keep richer body, prefer ifind. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const map = new Map<string, NewsItem>();
  for (const item of items) {
    const key = `${item.institution}::${normalizeTitle(item.title)}`;
    const prev = map.get(key);
    if (!prev || score(item) > score(prev)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}
