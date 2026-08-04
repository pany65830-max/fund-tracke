import { writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DaySnapshotSchema, type DaySnapshot } from "../shared/schema.js";

export function writeSnapshot(dataDir: string, snapshot: DaySnapshot): void {
  const parsed = DaySnapshotSchema.parse(snapshot);
  const file = join(dataDir, `${parsed.tradeDate}.json`);
  const json = JSON.stringify(parsed, null, 2);
  writeFileSync(file, json, "utf8");
  writeFileSync(join(dataDir, "latest.json"), json, "utf8");

  const dates = readdirSync(dataDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  writeFileSync(join(dataDir, "dates.json"), JSON.stringify(dates, null, 2), "utf8");
}
