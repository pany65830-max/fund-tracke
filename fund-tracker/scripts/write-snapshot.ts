import { existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DaySnapshotSchema, type DaySnapshot } from "../shared/schema.js";

function isEmptyFailed(snapshot: DaySnapshot): boolean {
  return (
    snapshot.status === "failed" &&
    snapshot.news.length === 0 &&
    snapshot.etf.indices.length === 0
  );
}

function rewriteDates(dataDir: string): void {
  const dates = readdirSync(dataDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  writeFileSync(join(dataDir, "dates.json"), JSON.stringify(dates, null, 2), "utf8");
}

export function writeSnapshot(dataDir: string, snapshot: DaySnapshot): void {
  const parsed = DaySnapshotSchema.parse(snapshot);
  const latestPath = join(dataDir, "latest.json");

  // Never blank the site or wipe a good day file when today's ingest fully failed
  // (common on GitHub Actions overseas runners that cannot reach iFinD).
  if (isEmptyFailed(parsed) && existsSync(latestPath)) {
    console.warn(
      `ingest failed empty for ${parsed.tradeDate}; skip writing day/latest snapshots`,
    );
    rewriteDates(dataDir);
    return;
  }

  const file = join(dataDir, `${parsed.tradeDate}.json`);
  const json = JSON.stringify(parsed, null, 2);
  writeFileSync(file, json, "utf8");
  writeFileSync(latestPath, json, "utf8");
  rewriteDates(dataDir);
}
