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
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}`;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

function timestamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 统一的资讯过滤 + 去重 + 排序入口。
 * 1) 按机构/类型/日期(北京时间)过滤；
 * 2) 按「机构 + 标题」去重（历史上微信分页会带回同一条文章多次）；
 * 3) 按发布时间倒序。
 * 这样无论底层数据是否混日/重复，列表永远只展示所选日期、且不重复的资讯。
 */
export function filterNews(
  items: NewsItem[],
  opts: {
    institution: Institution | "all";
    category: NewsCategory | "all";
    tradeDate?: string;
  },
): NewsItem[] {
  const filtered = items.filter((n) => {
    if (opts.institution !== "all" && n.institution !== opts.institution) return false;
    if (opts.category !== "all" && n.category !== opts.category) return false;
    if (opts.tradeDate && beijingDate(n.publishedAt) !== opts.tradeDate) return false;
    return true;
  });

  const seen = new Map<string, NewsItem>();
  for (const n of filtered) {
    const key = `${n.institution}::${normalizeTitle(n.title)}`;
    const prev = seen.get(key);
    // 同机构同标题只留一条（保留发布时间更早的那条）
    if (!prev || timestamp(n.publishedAt) < timestamp(prev.publishedAt)) {
      seen.set(key, n);
    }
  }

  return [...seen.values()].sort(
    (a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt),
  );
}
