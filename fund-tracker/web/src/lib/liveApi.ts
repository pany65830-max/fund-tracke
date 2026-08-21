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

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "连不上中间人（Failed to fetch）。国内网络经常访问不了 workers.dev，请改用本机每天 08:30 自动更新，或检查齿轮里的 Worker 地址是否填对。",
    );
  }
}

async function readSnapshot(res: Response): Promise<DaySnapshot> {
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

export async function fetchLive(s: LiveSettings): Promise<DaySnapshot> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await postJson(`${base}/refresh`, { token: s.token });
  return readSnapshot(res);
}

export interface PublishResult {
  date: string;
  files: string[];
}

export async function publishLive(
  s: LiveSettings,
): Promise<DaySnapshot & { published?: PublishResult }> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await postJson(`${base}/refresh`, {
    token: s.token,
    publish: true,
  });
  return (await readSnapshot(res)) as DaySnapshot & { published?: PublishResult };
}

export async function ingestAndPublish(
  s: LiveSettings,
): Promise<DaySnapshot & { published?: PublishResult }> {
  const base = s.workerUrl.replace(/\/+$/, "");
  const res = await postJson(`${base}/ingest`, { token: s.token, publish: true });
  return (await readSnapshot(res)) as DaySnapshot & { published?: PublishResult };
}
