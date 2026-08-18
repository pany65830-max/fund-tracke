// worker/index.ts — Cloudflare Worker: iFinD API proxy + full cloud ingest for fund-tracker
//
// 作用：网站前端把 iFinD 的 refresh_token 发过来，Worker 代为拉取 ETF 行情与全部资讯，
//       返回与项目 data/*.json 同构的 DaySnapshot，并可选写回 GitHub 触发 Pages 部署。
// 安全：无状态，不持久化 token；CORS 允许任意来源；GitHub PAT 仅存于 Worker 环境变量。
//
// 部署：在本目录 `wrangler deploy`（PAT 已通过 `wrangler secret put GITHUB_TOKEN` 配置）。

import { PRODUCTS } from "./products.js";
import { createCompanyWebAdapter } from "../scripts/adapters/company-web.js";
import { createWechatAdapter } from "../scripts/adapters/wechat.js";
import { createExchangeWebAdapter } from "../scripts/adapters/exchange-web.js";
import { createSseSearchAdapter } from "../scripts/adapters/sse-search.js";
import { classifyNews } from "../shared/classify.js";
import { dedupeNews } from "../shared/dedupe.js";
import type { DaySnapshot, EtfDashboard, NewsItem } from "../shared/schema.js";

const BASE = "https://quantapi.51ifind.com/api/v1";

const GH_OWNER = "pany65830-max";
const GH_REPO = "fund-tracke";
const GH_BRANCH = "main";

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
  { institution: "guotai" as const, name: "国泰基金-公司公告", listUrl: "https://www.gtfund.com/Etrade/Report/companyreport" },
  { institution: "huatai" as const, name: "华泰柏瑞-资讯中心", listUrl: "http://www.huatai-pb.com/news/index.html" },
  { institution: "huatai" as const, name: "华泰柏瑞-新闻速递", listUrl: "http://www.huatai-pb.com/news/newsd/index.html" },
  { institution: "huatai" as const, name: "华泰柏瑞-公司动态", listUrl: "http://www.huatai-pb.com/news/companyNews/index.html" },
];

// 内联微信配置（Worker 内精简版）：只跑 4 家基金公司主号，避免海外 IP 被搜狗限流/超时。
// 交易所公众号近 30 天几乎无更新，且 Cloudflare 海外节点抓搜狗更慢，故不在 Worker 内跑。
const WECHAT_ACCOUNTS = [
  { institution: "huaxia" as const, name: "华夏基金", brands: ["华夏基金", "华夏财富"], publishers: ["华夏基金", "华夏基金微资讯", "华夏基金客服", "华夏财富", "华夏基金微理财"] },
  { institution: "efunds" as const, name: "易方达微资讯", brands: ["易方达"], publishers: ["易方达微资讯", "易方达基金", "易方达投资者教育", "易方达微理财"] },
  { institution: "guotai" as const, name: "国泰基金", brands: ["国泰基金"], publishers: ["国泰基金", "国泰基金微资讯", "国泰基金微理财"] },
  { institution: "huatai" as const, name: "华泰柏瑞微理财", brands: ["华泰柏瑞"], publishers: ["华泰柏瑞微理财", "华泰柏瑞基金", "华泰柏瑞", "华泰柏瑞微资讯"] },
];

// 内联交易所配置（与 config/exchange-sources.json 一致）
const CNINFO_CFG = {
  endpoint: "https://www.cninfo.com.cn/new/fulltextSearch/full",
  keywords: ["ETF"],
  pageSize: 30,
  maxAgeDays: 7,
};

// code -> firm 映射
const CODE_FIRM = new Map<string, string>();
for (const p of PRODUCTS) CODE_FIRM.set(p.code, p.firm);

function classifyNewsLocal(title: string, summary: string, institution: string) {
  if (institution === "sse" || institution === "szse") return "exchange";
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

// —— 全量云端 ingest（行情 + 各资讯源） ——
async function handleIngest({ token, tradeDate }: { token: string; tradeDate: string }) {
  const accessToken = await getAccessToken(token);
  const errors: string[] = [];

  const etfPromise = fetchEtf(accessToken).catch((e) => {
    errors.push(`etf: ${e.message}`);
    return emptyEtf();
  });

  const adapters = [
    createCompanyWebAdapter(fetch, COMPANY_SOURCES),
    createWechatAdapter(fetch, {
      accounts: WECHAT_ACCOUNTS,
      sameDayOnly: false,
      maxAgeDays: 7,
      pages: 1,
      delayMs: 1200,
    }),
    createExchangeWebAdapter(fetch, CNINFO_CFG),
    createSseSearchAdapter(fetch),
  ];

  const newsBatches = await Promise.allSettled(
    adapters.map((adapter) =>
      Promise.race([
        adapter.fetchNews(tradeDate),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("adapter timeout (20s)")), 20000)
        ),
      ])
    ),
  );

  let news: NewsItem[] = [];
  for (let i = 0; i < adapters.length; i++) {
    const res = newsBatches[i];
    if (res.status === "fulfilled") {
      news.push(...res.value);
    } else {
      errors.push(`${adapters[i].name}: ${res.reason && res.reason.message}`);
    }
  }

  // iFinD 资讯作为补充
  const ifindNewsPromise = fetchIfindNews(accessToken, tradeDate).catch((e) => {
    errors.push(`ifind-news: ${e.message}`);
    return [] as NewsItem[];
  });
  news.push(...(await ifindNewsPromise));

  news = news.map((n) => ({
    ...n,
    category: classifyNews({ title: n.title, summary: n.summary, institution: n.institution }, CATEGORY_RULES),
  }));
  news = dedupeNews(news);
  news = news.filter((n) => beijingDate(n.publishedAt) === tradeDate);

  // id 唯一化
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
  } as DaySnapshot;
}

// —— GitHub Contents API：把快照写回仓库，触发 Pages 重新部署 ——
function toBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromBase64(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
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
  return res.json() as Promise<{ sha: string; content?: string }>;
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

async function publishSnapshot(snapshot: DaySnapshot, githubToken: string) {
  if (!githubToken) {
    throw new Error("Worker 未配置 GITHUB_TOKEN，请用 `wrangler secret put GITHUB_TOKEN` 配置（需 repo 写权限）");
  }
  // 质量守卫：行情完全为空时不发布，避免用坏数据覆盖已有数据
  const hasProducts = snapshot.etf && Object.values(snapshot.etf.productsByFirm || {}).some((arr) => (arr as unknown[]).length > 0);
  const hasIndices = snapshot.etf?.indices && snapshot.etf.indices.length > 0;
  if (!hasProducts && !hasIndices) {
    throw new Error("发布被拒绝：ETF 行情数据为空，可能 iFinD 接口暂时无返回，请重试");
  }
  const date = snapshot.tradeDate;
  const json = JSON.stringify(snapshot, null, 2);

  // 注意：Pages 构建时 copyDataPlugin 读的是 fund-tracker/data/，不是根目录 data/
  const dayPath = `fund-tracker/data/${date}.json`;
  const dayExisting = await ghGetFile(dayPath, githubToken);
  await ghPutFile(dayPath, json, githubToken, dayExisting && dayExisting.sha, `data: ${date}（云端一键更新）`);

  const latestExisting = await ghGetFile("fund-tracker/data/latest.json", githubToken);
  await ghPutFile("fund-tracker/data/latest.json", json, githubToken, latestExisting && latestExisting.sha, `data: latest -> ${date}`);

  const datesExisting = await ghGetFile("fund-tracker/data/dates.json", githubToken);
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
  await ghPutFile("fund-tracker/data/dates.json", JSON.stringify(dates, null, 2), githubToken, datesExisting && datesExisting.sha, `data: 更新 dates.json`);

  return { date, files: [dayPath, "fund-tracker/data/latest.json", "fund-tracker/data/dates.json"] };
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
          (result as Record<string, unknown>).published = gh;
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
        const result = await handleIngest({ token, tradeDate });
        if (publish) {
          const gh = await publishSnapshot(result, env.GITHUB_TOKEN || "");
          (result as Record<string, unknown>).published = gh;
        }
        return json(result, 200, corsHeaders());
      } catch (e) {
        return json({ error: String((e && (e as Error).message) || e) }, 502, corsHeaders());
      }
    }

    return json({ error: "not found (use POST /refresh or POST /ingest)" }, 404, corsHeaders());
  },
};
