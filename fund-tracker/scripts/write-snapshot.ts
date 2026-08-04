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

export function writeSnapshot(dataDir: string, snapshot: DaySnapshot): void {
  const parsed = DaySnapshotSchema.parse(snapshot);
  const file = join(dataDir, `${parsed.tradeDate}.json`);
  const json = JSON.stringify(parsed, null, 2);
  writeFileSync(file, json, "utf8");

  const latestPath = join(dataDir, "latest.json");
  // Never blank the site: keep previous latest when today's ingest fully failed.
  if (isEmptyFailed(parsed) && existsSync(latestPath)) {
    console.warn(
      `ingest failed empty for ${parsed.tradeDate}; keep existing latest.json`,
    );
  } else {
    writeFileSync(latestPath, json, "utf8");
  }

  const dates = readdirSync(dataDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  writeFileSync(join(dataDir, "dates.json"), JSON.stringify(dates, null, 2), "utf8");
}
