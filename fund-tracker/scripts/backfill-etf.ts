/**
 * Backfill ETF dashboard (indices + 415 products + sectors + rankings) for
 * specific PAST trading days using iFinD historical quotation.
 *
 *   npm run backfill:etf -- --date 2026-08-14 2026-08-10
 *
 * Requires IFIND_REFRESH_TOKEN (same as the daily ingest). Must run on a
 * machine that can reach quantapi.51ifind.com. News of those days is preserved;
 * only the ETF block is reconstructed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DaySnapshotSchema,
  type DaySnapshot,
  type EtfDashboard,
  type Institution,
} from "../shared/schema.js";
import {
  asNumber,
  bareCode,
  getAccessToken,
  ifindPost,
  loadCodesFromWhitelist,
  loadWhitelist,
  toThsCode,
} from "./adapters/ifind-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dataDir = join(ROOT, "data");

const INDEX_LIST = [
  { code: "000300", ths: "000300.SH", name: "沪深300" },
  { code: "000905", ths: "000905.SH", name: "中证500" },
  { code: "399006", ths: "399006.SZ", name: "创业板指" },
  { code: "000688", ths: "000688.SH", name: "科创50" },
  { code: "000016", ths: "000016.SH", name: "上证50" },
];

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

function yuanToYi(v: number): number {
  if (!v) return 0;
  if (Math.abs(v) < 1000) return v;
  return v / 1e8;
}

type ByCodeRow = Record<string, unknown>;

function extractByCode(json: {
  tables?: Array<Record<string, unknown>>;
}): Map<string, ByCodeRow> {
  const byCode = new Map<string, ByCodeRow>();
  for (const t of json.tables || []) {
    const ths = String(t.thscode || "");
    const tbl = (t.table as Record<string, unknown>) || {};
    const first = (k: string): unknown =>
      Array.isArray(tbl[k]) ? (tbl[k] as unknown[])[0] : tbl[k];
    const rec: ByCodeRow = {
      thscode: ths,
      close: first("close"),
      preClose: first("preClose"),
      open: first("open"),
      high: first("high"),
      low: first("low"),
      amount: first("amount"),
      amplitude: first("amplitude"),
      shortName: first("shortName"),
    };
    byCode.set(bareCode(ths), rec);
    byCode.set(ths, rec);
  }
  return byCode;
}

function calcChangePct(row: ByCodeRow): number {
  const close = asNumber(row.close);
  const preClose = asNumber(row.preClose);
  if (close && preClose) return +(((close - preClose) / preClose) * 100).toFixed(2);
  return 0;
}

function calcAmplitude(row: ByCodeRow): number {
  const a = asNumber(row.amplitude);
  if (a) return +a.toFixed(2);
  const high = asNumber(row.high);
  const low = asNumber(row.low);
  const preClose = asNumber(row.preClose);
  if (high && low && preClose) {
    return +(((high - low) / preClose) * 100).toFixed(2);
  }
  return 0;
}

function mapDashboard(
  byCode: Map<string, ByCodeRow>,
  codes: string[],
  names: Map<string, string>,
  codeFirm: Map<string, Institution>,
): EtfDashboard {
  const indices = INDEX_LIST.map((idx) => {
    const row = byCode.get(idx.code) || byCode.get(idx.ths) || {};
    return {
      code: idx.code,
      name: idx.name,
      last: +asNumber(row.close).toFixed(2),
      changePct: calcChangePct(row),
    };
  });

  const productsByFirm: EtfDashboard["productsByFirm"] = {
    huaxia: [],
    efunds: [],
    guotai: [],
    huatai: [],
  };
  const flat: Array<{
    code: string;
    name: string;
    institution: Institution;
    changePct: number;
    amountYi: number;
  }> = [];

  for (const code of codes) {
    const row = byCode.get(code) || {};
    const firm = codeFirm.get(code) || "huatai";
    const changePct = calcChangePct(row);
    const amountYi = yuanToYi(asNumber(row.amount));
    const name =
      String(row.shortName || "").trim() || names.get(code) || code;
    productsByFirm[firm] = productsByFirm[firm] || [];
    productsByFirm[firm].push({
      code,
      name,
      changePct,
      amount: +amountYi.toFixed(2),
      nav: +asNumber(row.close).toFixed(2) || undefined,
      amplitude: calcAmplitude(row) || undefined,
    });
    flat.push({ code, name, institution: firm, changePct, amountYi });
  }

  const hotGainers = [...flat]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 5)
    .map((p) => ({
      code: p.code,
      name: p.name,
      institution: p.institution,
      value: +p.changePct.toFixed(2),
      unit: "pct" as const,
    }));

  const hotTurnover = [...flat]
    .sort((a, b) => b.amountYi - a.amountYi)
    .slice(0, 5)
    .map((p) => ({
      code: p.code,
      name: p.name,
      institution: p.institution,
      value: +p.amountYi.toFixed(2),
      unit: "yi_amount" as const,
    }));

  const hotInflow = hotTurnover.map((p) => ({ ...p, unit: "yi" as const }));

  const sectors = SECTORS.map((s) => {
    const members = s.codes
      .map((c) => byCode.get(c))
      .filter((r): r is ByCodeRow => !!r);
    if (!members.length) return null;
    const avg =
      members.reduce((a, r) => a + calcChangePct(r), 0) / members.length;
    return { name: s.name, changePct: +avg.toFixed(2) };
  }).filter((x): x is { name: string; changePct: number } => x !== null);

  return { indices, sectors, hotInflow, hotGainers, hotTurnover, productsByFirm };
}

async function backfillOne(date: string) {
  const { codes, names, codeFirm } = loadCodesFromWhitelist();
  const thsCodes = [...INDEX_LIST.map((i) => i.ths), ...codes.map(toThsCode)].join(",");

  console.log(`[${date}] fetching iFinD historical quotation for ${codes.length} products...`);
  const token = await getAccessToken(fetch);
  const json = await ifindPost(
    "cmd_history_quotation",
    {
      codes: thsCodes,
      indicators: "open,high,low,close,preClose,amount,amplitude,shortName",
      startdate: date,
      enddate: date,
    },
    token,
    fetch,
  );

  const byCode = extractByCode(json as { tables?: Array<Record<string, unknown>> });
  console.log(`[${date}] got rows=${byCode.size}`);
  const etf = mapDashboard(byCode, codes, names, codeFirm);

  // preserve existing news / metadata; only replace etf
  const dayFile = join(dataDir, `${date}.json`);
  let existing: DaySnapshot | null = null;
  if (existsSync(dayFile)) {
    try {
      existing = DaySnapshotSchema.parse(
        JSON.parse(readFileSync(dayFile, "utf8")),
      );
    } catch {
      existing = null;
    }
  }
  const merged: DaySnapshot = DaySnapshotSchema.parse({
    tradeDate: date,
    updatedAt: new Date().toISOString(),
    status: "ok",
    news: existing?.news ?? [],
    etf,
  });

  const { writeSnapshot } = await import("./write-snapshot.js");
  writeSnapshot(dataDir, merged);
  console.log(
    `[${date}] wrote ETF snapshot: indices=${etf.indices.length}, products=${codes.length}, news kept=${merged.news.length}`,
  );
}

function parseDates(): string[] {
  const out: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--date=")) {
      out.push(...a.slice(7).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a === "--date") {
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
        i++;
      }
    }
  }
  if (out.length) return out;
  return ["2026-08-14", "2026-08-10"];
}

async function main() {
  const dates = parseDates();
  console.log(`backfill:etf targets: ${dates.join(", ")}`);
  for (const d of dates) {
    await backfillOne(d);
  }
  console.log("backfill:etf done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
