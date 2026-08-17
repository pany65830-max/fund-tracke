import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNews } from "../shared/classify.js";
import { dedupeNews } from "../shared/dedupe.js";
import { isTradingDay } from "../shared/calendar.js";
import { pruneOldSnapshots } from "../shared/prune.js";
import {
  DaySnapshotSchema,
  type DaySnapshot,
  type EtfDashboard,
  type NewsItem,
} from "../shared/schema.js";
import { createFixtureEtfAdapter, createFixtureNewsAdapter } from "./adapters/fixtures.js";
import { createExchangeWebAdapter } from "./adapters/exchange-web.js";
import { createCompanyWebAdapter } from "./adapters/company-web.js";
import { createWechatAdapter } from "./adapters/wechat.js";
import { createIfindNewsAdapter } from "./adapters/ifind-news.js";
import { createIfindEtfAdapter } from "./adapters/ifind-etf.js";
import { writeSnapshot } from "./write-snapshot.js";
import { loadDotEnv } from "./load-dotenv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
loadDotEnv(ROOT);

function loadHolidays(): Set<string> {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "config/holidays-cn.json"), "utf8"),
  ) as string[];
  return new Set(raw);
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

function shanghaiToday(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

/** 取某条资讯 publishedAt 对应的北京时间日期（YYYY-MM-DD），用于按日归类。 */
function beijingDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export async function runIngest(opts: {
  tradeDate: string;
  dataDir: string;
  useFixture: boolean;
  newsOnly?: boolean;
}): Promise<DaySnapshot> {
  const holidays = loadHolidays();
  if (!isTradingDay(opts.tradeDate, holidays)) {
    throw new Error(`SKIP_NON_TRADING_DAY:${opts.tradeDate}`);
  }

  const errors: string[] = [];
  let news: NewsItem[] = [];
  let etf: EtfDashboard = emptyEtf();
  const hasIfind =
    !!(process.env.IFIND_REFRESH_TOKEN || process.env.IFIND_TOKEN) &&
    !opts.useFixture;

  const newsAdapters = opts.useFixture
    ? [createFixtureNewsAdapter()]
    : hasIfind
      ? [
          createIfindNewsAdapter(),
          createCompanyWebAdapter(fetch),
          createWechatAdapter(fetch, {
            sameDayOnly: false,
            maxAgeDays: 7,
            pages: 5,
            delayMs: 1200,
          }),
          createExchangeWebAdapter(fetch),
        ]
      : [
          createCompanyWebAdapter(fetch),
          createWechatAdapter(fetch, {
            sameDayOnly: false,
            maxAgeDays: 7,
            pages: 5,
            delayMs: 1200,
          }),
          createExchangeWebAdapter(fetch),
        ];

  for (const adapter of newsAdapters) {
    try {
      const batch = await adapter.fetchNews(opts.tradeDate);
      news.push(...batch);
    } catch (e) {
      errors.push(`${adapter.name}: ${(e as Error).message}`);
    }
  }

  news = news.map((n) => ({
    ...n,
    category: classifyNews({
      title: n.title,
      summary: n.summary,
      institution: n.institution,
    }),
  }));
  news = dedupeNews(news);

  // 严格按北京时间归日：微信/官网适配器会带回近 7 天的文章，
  // 若都写进当天文件会导致各日新闻混在一起。这里只保留「发布日期=当日」的资讯。
  news = news.filter((n) => beijingDate(n.publishedAt) === opts.tradeDate);

  // 保证每条资讯 id 唯一：微信搜狗分页/多搜索词会让每条 id 的序号从 0 重算，
  // 产生重复 id（同一 id 对应不同文章）。重复 id 会让前端 React 按 key 渲染
  // 列表时错乱——切换日期时旧卡片残留在列表顶部。这里给重复 id 追加后缀。
  {
    const seenIds = new Set<string>();
    news = news.map((n) => {
      let id = n.id;
      let k = 1;
      while (seenIds.has(id)) {
        id = `${n.id}#${k++}`;
      }
      seenIds.add(id);
      return { ...n, id };
    });
  }

  if (opts.useFixture) {
    try {
      etf = await createFixtureEtfAdapter().fetchEtf(opts.tradeDate);
    } catch (e) {
      errors.push(`fixture-etf: ${(e as Error).message}`);
    }
  } else if (hasIfind && !opts.newsOnly) {
    try {
      etf = await createIfindEtfAdapter().fetchEtf(opts.tradeDate);
    } catch (e) {
      errors.push(`ifind-etf: ${(e as Error).message}`);
    }
  }

  // Soft: empty iFind news / flaky exchange should not scare users when WeChat worked.
  const hardErrors = errors.filter(
    (e) =>
      !/report_query failed:\s*no data/i.test(e) &&
      !/^exchange-web:/i.test(e) &&
      !/^company-web:/i.test(e),
  );

  let status: DaySnapshot["status"] = "ok";
  if (hardErrors.length && news.length === 0 && etf.indices.length === 0) {
    status = "failed";
  } else if (hardErrors.length) {
    status = "partial";
  } else if (errors.length && news.length === 0 && etf.indices.length === 0) {
    status = "partial";
  }

  const snapshot = DaySnapshotSchema.parse({
    tradeDate: opts.tradeDate,
    updatedAt: new Date().toISOString(),
    status,
    errors: errors.length ? errors : undefined,
    news,
    etf,
  });

  writeSnapshot(opts.dataDir, snapshot);
  pruneOldSnapshots(opts.dataDir, 90, holidays);
  return snapshot;
}

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith("--date="))?.slice(7);
  const tradeDate = dateArg || shanghaiToday();
  // Fixture only when explicitly requested. No token → still pull WeChat/exchange.
  const useFixture =
    process.env.IFIND_USE_FIXTURE === "1" ||
    process.env.IFIND_USE_FIXTURE === "true";
  const newsOnly = args.includes("--news-only");
  const dataDir = join(ROOT, "data");

  try {
    const snap = await runIngest({ tradeDate, dataDir, useFixture, newsOnly });
    console.log(
      `ingest ok date=${snap.tradeDate} status=${snap.status} news=${snap.news.length}`,
    );
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("SKIP_NON_TRADING_DAY:")) {
      console.log(msg);
      process.exit(0);
    }
    console.error(e);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(
    process.argv[1].replace(/\\/g, "/").split("/").slice(-2).join("/"),
  );

// Always run when executed via tsx scripts/ingest.ts
if (import.meta.url.startsWith("file:")) {
  const self = fileURLToPath(import.meta.url);
  if (process.argv[1] && self === process.argv[1]) {
    main();
  } else if (process.argv[1]?.endsWith("ingest.ts")) {
    main();
  }
}
