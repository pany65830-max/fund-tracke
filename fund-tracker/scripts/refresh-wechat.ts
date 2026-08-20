/**
 * 仅刷新今天微信资讯，合并进已有快照。
 * 不调用 iFinD，保留 ETF/官网/交易所等全部已有数据。
 * 用法：npx tsx scripts/refresh-wechat.ts [YYYY-MM-DD]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWeweRssAdapter } from "./adapters/wewe-rss.js";
import { dedupeNews } from "../shared/dedupe.js";
import { DaySnapshotSchema, type DaySnapshot } from "../shared/schema.js";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
loadDotEnv(ROOT);

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8")) as T;
}

function uniqueIds(news: DaySnapshot["news"]): DaySnapshot["news"] {
  const seen = new Set<string>();
  return news.map((n) => {
    let id = n.id;
    let k = 1;
    while (seen.has(id)) {
      id = `${n.id}#${k++}`;
    }
    seen.add(id);
    return { ...n, id };
  });
}

async function main() {
  const tradeDate = process.argv[2] || shanghaiToday();
  const dataDir = join(ROOT, "data");
  const snapshotPath = join(dataDir, `${tradeDate}.json`);

  if (!existsSync(snapshotPath)) {
    console.error(`快照不存在：${snapshotPath}`);
    process.exit(1);
  }

  const snapshot = JSON.parse(
    readFileSync(snapshotPath, "utf8"),
  ) as DaySnapshot;

  const feeds = loadJson<
    Array<{ institution: string; name: string; feedId?: string }>
  >("config/wewe-feeds.json");

  const adapter = createWeweRssAdapter(fetch, {
    baseUrl: process.env.WEWE_RSS_URL || "http://127.0.0.1:4000",
    authCode: process.env.WEWE_AUTH_CODE || "",
    feeds: feeds as any,
    timeoutMs: 20000,
    limit: 1000,
  });

  console.log(`[refresh-wechat] 拉取 ${tradeDate} 的微信资讯...`);
  const freshWx = await adapter.fetchNews(tradeDate);
  console.log(`[refresh-wechat] 本次抓到 ${freshWx.length} 条微信资讯`);

  const nonWx = snapshot.news.filter((n) => n.source !== "wechat");
  const combined = dedupeNews([...nonWx, ...freshWx]);
  const finalNews = uniqueIds(combined);

  const updated: DaySnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    news: finalNews,
  };

  const validated = DaySnapshotSchema.parse(updated);
  writeFileSync(snapshotPath, JSON.stringify(validated, null, 2) + "\n");

  // 同步 latest.json（若它就是当前日期）
  const latestPath = join(dataDir, "latest.json");
  if (existsSync(latestPath)) {
    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as DaySnapshot;
    if (latest.tradeDate === tradeDate) {
      writeFileSync(latestPath, JSON.stringify(validated, null, 2) + "\n");
      console.log(`[refresh-wechat] 已同步 latest.json`);
    }
  }

  console.log(
    `[refresh-wechat] 完成：news=${validated.news.length}（微信 ${freshWx.length} 条）`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
