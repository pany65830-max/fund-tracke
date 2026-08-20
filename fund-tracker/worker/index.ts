// worker/index.ts — Cloudflare Worker: iFinD API proxy + full cloud ingest for fund-tracker
//
// 作用：网站前端把 iFinD 的 refresh_token 发过来，Worker 代为拉取 ETF 行情与全部资讯，
//       返回与项目 data/*.json 同构的 DaySnapshot，并可选写回 GitHub 触发 Pages 部署。
// 安全：无状态，不持久化 token；CORS 允许任意来源；GitHub PAT 仅存于 Worker 环境变量。
//
// 部署：在本目录 `wrangler deploy`（PAT 已通过 `wrangler secret put GITHUB_TOKEN` 配置）。

import { PRODUCTS } from "./products.js";
import { createCompanyWebAdapter } from "../scripts/adapters/company-web.js";
import { createWeweRssAdapter } from "../scripts/adapters/wewe-rss.js";
import {
  collectWhitelistCodes,
  createExchangeWebAdapter,
} from "../scripts/adapters/exchange-web.js";
import { createSseSearchAdapter } from "../scripts/adapters/sse-search.js";
import { createSseFundSiteAdapter } from "../scripts/adapters/sse-fund-site.js";
import { classifyNews } from "../shared/classify.js";
import { dedupeNews } from "../shared/dedupe.js";
import { keepUncoveredNews, mergeWechatNews } from "../shared/merge-wechat.js";
import type { DaySnapshot, EtfDashboard, NewsItem } from "../shared/schema.js";

const BASE = "https://quantapi.51ifind.com/api/v1";

const GH_OWNER = "pany65830-max";
const GH_REPO = "fund-tracke";
const GH_BRANCH = "main";
/** GitHub Pages 工作流只监听 fund-tracker/**，构建拷贝 fund-tracker/data/。根目录 data/ 不会出现在网站上。 */
const GH_DATA_DIR = "fund-tracker/data";
const GH_ROOT_DATA_DIR = "data";

const INDEX_LIST = [
  { code: "000300", ths: "000300.SH", name: "沪深300" },
  { code: "000905", ths: "000905.SH", name: "中证500" },
  { code: "399006", ths: "399006.SZ", name: "创业板指" },
  { code: "000688", ths: "000688.SH", name: "科创50" },
  { code: "000016", ths: "000016.SH", name: "上证50" },
];

const SECTORS = [
  { name: "宽基ETF", codes: ["510300", "510050", "510310", "588000", "588090", "512500"] },
  { name: "港股/中概", codes: ["513130", "510900"] },
  { name: "银行", codes: ["512800"] },
  { name: "军工", codes: ["512660"] },
  { name: "半导体", codes: ["512760"] },
  { name: "新能源", codes: ["515030"] },
  { name: "通信", codes: ["515880"] },
  { name: "红利", codes: ["510880"] },
  { name: "创业板", codes: ["159915"] },
  { name: "深证100", codes: ["159901"] },
];

// 与 config/category-rules.json 保持一致
const CATEGORY_RULES = {
  disclosure: ["招募说明书", "公告", "信披", "份额变动", "上市交易"],
  active_etf: ["主动ETF", "主动管理ETF", "主动型ETF"],
  new_product: ["发行", "认购", "募集", "新品", "发售"],
  research: ["研报", "策略会", "月报", "季报观点", "投资观点"],
};
const CATEGORY_ORDER = ["active_etf", "new_product", "research", "disclosure"];

// 内联公司官网配置（与 config/company-sources.json 一致）
const COMPANY_SOURCES = [
  { institution: "huaxia" as const, name: "华夏基金", listUrl: "https://www.chinaamc.com/hxdt/hxxw/" },
  { institution: "huaxia" as const, name: "华夏基金-信息披露", listUrl: "https://www.chinaamc.com/guanyu/gonggao/" },
  { institution: "efunds" as const, name: "易方达-信息披露", listUrl: "https://www.efunds.com.cn/lm/xxpl/" },
  { institution: "efunds" as const, name: "易方达-临时公告", listUrl: "https://www.efunds.com.cn/Html5/lm/xxpl/xxpllsgg/" },
  { institution: "guotai" as const, name: "国泰基金-公司公告", listUrl: "https://www.gtfund.com/Etrade/Report/companyreport" },
  { institution: "guotai" as const, name: "国泰基金-产品公告", listUrl: "https://www.gtfund.com/Etrade/Report/fundreport/" },
  { institution: "huatai" as const, name: "华泰柏瑞-资讯中心", listUrl: "http://www.huatai-pb.com/news/index.html" },
  { institution: "huatai" as const, name: "华泰柏瑞-新闻速递", listUrl: "http://www.huatai-pb.com/news/newsd/index.html" },
  { institution: "huatai" as const, name: "华泰柏瑞-公司动态", listUrl: "http://www.huatai-pb.com/news/companyNews/index.html" },
  { institution: "huatai" as const, name: "华泰柏瑞-临时公告", listUrl: "http://www.huatai-pb.com/news/information/tempReport/index.html" },
];

// 与 config/wewe-feeds.json 一致：用 WeWe RSS 按公众号名过滤，不再走搜狗。
const WEWE_FEEDS = [
  { institution: "media" as const, name: "中国证券报" },
  { institution: "huaxia" as const, name: "华夏基金" },
  { institution: "efunds" as const, name: "易方达微资讯" },
  { institution: "efunds" as const, name: "易方达微理财" },
  { institution: "efunds" as const, name: "易方达基金" },
  { institution: "efunds" as const, name: "易方达财富微理财" },
  { institution: "guotai" as const, name: "国泰基金" },
  { institution: "guotai" as const, name: "国泰基金微幸福" },
  { institution: "huatai" as const, name: "华泰柏瑞微理财" },
  { institution: "huatai" as const, name: "华泰柏瑞基金微理财" },
  { institution: "sse" as const, name: "上交所发布" },
  { institution: "sse" as const, name: "上交所投服" },
  { institution: "sse" as const, name: "上交所ETF之家" },
  { institution: "szse" as const, name: "深交所" },
  { institution: "szse" as const, name: "深交所投服" },
  { institution: "szse" as const, name: "深交所投服部" },
  { institution: "szse" as const, name: "深交所上市通" },
  { institution: "szse" as const, name: "深市基金" },
];

// 内联交易所配置（与 config/exchange-sources.json 一致）
const CNINFO_CFG = {
  endpoint: "https://www.cninfo.com.cn/new/hisAnnouncement/query",
  keywords: ["ETF", "交易型开放式指数基金"],
  pageSize: 30,
  maxPages: 2,
  maxAgeDays: 0,
  columns: ["szse"],
};

const ETF_WHITELIST = collectWhitelistCodes(PRODUCTS);

// code -> firm 映射
const CODE_FIRM = new Map<string, string>();
for (const p of PRODUCTS) CODE_FIRM.set(p.code, p.firm);

function classifyNewsLocal(title: string, summary: string, institution: string) {
  if (institution === "sse" || institution === "szse") return "exchange";
  if (institution === "media") return "other";
  const text = `${title}\n${summary || ""}`;
  for (const key of CATEGORY_ORDER) {
    for (const kw of CATEGORY_RULES[key as keyof typeof CATEGORY_RULES] || []) {
      if (text.includes(kw)) return key;
    }
  }
  return "other";
}

function toThsCode(code: string) {
  const c = String(code).replace(/\.(SH|SZ)$/i, "");
  if (c.startsWith("5") || c.startsWith("6") || c.startsWith("000")) return `${c}.SH`;
  return `${c}.SZ`;
}
function bareCode(thscode: string) {
  return String(thscode).replace(/\.(SH|SZ)$/i, "");
}
function asNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}
function flattenTables(tables: unknown[]) {
  if (!tables || !Array.isArray(tables)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const table of tables) {
    if (!table || typeof table !== "object") continue;
    const t = table as Record<string, unknown>;
    const thscode = String(t.thscode || t.THSCODE || "");
    const keys = Object.keys(t).filter((k) => k !== "thscode" && k !== "THSCODE");
    const arrayKeys = keys.filter((k) => Array.isArray(t[k]));
    if (arrayKeys.length) {
      const n = Math.max(...arrayKeys.map((k) => (t[k] as unknown[]).length), 1);
      for (let i = 0; i < n; i++) {
        const row: Record<string, unknown> = { thscode };
        for (const k of keys) {
          const v = t[k];
          row[k] = Array.isArray(v) ? v[i] : v;
        }
        rows.push(row);
      }
    } else {
      rows.push({ ...t, thscode });
    }
  }
  return rows;
}

function emptyEtf(): EtfDashboard {
  return {
    indices: [],
    sectors: [],
    hotInflow: [],
    hotGainers: [],
    hotTurnover: [],
    productsByFirm: { huaxia: [], efunds: [], guotai: [], huatai: [] },
  };
}

function yuanToYi(v: number) {
  if (!v) return 0;
  if (Math.abs(v) < 1000) return v;
  return v / 1e8;
}

async function getAccessToken(refresh: string) {
  if (!refresh) throw new Error("missing iFinD token");
  const res = await fetch(`${BASE}/get_access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", refresh_token: refresh },
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`get_access_token invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = (json.errorcode as number) ?? (json.errorCode as number) ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(`get_access_token failed: ${(json.errmsg as string) || (json.errorMsg as string) || text.slice(0, 200)}`);
  }
  const token = json.data && (json.data as Record<string, unknown>).access_token;
  if (!token) throw new Error("get_access_token: access_token empty");
  return token as string;
}

async function ifindPost(path: string, body: Record<string, unknown>, accessToken: string) {
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: accessToken },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = (json.errorcode as number) ?? (json.errorCode as number) ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(`${path} failed: ${(json.errmsg as string) || (json.errorMsg as string) || `code=${code}`}`);
  }
  return json;
}

async function fetchEtf(accessToken: string) {
  const thsCodes = [
    ...INDEX_LIST.map((i) => i.ths),
    ...PRODUCTS.map((p) => toThsCode(p.code)),
  ].join(",");
  const json = await ifindPost(
    "real_time_quotation",
    {
      codes: thsCodes,
      indicators: "latest,changeRatio,preClose,amount,volume,amplitude,shortName",
    },
    accessToken,
  );

  const byCode = new Map<string, Record<string, unknown>>();
  for (const t of (json.tables as unknown[]) || []) {
    const tbl = (t as Record<string, unknown>).table as Record<string, unknown>;
    const ths = String((t as Record<string, unknown>).thscode || "");
    const first = (k: string) => (Array.isArray(tbl[k]) ? tbl[k][0] : tbl[k]);
    const rec = {
      thscode: ths,
      latest: first("latest"),
      changeRatio: first("changeRatio"),
      preClose: first("preClose"),
      amount: first("amount"),
      volume: first("volume"),
      amplitude: first("amplitude"),
      shortName: first("shortName"),
    };
    byCode.set(bareCode(ths), rec);
    byCode.set(ths, rec);
  }

  const calcChangePct = (row: Record<string, unknown>) => {
    const latest = asNumber(row.latest);
    const preClose = asNumber(row.preClose);
    if (latest && preClose) return ((latest - preClose) / preClose) * 100;
    return asNumber(row.changeRatio);
  };

  const indices = INDEX_LIST.map((idx) => {
    const row = byCode.get(idx.code) || byCode.get(idx.ths) || {};
    return {
      code: idx.code,
      name: idx.name,
      last: asNumber(row.latest),
      changePct: +calcChangePct(row).toFixed(2),
    };
  });

  const productsByFirm: Record<string, { code: string; name: string; changePct: number; amount: number; nav?: number; amplitude?: number }[]> = {
    huaxia: [], efunds: [], guotai: [], huatai: [],
  };
  const flatProducts: { code: string; name: string; firm: string; changePct: number; amountYi: number }[] = [];
  for (const p of PRODUCTS) {
    const row = byCode.get(p.code) || {};
    const firm = p.firm;
    const changePct = +calcChangePct(row).toFixed(2);
    const amountYi = yuanToYi(asNumber(row.amount));
    const name = String(row.shortName || "") || p.code;
    productsByFirm[firm].push({
      code: p.code,
      name,
      changePct,
      amount: +amountYi.toFixed(2),
      nav: asNumber(row.latest) || undefined,
      amplitude: asNumber(row.amplitude) || undefined,
    });
    flatProducts.push({ code: p.code, name, firm, changePct, amountYi });
  }

  const hotGainers = [...flatProducts]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 5)
    .map((p) => ({ code: p.code, name: p.name, institution: p.firm, value: +p.changePct.toFixed(2), unit: "pct" as const }));

  const hotTurnover = [...flatProducts]
    .sort((a, b) => b.amountYi - a.amountYi)
    .slice(0, 5)
    .map((p) => ({ code: p.code, name: p.name, institution: p.firm, value: +p.amountYi.toFixed(2), unit: "yi_amount" as const }));

  const sectors = SECTORS.map((s) => {
    const members = s.codes.map((c) => byCode.get(c)).filter(Boolean) as Record<string, unknown>[];
    if (!members.length) return null;
    const avg = members.reduce((a, r) => a + calcChangePct(r), 0) / members.length;
    return { name: s.name, changePct: +avg.toFixed(2) };
  }).filter(Boolean) as { name: string; changePct: number }[];

  return { indices, sectors, hotInflow: [], hotGainers, hotTurnover, productsByFirm };
}

function addDays(date: string, delta: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function mapInstitutionByCode(thscode: string) {
  const bare = bareCode(thscode);
  const found = PRODUCTS.find((p) => p.code === bare);
  return found ? found.firm : "huatai";
}

async function fetchIfindNews(accessToken: string, tradeDate: string) {
  const begin = addDays(tradeDate, -7);
  const json = await ifindPost(
    "report_query",
    {
      codes: PRODUCTS.map((p) => toThsCode(p.code)).join(","),
      functionpara: { reportType: "901" },
      beginrDate: begin,
      endrDate: tradeDate,
      outputpara: "reportDate:Y,thscode:Y,secName:Y,ctime:Y,reportTitle:Y,pdfURL:Y,seq:Y",
    },
    accessToken,
  );
  const rows = flattenTables(json.tables as unknown[]);
  const items: NewsItem[] = [];
  rows.forEach((row, idx) => {
    const title = String(row.reportTitle || row.title || "").trim();
    if (!title) return;
    const thscode = String(row.thscode || "");
    const institution = mapInstitutionByCode(thscode) as NewsItem["institution"];
    const summary = String(row.secName || title);
    const pdf = String(row.pdfURL || row.pdfUrl || "").trim();
    const sourceUrl = pdf.startsWith("http")
      ? pdf
      : pdf
        ? `https://${pdf}`
        : "https://www.51ifind.com/";
    const publishedAt = String(row.ctime || row.reportDate || `${tradeDate}T08:00:00+08:00`);
    items.push({
      id: String(row.seq || `ifind-live-${idx}-${tradeDate}`),
      title,
      summary,
      institution,
      category: classifyNewsLocal(title, summary, institution),
      source: "ifind",
      publishedAt,
      sourceUrl,
    });
  });
  return items;
}

function beijingToday() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  const y = bj.getFullYear();
  const m = String(bj.getMonth() + 1).padStart(2, "0");
  const d = String(bj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function beijingDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

async function handleRefresh({ token, tradeDate }: { token: string; tradeDate: string }) {
  const accessToken = await getAccessToken(token);
  const results = await Promise.allSettled([fetchEtf(accessToken), fetchIfindNews(accessToken, tradeDate)]);
  const etf = results[0].status === "fulfilled" ? results[0].value : emptyEtf();
  const news = results[1].status === "fulfilled" ? results[1].value : [];
  const errors: string[] = [];
  if (results[0].status === "rejected") errors.push(`etf: ${results[0].reason && results[0].reason.message}`);
  if (results[1].status === "rejected") errors.push(`news: ${results[1].reason && results[1].reason.message}`);
  const status = etf.indices.length ? (news.length ? "ok" : "partial") : "partial";
  return {
    tradeDate,
    updatedAt: new Date().toISOString(),
    status,
    errors: errors.length ? errors : undefined,
    etf,
    news,
    source: "ifind-live",
  };
}

function uniquifyNewsIds(news: NewsItem[]): NewsItem[] {
  const seenIds = new Set<string>();
  return news.map((n) => {
    let id = n.id;
    let k = 1;
    while (seenIds.has(id)) {
      id = `${n.id}#${k++}`;
    }
    seenIds.add(id);
    return { ...n, id };
  });
}

async function runAdapter(
  adapter: { name: string; fetchNews: (d: string) => Promise<NewsItem[]> },
  tradeDate: string,
): Promise<NewsItem[]> {
  return Promise.race([
    adapter.fetchNews(tradeDate),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("adapter timeout (20s)")), 20000),
    ),
  ]);
}

// —— 全量云端 ingest（行情 + 各资讯源） ——
/** 把 fetch 包装成"经本机代理转发"，让海外 Worker 借国内 IP 抓取。proxyUrl 为空则原样返回。 */
function makeProxyFetch(base: typeof fetch, proxyUrl?: string, token?: string): typeof fetch {
  if (!proxyUrl) return base;
  const root = proxyUrl.replace(/\/+$/, "");
  return ((input: any, init?: any) => {
    const target =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input?.url;
    const url = `${root}/fetch?url=${encodeURIComponent(target)}${
      token ? `&t=${encodeURIComponent(token)}` : ""
    }`;
    return base(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
  }) as typeof fetch;
}

async function handleIngest({
  token,
  tradeDate,
  weweBaseUrl,
  weweAuth,
  scrapeProxyUrl,
  scrapeProxyToken,
}: {
  token: string;
  tradeDate: string;
  weweBaseUrl: string;
  weweAuth: string;
  scrapeProxyUrl?: string;
  scrapeProxyToken?: string;
}) {
  const errors: string[] = [];
  let accessToken = "";
  try {
    accessToken = await getAccessToken(token);
  } catch (e) {
    errors.push(`ifind-token: ${(e as Error).message}`);
  }

  const etfPromise = accessToken
    ? fetchEtf(accessToken).catch((e) => {
        errors.push(`etf: ${e.message}`);
        return emptyEtf();
      })
    : Promise.resolve(emptyEtf());

  const pf = makeProxyFetch(fetch, scrapeProxyUrl, scrapeProxyToken);
  const adapters = [
    createCompanyWebAdapter(pf, COMPANY_SOURCES),
    createWeweRssAdapter(fetch, {
      baseUrl: weweBaseUrl,
      authCode: weweAuth,
      feeds: WEWE_FEEDS,
    }),
    createExchangeWebAdapter(pf, CNINFO_CFG, ETF_WHITELIST),
    createSseFundSiteAdapter(pf),
  ];

  const newsBatches = await Promise.allSettled(
    adapters.map((adapter) => runAdapter(adapter, tradeDate)),
  );

  let news: NewsItem[] = [];
  let wechatOkWithItems = false;
  let sseFundCount = 0;
  for (let i = 0; i < adapters.length; i++) {
    const res = newsBatches[i];
    if (res.status === "fulfilled") {
      news.push(...res.value);
      if (adapters[i].name === "wewe-rss" && res.value.length > 0) {
        wechatOkWithItems = true;
      }
      if (adapters[i].name === "sse-fund-site") sseFundCount = res.value.length;
    } else {
      errors.push(`${adapters[i].name}: ${res.reason && res.reason.message}`);
    }
  }

  if (sseFundCount === 0) {
    try {
      const fallback = await runAdapter(
        createSseSearchAdapter(pf, { maxAgeDays: 0, maxPages: 2 }),
        tradeDate,
      );
      news.push(...fallback);
    } catch (e) {
      errors.push(`sse-search: ${(e as Error).message}`);
    }
  }

  // iFinD 资讯作为补充（token 换不到时跳过，不阻断官网/交易所）
  if (accessToken) {
    const ifindNews = await fetchIfindNews(accessToken, tradeDate).catch((e) => {
      errors.push(`ifind-news: ${e.message}`);
      return [] as NewsItem[];
    });
    news.push(...ifindNews);
  }

  news = news.map((n) => ({
    ...n,
    category: classifyNews({ title: n.title, summary: n.summary, institution: n.institution }, CATEGORY_RULES),
  }));
  news = dedupeNews(news);
  news = news.filter((n) => beijingDate(n.publishedAt) === tradeDate);
  news = uniquifyNewsIds(news);

  const etf = await etfPromise;
  let status: DaySnapshot["status"] = "ok";
  if (errors.length && news.length === 0 && etf.indices.length === 0) {
    status = "failed";
  } else if (errors.length) {
    status = "partial";
  }

  return {
    tradeDate,
    updatedAt: new Date().toISOString(),
    status,
    errors: errors.length ? errors : undefined,
    news,
    etf,
    source: "cloud-ingest",
    wechatOkWithItems,
  } as DaySnapshot & { wechatOkWithItems: boolean };
}

// —— GitHub Contents API：把快照写回仓库，触发 Pages 重新部署 ——
function toBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromBase64(b64: string) {
  // GitHub Contents API 会把 base64 按 60 字符换行；不先去掉空白，atob 会失败。
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

type GhFile = { sha: string; content?: string; download_url?: string | null };

async function parseSnapshotFile(file: GhFile | null, token: string): Promise<DaySnapshot | null> {
  if (!file) return null;
  let text = "";
  if (file.content) {
    try {
      text = fromBase64(file.content);
    } catch {
      text = "";
    }
  }
  if (!text.trim() && file.download_url) {
    const res = await fetch(file.download_url, { headers: ghHeaders(token) });
    if (res.ok) text = await res.text();
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as DaySnapshot;
  } catch {
    return null;
  }
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "fund-tracker-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGetFile(path: string, token: string) {
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    { headers: ghHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub 读取 ${path} 失败: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<GhFile>;
}

async function ghPutFile(path: string, content: string, token: string, sha: string | null | undefined, message: string) {
  const body: Record<string, unknown> = { message, content: toBase64(content), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub 写入 ${path} 失败: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function publishSnapshot(
  snapshot: DaySnapshot,
  githubToken: string,
  wechatOkWithItems = false,
) {
  if (!githubToken) {
    throw new Error("Worker 未配置 GITHUB_TOKEN，请用 `wrangler secret put GITHUB_TOKEN` 配置（需 repo 写权限）");
  }
  const date = snapshot.tradeDate;

  const dayPath = `${GH_DATA_DIR}/${date}.json`;
  const latestPath = `${GH_DATA_DIR}/latest.json`;
  const datesPath = `${GH_DATA_DIR}/dates.json`;
  const dayExisting = await ghGetFile(dayPath, githubToken);
  const latestExisting = await ghGetFile(latestPath, githubToken);
  const rootDayExisting = await ghGetFile(`${GH_ROOT_DATA_DIR}/${date}.json`, githubToken);
  const rootLatestExisting = await ghGetFile(`${GH_ROOT_DATA_DIR}/latest.json`, githubToken);

  const sameDayPrev = await parseSnapshotFile(dayExisting, githubToken);
  if (dayExisting && !sameDayPrev) {
    throw new Error("读取当天已有资讯失败，已取消发布以免覆盖");
  }
  const latestPrev = await parseSnapshotFile(latestExisting, githubToken);
  const rootDayPrev = await parseSnapshotFile(rootDayExisting, githubToken);
  const rootLatestPrev = await parseSnapshotFile(rootLatestExisting, githubToken);

  const previousNews = [
    ...(sameDayPrev?.tradeDate === date ? sameDayPrev.news ?? [] : []),
    ...(latestPrev?.tradeDate === date ? latestPrev.news ?? [] : []),
    ...(rootDayPrev?.tradeDate === date ? rootDayPrev.news ?? [] : []),
    ...(rootLatestPrev?.tradeDate === date ? rootLatestPrev.news ?? [] : []),
  ];
  const mergedNews = uniquifyNewsIds(
    dedupeNews(
      keepUncoveredNews(
        mergeWechatNews(snapshot.news, previousNews, wechatOkWithItems),
        previousNews,
      ),
    ),
  );
  const toWrite: DaySnapshot = { ...snapshot, news: mergedNews };

  const etfHasData = (etf: EtfDashboard | undefined) =>
    !!(etf?.indices?.length) ||
    Object.values(etf?.productsByFirm || {}).some((arr) => (arr as unknown[]).length > 0);

  if (!etfHasData(toWrite.etf)) {
    const keepEtf =
      (sameDayPrev?.etf && etfHasData(sameDayPrev.etf) ? sameDayPrev.etf : null) ||
      (latestPrev?.etf && etfHasData(latestPrev.etf) ? latestPrev.etf : null) ||
      (rootDayPrev?.etf && etfHasData(rootDayPrev.etf) ? rootDayPrev.etf : null) ||
      (rootLatestPrev?.etf && etfHasData(rootLatestPrev.etf) ? rootLatestPrev.etf : null);
    if (keepEtf) {
      toWrite.etf = keepEtf;
      toWrite.errors = [...(toWrite.errors || []), "etf: 本次 iFinD 不可用，已保留上次行情"];
      if (toWrite.status === "ok") toWrite.status = "partial";
    }
  }

  // 质量守卫：行情完全为空时不发布，避免用坏数据覆盖已有数据
  if (!etfHasData(toWrite.etf)) {
    throw new Error("发布被拒绝：ETF 行情数据为空，可能 iFinD 接口暂时无返回，请重试");
  }

  const jsonBody = JSON.stringify(toWrite, null, 2);

  await ghPutFile(dayPath, jsonBody, githubToken, dayExisting && dayExisting.sha, `data: ${date}（云端一键更新）`);
  await ghPutFile(latestPath, jsonBody, githubToken, latestExisting && latestExisting.sha, `data: latest -> ${date}`);

  const datesExisting = await ghGetFile(datesPath, githubToken);
  let dates: string[] = [];
  if (datesExisting && datesExisting.content) {
    try {
      const parsed = JSON.parse(fromBase64(datesExisting.content));
      if (Array.isArray(parsed)) dates = parsed;
    } catch {
      dates = [];
    }
  }
  if (!dates.includes(date)) dates.push(date);
  dates.sort();
  await ghPutFile(datesPath, JSON.stringify(dates, null, 2), githubToken, datesExisting && datesExisting.sha, `data: 更新 dates.json`);

  return { date, files: [dayPath, latestPath, datesPath], snapshot: toWrite };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export default {
  async fetch(request: Request, env: Record<string, string | undefined>) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/refresh" && request.method === "POST") {
      let body: { token?: string; tradeDate?: string; publish?: boolean };
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400, corsHeaders());
      }
      const token = body.token || "";
      if (!token) return json({ error: "missing token (iFinD refresh_token)" }, 400, corsHeaders());
      const tradeDate = body.tradeDate || beijingToday();
      const publish = !!body.publish;
      try {
        const result = await handleRefresh({ token, tradeDate });
        if (publish) {
          const gh = await publishSnapshot(result as DaySnapshot, env.GITHUB_TOKEN || "");
          return json({ ...gh.snapshot, published: { date: gh.date, files: gh.files } }, 200, corsHeaders());
        }
        return json(result, 200, corsHeaders());
      } catch (e) {
        return json({ error: String((e && (e as Error).message) || e) }, 502, corsHeaders());
      }
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      let body: { token?: string; tradeDate?: string; publish?: boolean };
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400, corsHeaders());
      }
      const token = body.token || "";
      if (!token) return json({ error: "missing token (iFinD refresh_token)" }, 400, corsHeaders());
      const tradeDate = body.tradeDate || beijingToday();
      const publish = !!body.publish;
      try {
        const result = await handleIngest({
          token,
          tradeDate,
          weweBaseUrl: env.WEWE_RSS_URL || "",
          weweAuth: env.WEWE_AUTH_CODE || "",
          scrapeProxyUrl: env.SCRAPE_PROXY_URL || "",
          scrapeProxyToken: env.SCRAPE_PROXY_TOKEN || "",
        });
        const { wechatOkWithItems, ...snapshot } = result;
        if (publish) {
          const gh = await publishSnapshot(snapshot, env.GITHUB_TOKEN || "", wechatOkWithItems);
          return json({ ...gh.snapshot, published: { date: gh.date, files: gh.files } }, 200, corsHeaders());
        }
        return json(snapshot, 200, corsHeaders());
      } catch (e) {
        return json({ error: String((e && (e as Error).message) || e) }, 502, corsHeaders());
      }
    }

    return json({ error: "not found (use POST /refresh or POST /ingest)" }, 404, corsHeaders());
  },
};
