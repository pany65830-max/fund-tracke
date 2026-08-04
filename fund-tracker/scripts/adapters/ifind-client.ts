const DEFAULT_BASE = "https://quantapi.51ifind.com/api/v1";

export type IfindJson = {
  errorcode?: number;
  errorCode?: number;
  errmsg?: string;
  errorMsg?: string;
  data?: { access_token?: string };
  tables?: unknown;
  [k: string]: unknown;
};

export function getIfindBase(): string {
  return (process.env.IFIND_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function networkHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && "cause" in err && err.cause
      ? ` cause=${String(err.cause)}`
      : "";
  return `${msg}${cause}（若在 GitHub Actions：海外节点常无法访问 quantapi.51ifind.com，请本机拉数后推送 data/）`;
}

/** Exchange refresh_token for short-lived access_token (valid ~7 days). */
export async function getAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const refresh =
    process.env.IFIND_REFRESH_TOKEN || process.env.IFIND_TOKEN || "";
  if (!refresh) {
    throw new Error("IFIND_REFRESH_TOKEN missing");
  }
  const url = `${getIfindBase()}/get_access_token`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        refresh_token: refresh,
      },
    });
  } catch (e) {
    throw new Error(`get_access_token network: ${networkHint(e)}`);
  }
  const text = await res.text();
  let json: IfindJson;
  try {
    json = JSON.parse(text) as IfindJson;
  } catch {
    throw new Error(`get_access_token invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = json.errorcode ?? json.errorCode ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(
      `get_access_token failed: ${json.errmsg || json.errorMsg || text.slice(0, 200)}`,
    );
  }
  const token = json.data?.access_token;
  if (!token) throw new Error("get_access_token: access_token empty");
  return token;
}

export async function ifindPost(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IfindJson> {
  const url = `${getIfindBase()}/${path.replace(/^\//, "")}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: accessToken,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`${path} network: ${networkHint(e)}`);
  }
  const text = await res.text();
  let json: IfindJson;
  try {
    json = JSON.parse(text) as IfindJson;
  } catch {
    throw new Error(`${path} invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = json.errorcode ?? json.errorCode ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(
      `${path} failed: ${json.errmsg || json.errorMsg || `code=${code}`}`,
    );
  }
  return json;
}

/** Map A-share ETF numeric code to THS code. */
export function toThsCode(code: string): string {
  const c = code.replace(/\.(SH|SZ)$/i, "");
  if (c.startsWith("5") || c.startsWith("6") || c.startsWith("000")) {
    return `${c}.SH`;
  }
  return `${c}.SZ`;
}

export function bareCode(thscode: string): string {
  return thscode.replace(/\.(SH|SZ)$/i, "");
}

/** Flatten common iFinD `tables` shapes into row objects. */
export function flattenTables(tables: unknown): Record<string, unknown>[] {
  if (!tables) return [];
  if (!Array.isArray(tables)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const table of tables) {
    if (!table || typeof table !== "object") continue;
    const t = table as Record<string, unknown>;
    const thscode = String(t.thscode || t.THSCODE || "");
    const keys = Object.keys(t).filter((k) => k !== "thscode" && k !== "THSCODE");
    const arrayKeys = keys.filter((k) => Array.isArray(t[k]));
    if (arrayKeys.length) {
      const n = Math.max(
        ...arrayKeys.map((k) => (t[k] as unknown[]).length),
        1,
      );
      for (let i = 0; i < n; i++) {
        const row: Record<string, unknown> = { thscode };
        for (const k of keys) {
          const v = t[k];
          row[k] = Array.isArray(v) ? v[i] : v;
        }
        rows.push(row);
      }
    } else {
      rows.push({ ...t, thscode });
    }
  }
  return rows;
}

export function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return 0;
}
