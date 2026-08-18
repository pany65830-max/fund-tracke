import type { DaySnapshot } from "./schema";

/** 用户在前端填写的「中间人 + iFinD token」设置，只存在浏览器 localStorage。 */
export interface LiveSettings {
  workerUrl: string;
  token: string;
}

const KEY = "fund-tracker-live";

export function loadSettings(): LiveSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as LiveSettings;
  } catch {
    /* ignore */
  }
  return { workerUrl: "", token: "" };
}

export function saveSettings(s: LiveSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSettings(): void {
  localStorage.removeItem(KEY);
}

/**
 * 通过 Cloudflare 中间人拉取最新 iFinD 数据。
 * worker 端用北京日期作为 tradeDate（行情为实时，资讯按该日回溯 7 天）。
 * 返回的正是与 data/*.json 同构的 DaySnapshot，可直接覆盖前端当前 snap。
 */
export async function fetchLive(s: LiveSettings): Promise<DaySnapshot> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: s.token }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("中间人返回的不是 JSON");
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as DaySnapshot;
}

export interface PublishResult {
  date: string;
  files: string[];
}

/**
 * 同 fetchLive，但额外让 Worker 把数据写回 GitHub 仓库（data/*.json + latest.json + dates.json），
 * 从而触发 Pages 重新部署，使线上所有人都能看到最新数据。
 */
export async function publishLive(
  s: LiveSettings,
): Promise<DaySnapshot & { published?: PublishResult }> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: s.token, publish: true }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("中间人返回的不是 JSON");
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as DaySnapshot & { published?: PublishResult };
}

/**
 * 全量云端 ingest：Worker 拉取 ETF 实时行情 + 基金公司官网/微信搜狗/巨潮/上交所搜索等全部资讯，
 * 写回 GitHub 触发 Pages 部署。这是给同事用的「一键更新」主入口。
 */
export async function ingestAndPublish(
  s: LiveSettings,
): Promise<DaySnapshot & { published?: PublishResult }> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: s.token, publish: true }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("中间人返回的不是 JSON");
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data as DaySnapshot & { published?: PublishResult };
}
