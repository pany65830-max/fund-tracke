import type { EtfDashboard, Institution } from "../../shared/schema.js";
import type { EtfAdapter } from "./types.js";
import { pickEtfDisplayName } from "../../shared/etf-name.js";
import {
  asNumber,
  bareCode,
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
  { code: "399006", ths: "399006.SZ", name: "创业板指" },
  { code: "000688", ths: "000688.SH", name: "科创50" },
  { code: "000016", ths: "000016.SH", name: "上证50" },
];

/** 板块主题 → 白名单内成分代码。changePct 取成分产品真实涨跌幅均值。 */
const SECTORS: Array<{ name: string; codes: string[] }> = [
  { name: "宽基ETF", codes: ["510300", "510050", "510310", "588000", "588090", "512500"] },
  { name: "港股/中概", codes: ["513130", "510900"] },
  { name: "银行", codes: ["512800"] },
  { name: "军工", codes: ["512660"] },
  { name: "半导体", codes: ["512760"] },
  { name: "新能源", codes: ["515030"] },
  { name: "通信", codes: ["515880"] },
  { name: "红利", codes: ["510880"] },
  { name: "创业板", codes: ["159915"] },
  { name: "深证100", codes: ["159901"] },
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
          amplitude: asNumber(row.amplitude) || undefined,
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
          indicators: "latest,changeRatio,preClose,amount,volume,amplitude,shortName",
        },
        accessToken,
        fetchImpl,
      );

      // real_time_quotation 把数值包在 tables[].table.{field:[v]} 里，
      // flattenTables 不会下钻 table，这里手动按首元素提取标量。
      const byCode = new Map<string, Record<string, unknown>>();
      for (const t of (json.tables as Array<Record<string, unknown>>) || []) {
        const ths = String(t.thscode || "");
        const tbl = (t.table as Record<string, unknown>) || {};
        const first = (k: string): unknown =>
          Array.isArray(tbl[k]) ? (tbl[k] as unknown[])[0] : tbl[k];
        const rec: Record<string, unknown> = {
          thscode: ths,
          latest: first("latest"),
          changeRatio: first("changeRatio"),
          preClose: first("preClose"),
          amount: first("amount"),
          volume: first("volume"),
          amplitude: first("amplitude"),
          shortName: first("shortName"),
        };
        byCode.set(bareCode(ths), rec);
        byCode.set(ths, rec);
      }

      // 涨跌幅：直接用 latest/preClose 计算（最稳，避免 changeRatio 缩放歧义）。
      // 个别标的无 preClose 时回退到 changeRatio（iFinD 已为百分比）。
      const calcChangePct = (row: Record<string, unknown>): number => {
        const latest = asNumber(row.latest);
        const preClose = asNumber(row.preClose);
        if (latest && preClose) return ((latest - preClose) / preClose) * 100;
        return asNumber(row.changeRatio);
      };

      const indices = INDEX_LIST.map((idx) => {
        const row = byCode.get(idx.code) || byCode.get(idx.ths) || {};
        return {
          code: idx.code,
          name: idx.name,
          last: asNumber(row.latest),
          changePct: +calcChangePct(row).toFixed(2),
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
        const changePct = +calcChangePct(row).toFixed(2);
        const amountYi = yuanToYi(asNumber(row.amount));
        const name = pickEtfDisplayName(
          code,
          String(row.shortName || ""),
          names.get(code),
        );
        productsByFirm[firm] = productsByFirm[firm] || [];
        productsByFirm[firm].push({
          code,
          name,
          changePct,
          amount: +amountYi.toFixed(2),
          nav: asNumber(row.latest) || undefined,
          amplitude: asNumber(row.amplitude) || undefined,
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

      const sectors = SECTORS.map((s) => {
        const members = s.codes
          .map((c) => byCode.get(c))
          .filter((r): r is Record<string, unknown> => !!r);
        if (!members.length) return null;
        const avg =
          members.reduce((a, r) => a + calcChangePct(r), 0) / members.length;
        return { name: s.name, changePct: +avg.toFixed(2) };
      }).filter(
        (x): x is { name: string; changePct: number } => x !== null,
      );

      return {
        indices,
        sectors,
        hotInflow,
        hotGainers,
        hotTurnover,
        productsByFirm,
      };
    },
  };
}
