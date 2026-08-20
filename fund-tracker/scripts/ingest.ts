import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNews } from "../shared/classify.js";
import { dedupeNews } from "../shared/dedupe.js";
import { isTradingDay } from "../shared/calendar.js";
import { pruneOldSnapshots } from "../shared/prune.js";
import { mergeWechatNews } from "../shared/merge-wechat.js";
import {
  DaySnapshotSchema,
  type DaySnapshot,
  type EtfDashboard,
  type NewsItem,
} from "../shared/schema.js";
import { createFixtureEtfAdapter, createFixtureNewsAdapter } from "./adapters/fixtures.js";
import {
  collectWhitelistCodes,
  createExchangeWebAdapter,
} from "./adapters/exchange-web.js";
import { createSseSearchAdapter } from "./adapters/sse-search.js";
import { createSseFundSiteAdapter } from "./adapters/sse-fund-site.js";
import { createCompanyWebAdapter } from "./adapters/company-web.js";
import { createWeweRssAdapter } from "./adapters/wewe-rss.js";
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

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8")) as T;
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

  const companySources = loadJson<
    Array<{ institution: string; name: string; listUrl: string }>
  >("config/company-sources.json");
  const weweFeeds = loadJson<
    Array<{ institution: string; name: string; feedId?: string }>
  >("config/wewe-feeds.json");
  const cninfoCfg = loadJson<{
    endpoint: string;
    keywords: string[];
    pageSize: number;
    maxPages?: number;
    maxAgeDays: number;
    columns?: string[];
  }>("config/exchange-sources.json");
  const whitelist = collectWhitelistCodes(
    loadJson<Record<string, Array<{ code: string }>>>("config/etf-whitelist.json"),
  );

  const newsAdapters = opts.useFixture
    ? [createFixtureNewsAdapter()]
    : [
        ...(hasIfind ? [createIfindNewsAdapter()] : []),
        createCompanyWebAdapter(fetch, companySources as any),
        createWeweRssAdapter(fetch, {
          baseUrl: process.env.WEWE_RSS_URL || "http://127.0.0.1:4000",
          authCode: process.env.WEWE_AUTH_CODE || "",
          feeds: weweFeeds as any,
        }),
        createExchangeWebAdapter(fetch, cninfoCfg as any, whitelist),
        createSseFundSiteAdapter(fetch),
      ];

  let wechatOkWithItems = false;
  let sseFundCount = 0;
  for (const adapter of newsAdapters) {
    try {
      const batch = await adapter.fetchNews(opts.tradeDate);
      news.push(...batch);
      if (adapter.name === "wewe-rss" && batch.length > 0) {
        wechatOkWithItems = true;
      }
      if (adapter.name === "sse-fund-site") sseFundCount = batch.length;
    } catch (e) {
      errors.push(`${adapter.name}: ${(e as Error).message}`);
    }
  }

  if (!opts.useFixture && sseFundCount === 0) {
    try {
      const fallback = await createSseSearchAdapter(fetch, {
        maxAgeDays: 0,
        maxPages: 2,
      }).fetchNews(opts.tradeDate);
      news.push(...fallback);
    } catch (e) {
      errors.push(`sse-search: ${(e as Error).message}`);
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

  let previousNews: NewsItem[] = [];
  const prevPath = join(opts.dataDir, `${opts.tradeDate}.json`);
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf8")) as DaySnapshot;
      previousNews = prev.news ?? [];
    } catch {
      previousNews = [];
    }
  }
  news = mergeWechatNews(news, previousNews, wechatOkWithItems);
  news = dedupeNews(news);

  // 保证每条资讯 id 唯一：多源合并后同一 id 会让前端按 key 渲染错乱。
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

  // Soft: empty iFind news / flaky official sources should not scare users when other lanes worked.
  const hardErrors = errors.filter(
    (e) =>
      !/report_query failed:\s*no data/i.test(e) &&
      !/^exchange-web:/i.test(e) &&
      !/^company-web:/i.test(e) &&
      !/^wewe-rss:/i.test(e) &&
      !/^sse-fund-site:/i.test(e) &&
      !/^sse-search:/i.test(e),
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
