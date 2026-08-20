import type { NewsItem } from "./schema.js";

function coverageKey(n: NewsItem): string {
  return `${n.source}::${n.institution}`;
}

/** 云端/本机微信源失败或 0 条时，保留已有快照里当天的微信条目，避免一键更新冲掉公众号。 */
export function mergeWechatNews(
  incoming: NewsItem[],
  previous: NewsItem[] | undefined,
  wechatOkWithItems: boolean,
): NewsItem[] {
  const rest = incoming.filter((n) => n.source !== "wechat");
  const freshWx = incoming.filter((n) => n.source === "wechat");
  if (wechatOkWithItems && freshWx.length > 0) {
    return [...rest, ...freshWx];
  }
  const oldWx = (previous ?? []).filter((n) => n.source === "wechat");
  return [...rest, ...oldWx];
}

/**
 * 某来源+机构本次 0 条时，保留当天已有条目。
 * 海外 Worker 常抓不到华夏/华泰官网，避免一键更新把它们冲掉。
 */
export function keepUncoveredNews(
  incoming: NewsItem[],
  previous: NewsItem[] | undefined,
): NewsItem[] {
  const prev = previous ?? [];
  const covered = new Set(incoming.map(coverageKey));
  const kept = prev.filter((n) => !covered.has(coverageKey(n)));
  return [...incoming, ...kept];
}
