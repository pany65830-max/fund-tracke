/**
 * Backfill WeChat news for the week before a given end date (default: yesterday Shanghai).
 * Fetches once with a lookback window, then splits into per-day snapshots.
 *
 * Usage:
 *   npx tsx scripts/backfill-week.ts
 *   npx tsx scripts/backfill-week.ts --end=2026-08-04
 */
import { readFileSync, unlinkSync, readdirSync } from "node:fs";
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

function itemDay(item: NewsItem): string {
  const ms = Date.parse(item.publishedAt);
  if (!Number.isFinite(ms)) return item.publishedAt.slice(0, 10);
  return shanghaiDateFromUnix(Math.floor(ms / 1000));
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
  const start = addDays(end, -6); // inclusive week window ending at end
  const holidays = loadHolidays();

  console.log(`backfill wechat ${start} → ${end}`);

  const adapter = createWechatAdapter(fetch, {
    delayMs: 500,
    maxAgeDays: 10,
    sameDayOnly: false,
    pages: 3,
  });
  const raw = await adapter.fetchNews(end);
  console.log(`fetched wechat items=${raw.length}`);
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
    const day = itemDay(item);
    if (day < start || day > end) continue;
    if (!isTradingDay(day, holidays)) continue;
    const list = byDay.get(day) || [];
    list.push({
      ...item,
      id: item.id.replace(/-\d{4}-\d{2}-\d{2}$/, `-${day}`),
    });
    byDay.set(day, list);
  }

  // Ensure every trading day in window has a snapshot (news may be empty)
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isTradingDay(d, holidays)) continue;
    const news = byDay.get(d) || [];
    const snap = DaySnapshotSchema.parse({
      tradeDate: d,
      updatedAt: new Date().toISOString(),
      status: "ok",
      news,
      etf: emptyEtf(),
    });
    writeSnapshot(dataDir, snap);
    console.log(`wrote ${d} news=${news.length}`);
  }

  // Remove demo archives outside / inside window
  for (const f of readdirSync(dataDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    const full = join(dataDir, f);
    const day = f.replace(/\.json$/, "");
    if (isDemoFile(full)) {
      unlinkSync(full);
      console.log(`removed demo ${f}`);
      continue;
    }
    if (day < start || day > end) {
      // keep newer than end (e.g. today) but drop older than window
      if (day < start) {
        unlinkSync(full);
        console.log(`removed out-of-window ${f}`);
      }
    }
  }

  // Rewrite dates.json via writing latest again
  const latestDay = end;
  const latestNews = byDay.get(latestDay) || [];
  writeSnapshot(
    dataDir,
    DaySnapshotSchema.parse({
      tradeDate: latestDay,
      updatedAt: new Date().toISOString(),
      status: "ok",
      news: latestNews,
      etf: emptyEtf(),
    }),
  );

  console.log("backfill done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
