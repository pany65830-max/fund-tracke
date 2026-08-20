/**
 * Legacy backfill via Sogou WeChat search. Daily ingest no longer calls Sogou
 * (see wewe-rss + worker/WEWE.md). Keep this script only for old snapshots.
 */
import { existsSync, readFileSync, unlinkSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNews } from "../shared/classify.js";
import { dedupeNews } from "../shared/dedupe.js";
import { isTradingDay } from "../shared/calendar.js";
import {
  DaySnapshotSchema,
  type DaySnapshot,
  type EtfDashboard,
  type NewsItem,
} from "../shared/schema.js";
import {
  createWechatAdapter,
  shanghaiDateFromUnix,
} from "./adapters/wechat.js";
import { writeSnapshot } from "./write-snapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const dataDir = join(ROOT, "data");

function loadHolidays(): Set<string> {
  return new Set(
    JSON.parse(readFileSync(join(ROOT, "config/holidays-cn.json"), "utf8")) as string[],
  );
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function emptyEtf(): EtfDashboard {
  return {
    indices: [],
    sectors: [],
    hotInflow: [],
    hotGainers: [],
    hotTurnover: [],
    productsByFirm: {},
  };
}

function loadExistingEtf(day: string): EtfDashboard {
  const path = join(dataDir, `${day}.json`);
  if (!existsSync(path)) return emptyEtf();
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as DaySnapshot;
    return j.etf?.indices?.length ? j.etf : emptyEtf();
  } catch {
    return emptyEtf();
  }
}

function itemCalendarDay(item: NewsItem): string {
  const ms = Date.parse(item.publishedAt);
  if (!Number.isFinite(ms)) return item.publishedAt.slice(0, 10);
  return shanghaiDateFromUnix(Math.floor(ms / 1000));
}

/** Map calendar day onto a trading day (weekends/holidays → next session). */
function toTradingDay(day: string, holidays: Set<string>, end: string): string | null {
  let d = day;
  for (let i = 0; i < 6; i++) {
    if (d > end) return null;
    if (isTradingDay(d, holidays)) return d;
    d = addDays(d, 1);
  }
  return null;
}

function isDemoFile(path: string): boolean {
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as DaySnapshot;
    return (j.news || []).some((n) => n.id.startsWith("fx-"));
  } catch {
    return false;
  }
}

async function main() {
  const endArg = process.argv.find((a) => a.startsWith("--end="))?.slice(6);
  const end = endArg || "2026-08-04";
  const start = addDays(end, -6);
  const holidays = loadHolidays();

  console.log(`backfill wechat ${start} → ${end}`);

  const adapter = createWechatAdapter(fetch, {
    delayMs: 1500, // slower = fewer Sogou captchas on fund accounts
    maxAgeDays: 14,
    sameDayOnly: false,
    pages: 5,
  });
  const raw = await adapter.fetchNews(end);
  console.log(`fetched wechat items=${raw.length}`);
  const byInst = new Map<string, number>();
  for (const n of raw) {
    byInst.set(n.institution, (byInst.get(n.institution) || 0) + 1);
  }
  console.log(
    "by institution:",
    [...byInst.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)",
  );

  const classified = dedupeNews(
    raw.map((n) => ({
      ...n,
      category: classifyNews({
        title: n.title,
        summary: n.summary,
        institution: n.institution,
      }),
    })),
  );

  const byDay = new Map<string, NewsItem[]>();
  for (const item of classified) {
    const cal = itemCalendarDay(item);
    if (cal < start || cal > end) continue;
    const day = toTradingDay(cal, holidays, end);
    if (!day || day < start) continue;
    const list = byDay.get(day) || [];
    list.push({
      ...item,
      id: item.id.replace(/-\d{4}-\d{2}-\d{2}$/, `-${day}`),
    });
    byDay.set(day, list);
  }

  console.log(
    "by day:",
    [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, n]) => `${d}=${n.length}`)
      .join(", ") || "(empty)",
  );

  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isTradingDay(d, holidays)) continue;
    let news = byDay.get(d) || [];
    // Avoid empty "latest" day: top up from the previous 2 trading days' pool
    if (d === end && news.length < 3) {
      const extra: NewsItem[] = [];
      for (const [day, items] of byDay) {
        if (day >= addDays(end, -3) && day <= end) extra.push(...items);
      }
      news = dedupeNews([...news, ...extra]);
    }
    writeSnapshot(
      dataDir,
      DaySnapshotSchema.parse({
        tradeDate: d,
        updatedAt: new Date().toISOString(),
        status: "ok",
        news,
        etf: loadExistingEtf(d),
      }),
    );
    console.log(`wrote ${d} news=${news.length}`);
  }

  for (const f of readdirSync(dataDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    const full = join(dataDir, f);
    const day = f.replace(/\.json$/, "");
    if (isDemoFile(full)) {
      unlinkSync(full);
      console.log(`removed demo ${f}`);
      continue;
    }
    if (day < start) {
      unlinkSync(full);
      console.log(`removed out-of-window ${f}`);
    }
  }

  console.log("backfill done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
