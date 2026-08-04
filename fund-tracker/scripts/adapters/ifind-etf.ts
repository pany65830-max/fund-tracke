import type { EtfDashboard, Institution } from "../../shared/schema.js";
import type { EtfAdapter } from "./types.js";
import {
  asNumber,
  bareCode,
  flattenTables,
  getAccessToken,
  ifindPost,
  loadCodesFromWhitelist,
  loadWhitelist,
  toThsCode,
} from "./ifind-shared.js";

export { loadWhitelist };

const INDEX_LIST = [
  { code: "000300", ths: "000300.SH", name: "沪深300" },
  { code: "000905", ths: "000905.SH", name: "中证500" },
];

/** Keep for unit tests / fixture-style payloads. */
export function mapIfindEtfPayload(
  payload: Record<string, unknown>,
  whitelist = loadWhitelist(),
): EtfDashboard {
  const { codeFirm } = loadCodesFromWhitelist();
  const allowed = new Set(
    Object.values(whitelist)
      .flat()
      .map((p) => p.code),
  );
  const productsByFirm: EtfDashboard["productsByFirm"] = {
    huaxia: [],
    efunds: [],
    guotai: [],
    huatai: [],
  };
  for (const row of (payload.products as Record<string, unknown>[]) || []) {
    const code = String(row.code || "");
    if (!allowed.has(code)) continue;
    const firm = (codeFirm.get(code) || "huatai") as Institution;
    productsByFirm[firm] = productsByFirm[firm] || [];
    productsByFirm[firm].push({
      code,
      name: String(row.name || code),
      changePct: asNumber(row.changePct),
      amount: asNumber(row.amount),
      nav: asNumber(row.nav) || undefined,
    });
  }
  return {
    indices: ((payload.indices as Record<string, unknown>[]) || []).map((r) => ({
      code: String(r.code || ""),
      name: String(r.name || ""),
      last: asNumber(r.last),
      changePct: asNumber(r.changePct),
    })),
    sectors: ((payload.sectors as Record<string, unknown>[]) || []).map((r) => ({
      name: String(r.name || ""),
      changePct: asNumber(r.changePct),
    })),
    hotInflow: [],
    hotGainers: [],
    hotTurnover: [],
    productsByFirm,
  };
}

function normalizeChangePct(v: number): number {
  if (Math.abs(v) > 0 && Math.abs(v) < 0.5) return v * 100;
  return v;
}

function yuanToYi(v: number): number {
  if (!v) return 0;
  if (Math.abs(v) < 1000) return v;
  return v / 1e8;
}

export function createIfindEtfAdapter(
  fetchImpl: typeof fetch = fetch,
): EtfAdapter {
  return {
    name: "ifind-etf",
    async fetchEtf(_tradeDate: string): Promise<EtfDashboard> {
      const { codes, names, codeFirm } = loadCodesFromWhitelist();
      const accessToken = await getAccessToken(fetchImpl);
      const thsCodes = [
        ...INDEX_LIST.map((i) => i.ths),
        ...codes.map(toThsCode),
      ].join(",");

      const json = await ifindPost(
        "real_time_quotation",
        {
          codes: thsCodes,
          indicators: "latest,changeRatio,amount,volume,shortName",
        },
        accessToken,
        fetchImpl,
      );

      const rows = flattenTables(json.tables);
      const byCode = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const ths = String(row.thscode || "");
        byCode.set(bareCode(ths), row);
        byCode.set(ths, row);
      }

      const indices = INDEX_LIST.map((idx) => {
        const row = byCode.get(idx.code) || byCode.get(idx.ths) || {};
        return {
          code: idx.code,
          name: idx.name,
          last: asNumber(row.latest),
          changePct: normalizeChangePct(asNumber(row.changeRatio)),
        };
      });

      const productsByFirm: EtfDashboard["productsByFirm"] = {
        huaxia: [],
        efunds: [],
        guotai: [],
        huatai: [],
      };

      const flatProducts: Array<{
        code: string;
        name: string;
        institution: Institution;
        changePct: number;
        amountYi: number;
      }> = [];

      for (const code of codes) {
        const row = byCode.get(code) || {};
        const firm = codeFirm.get(code) || "huatai";
        const changePct = normalizeChangePct(asNumber(row.changeRatio));
        const amountYi = yuanToYi(asNumber(row.amount));
        const name = String(row.shortName || "") || names.get(code) || code;
        productsByFirm[firm] = productsByFirm[firm] || [];
        productsByFirm[firm].push({
          code,
          name,
          changePct,
          amount: +amountYi.toFixed(2),
          nav: asNumber(row.latest) || undefined,
        });
        flatProducts.push({
          code,
          name,
          institution: firm,
          changePct,
          amountYi,
        });
      }

      const hotGainers = [...flatProducts]
        .sort((a, b) => b.changePct - a.changePct)
        .slice(0, 5)
        .map((p) => ({
          code: p.code,
          name: p.name,
          institution: p.institution,
          value: +p.changePct.toFixed(2),
          unit: "pct" as const,
        }));

      const hotTurnover = [...flatProducts]
        .sort((a, b) => b.amountYi - a.amountYi)
        .slice(0, 5)
        .map((p) => ({
          code: p.code,
          name: p.name,
          institution: p.institution,
          value: +p.amountYi.toFixed(2),
          unit: "yi_amount" as const,
        }));

      const hotInflow = hotTurnover.map((p) => ({
        ...p,
        unit: "yi" as const,
      }));

      return {
        indices,
        sectors: [],
        hotInflow,
        hotGainers,
        hotTurnover,
        productsByFirm,
      };
    },
  };
}
