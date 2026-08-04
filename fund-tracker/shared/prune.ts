import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isTradingDay, previousTradingDay } from "./calendar.js";

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function listSnapshotFiles(dataDir: string): string[] {
  return readdirSync(dataDir)
    .filter((f) => DATE_FILE.test(f))
    .sort();
}

/** Keep the newest `keepTradingDays` trading-day snapshots; delete older. Returns deleted names. */
export function pruneOldSnapshots(
  dataDir: string,
  keepTradingDays: number,
  holidays: Set<string>,
): string[] {
  const files = listSnapshotFiles(dataDir);
  if (files.length === 0) return [];

  const dates = files
    .map((f) => f.replace(/\.json$/, ""))
    .filter((d) => isTradingDay(d, holidays) || true)
    .sort();

  // Walk back from latest file date by trading days
  const latest = dates[dates.length - 1];
  const keep = new Set<string>();
  let cur = latest;
  for (let i = 0; i < keepTradingDays; i++) {
    keep.add(cur);
    if (i < keepTradingDays - 1) {
      cur = previousTradingDay(cur, holidays);
    }
  }

  const deleted: string[] = [];
  for (const f of files) {
    const d = f.replace(/\.json$/, "");
    if (!keep.has(d)) {
      unlinkSync(join(dataDir, f));
      deleted.push(f);
    }
  }
  return deleted;
}
