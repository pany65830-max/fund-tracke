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
import { createWechatAdapter } from "./adapters/wechat.js";
import { createIfindNewsAdapter } from "./adapters/ifind-news.js";
import { createIfindEtfAdapter } from "./adapters/ifind-etf.js";
import { writeSnapshot } from "./write-snapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

export async function runIngest(opts: {
  tradeDate: string;
  dataDir: string;
  useFixture: boolean;
}): Promise<DaySnapshot> {
  const holidays = loadHolidays();
  if (!isTradingDay(opts.tradeDate, holidays)) {
    throw new Error(`SKIP_NON_TRADING_DAY:${opts.tradeDate}`);
  }

  const errors: string[] = [];
  let news: NewsItem[] = [];
  let etf: EtfDashboard = emptyEtf();

  const newsAdapters = opts.useFixture
    ? [createFixtureNewsAdapter()]
    : [createIfindNewsAdapter(), createWechatAdapter(), createExchangeWebAdapter()];

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

  const etfAdapter = opts.useFixture
    ? createFixtureEtfAdapter()
    : createIfindEtfAdapter();
  try {
    etf = await etfAdapter.fetchEtf(opts.tradeDate);
  } catch (e) {
    errors.push(`${etfAdapter.name}: ${(e as Error).message}`);
  }

  let status: DaySnapshot["status"] = "ok";
  if (errors.length && news.length === 0 && etf.indices.length === 0) {
    status = "failed";
  } else if (errors.length) {
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
  const useFixture =
    process.env.IFIND_USE_FIXTURE === "1" ||
    process.env.IFIND_USE_FIXTURE === "true" ||
    !process.env.IFIND_TOKEN;
  const dataDir = join(ROOT, "data");

  try {
    const snap = await runIngest({ tradeDate, dataDir, useFixture });
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
