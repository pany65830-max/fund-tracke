import { existsSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DaySnapshotSchema, type DaySnapshot } from "../shared/schema.js";

function isEmptyFailed(snapshot: DaySnapshot): boolean {
  return (
    snapshot.status === "failed" &&
    snapshot.news.length === 0 &&
    snapshot.etf.indices.length === 0
  );
}

function isEmptyEtf(snapshot: DaySnapshot): boolean {
  const e = snapshot.etf;
  if (!e) return true;
  if (e.indices && e.indices.length > 0) return false;
  const firms = e.productsByFirm || {};
  if (Object.values(firms).some((arr) => arr && arr.length > 0)) return false;
  return true;
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
  const dayFile = join(dataDir, `${parsed.tradeDate}.json`);

  // 上游限流（iFinD no data / 微信搜狗 CAPTCHA）会导致本次新闻为空。
  // 若旧文件已有新闻，保留旧新闻，避免重跑时静默清空某日资讯。
  if (parsed.news.length === 0 && existsSync(dayFile)) {
    try {
      const old = JSON.parse(readFileSync(dayFile, "utf8")) as DaySnapshot;
      if (old.news && old.news.length > 0) {
        parsed.news = old.news;
        if (parsed.status === "failed") parsed.status = "ok";
      }
    } catch {
      /* ignore corrupt old file */
    }
  }

  // news-only 回跑 / iFinD 超时会导致本次 ETF 行情为空。
  // 若旧文件已有 ETF 行情，保留旧行情，避免回跑时静默清空某日 ETF 看板。
  if (isEmptyEtf(parsed) && existsSync(dayFile)) {
    try {
      const old = JSON.parse(readFileSync(dayFile, "utf8")) as DaySnapshot;
      if (old.etf && !isEmptyEtf(old)) {
        parsed.etf = old.etf;
        if (parsed.status === "failed") parsed.status = "ok";
      }
    } catch {
      /* ignore corrupt old file */
    }
  }

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

  // 仅当本次快照日期 >= 现有 latest 日期时才更新 latest.json，
  // 避免回补/backfill 旧日期把 latest.json 回退成旧快照（落地页会停在旧日期）。
  let shouldUpdateLatest = true;
  if (existsSync(latestPath)) {
    try {
      const cur = JSON.parse(readFileSync(latestPath, "utf8")) as DaySnapshot;
      if (cur.tradeDate && parsed.tradeDate < cur.tradeDate) {
        shouldUpdateLatest = false;
      }
    } catch {
      /* ignore corrupt latest.json */
    }
  }
  if (shouldUpdateLatest) writeFileSync(latestPath, json, "utf8");
  rewriteDates(dataDir);
}
