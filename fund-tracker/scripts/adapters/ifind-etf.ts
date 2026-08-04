import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EtfDashboard, Institution } from "../../shared/schema.js";
import type { EtfAdapter } from "./types.js";

type Whitelist = Record<string, Array<{ code: string; name: string }>>;
type Row = Record<string, unknown>;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadWhitelist(): Whitelist {
  const path = join(__dirname, "../../config/etf-whitelist.json");
  return JSON.parse(readFileSync(path, "utf8")) as Whitelist;
}

function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const FIRMS: Institution[] = ["huaxia", "efunds", "guotai", "huatai"];

/** Map a loose iFind ETF payload into EtfDashboard, filtered by whitelist codes. */
export function mapIfindEtfPayload(payload: Row, whitelist: Whitelist): EtfDashboard {
  const allowed = new Set(
    Object.values(whitelist)
      .flat()
      .map((p) => p.code),
  );
  const codeToFirm = new Map<string, Institution>();
  for (const firm of FIRMS) {
    for (const p of whitelist[firm] || []) {
      codeToFirm.set(p.code, firm);
    }
  }

  const indicesRaw = (payload.indices as Row[]) || [];
  const sectorsRaw = (payload.sectors as Row[]) || [];
  const productsRaw = (payload.products as Row[]) || [];

  const productsByFirm: EtfDashboard["productsByFirm"] = {
    huaxia: [],
    efunds: [],
    guotai: [],
    huatai: [],
  };

  for (const row of productsRaw) {
    const code = str(row, "code", "代码");
    if (!allowed.has(code)) continue;
    const firm = codeToFirm.get(code) || "huatai";
    productsByFirm[firm] = productsByFirm[firm] || [];
    productsByFirm[firm].push({
      code,
      name: str(row, "name", "名称") || code,
      changePct: num(row, "changePct", "涨跌幅"),
      amount: num(row, "amount", "成交额"),
      shares: num(row, "shares", "份额"),
      nav: num(row, "nav", "净值") || undefined,
    });
  }

  const rank = (rows: Row[], unit: "yi" | "pct" | "yi_amount") =>
    (rows || [])
      .map((row) => {
        const code = str(row, "code", "代码");
        return {
          code,
          name: str(row, "name", "名称") || code,
          institution: (codeToFirm.get(code) || "huatai") as Institution,
          value: num(row, "value", "数值"),
          unit,
        };
      })
      .filter((r) => allowed.has(r.code));

  return {
    indices: indicesRaw.map((row) => ({
      code: str(row, "code", "代码"),
      name: str(row, "name", "名称"),
      last: num(row, "last", "点位"),
      changePct: num(row, "changePct", "涨跌幅"),
    })),
    sectors: sectorsRaw.map((row) => ({
      name: str(row, "name", "名称"),
      changePct: num(row, "changePct", "涨跌幅"),
    })),
    hotInflow: rank((payload.hotInflow as Row[]) || [], "yi"),
    hotGainers: rank((payload.hotGainers as Row[]) || [], "pct"),
    hotTurnover: rank((payload.hotTurnover as Row[]) || [], "yi_amount"),
    productsByFirm,
  };
}

export function createIfindEtfAdapter(
  whitelist: Whitelist = loadWhitelist(),
  fetchImpl: typeof fetch = fetch,
): EtfAdapter {
  return {
    name: "ifind-etf",
    async fetchEtf(tradeDate: string): Promise<EtfDashboard> {
      const token = process.env.IFIND_TOKEN;
      if (!token) throw new Error("IFIND_TOKEN missing");
      const base = process.env.IFIND_BASE_URL || "";
      const path = process.env.IFIND_ETF_PATH || "/api/etf";
      const url = new URL(path, base.endsWith("/") ? base : base + "/");
      url.searchParams.set("date", tradeDate);
      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`ifind-etf HTTP ${res.status}`);
      const data = (await res.json()) as Row;
      return mapIfindEtfPayload(data, whitelist);
    },
  };
}
