// worker/index.js — Cloudflare Worker: iFinD API proxy for fund-tracker
//
// 作用：网站前端把 iFinD 的 refresh_token 发过来，本 Worker 代为调用 iFinD，
//       返回与项目 data/*.json 完全同构的 DaySnapshot（etf + news）。
// 安全：无状态，不持久化 token（每次请求从 body 取）；CORS 允许任意来源。
//
// 部署：在本目录 `wrangler login` 后 `wrangler deploy`，部署地址填进网站「⚙ 数据」面板。

import { PRODUCTS } from "./products.js";

const BASE = "https://quantapi.51ifind.com/api/v1";

// —— GitHub 发布配置（Worker 把快照写回仓库，触发 Pages 重新部署）——
// 注意：仓库名少了字母 r（fund-tracke），勿擅自改。
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

// code -> firm 映射（来自内置白名单）
const CODE_FIRM = new Map();
for (const p of PRODUCTS) CODE_FIRM.set(p.code, p.firm);

function classifyNews(title, summary, institution) {
  if (institution === "sse" || institution === "szse") return "exchange";
  const text = `${title}\n${summary || ""}`;
  for (const key of CATEGORY_ORDER) {
    for (const kw of CATEGORY_RULES[key] || []) {
      if (text.includes(kw)) return key;
    }
  }
  return "other";
}

function toThsCode(code) {
  const c = String(code).replace(/\.(SH|SZ)$/i, "");
  if (c.startsWith("5") || c.startsWith("6") || c.startsWith("000")) return `${c}.SH`;
  return `${c}.SZ`;
}
function bareCode(thscode) {
  return String(thscode).replace(/\.(SH|SZ)$/i, "");
}
function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}
function flattenTables(tables) {
  if (!tables || !Array.isArray(tables)) return [];
  const rows = [];
  for (const table of tables) {
    if (!table || typeof table !== "object") continue;
    const t = table;
    const thscode = String(t.thscode || t.THSCODE || "");
    const keys = Object.keys(t).filter((k) => k !== "thscode" && k !== "THSCODE");
    const arrayKeys = keys.filter((k) => Array.isArray(t[k]));
    if (arrayKeys.length) {
      const n = Math.max(...arrayKeys.map((k) => t[k].length), 1);
      for (let i = 0; i < n; i++) {
        const row = { thscode };
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

async function getAccessToken(refresh) {
  if (!refresh) throw new Error("missing iFinD token");
  const res = await fetch(`${BASE}/get_access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", refresh_token: refresh },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`get_access_token invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = json.errorcode ?? json.errorCode ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(`get_access_token failed: ${json.errmsg || json.errorMsg || text.slice(0, 200)}`);
  }
  const token = json.data && json.data.access_token;
  if (!token) throw new Error("get_access_token: access_token empty");
  return token;
}

async function ifindPost(path, body, accessToken) {
  const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: accessToken },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} invalid JSON: ${text.slice(0, 200)}`);
  }
  const code = json.errorcode ?? json.errorCode ?? 0;
  if (!res.ok || code !== 0) {
    throw new Error(`${path} failed: ${json.errmsg || json.errorMsg || `code=${code}`}`);
  }
  return json;
}

function emptyEtf() {
  return {
    indices: [],
    sectors: [],
    hotInflow: [],
    hotGainers: [],
    hotTurnover: [],
    productsByFirm: { huaxia: [], efunds: [], guotai: [], huatai: [] },
  };
}

function yuanToYi(v) {
  if (!v) return 0;
  if (Math.abs(v) < 1000) return v;
  return v / 1e8;
}

async function fetchEtf(accessToken) {
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

  const byCode = new Map();
  for (const t of json.tables || []) {
    const ths = String(t.thscode || "");
    const tbl = t.table || {};
    const first = (k) => (Array.isArray(tbl[k]) ? tbl[k][0] : tbl[k]);
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

  const calcChangePct = (row) => {
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

  const productsByFirm = { huaxia: [], efunds: [], guotai: [], huatai: [] };
  const flatProducts = [];
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
    .map((p) => ({ code: p.code, name: p.name, institution: p.firm, value: +p.changePct.toFixed(2), unit: "pct" }));

  const hotTurnover = [...flatProducts]
    .sort((a, b) => b.amountYi - a.amountYi)
    .slice(0, 5)
    .map((p) => ({ code: p.code, name: p.name, institution: p.firm, value: +p.amountYi.toFixed(2), unit: "yi_amount" }));

  const sectors = SECTORS.map((s) => {
    const members = s.codes.map((c) => byCode.get(c)).filter(Boolean);
    if (!members.length) return null;
    const avg = members.reduce((a, r) => a + calcChangePct(r), 0) / members.length;
    return { name: s.name, changePct: +avg.toFixed(2) };
  }).filter(Boolean);

  return { indices, sectors, hotInflow: [], hotGainers, hotTurnover, productsByFirm };
}

function addDays(date, delta) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function mapInstitutionByCode(thscode) {
  const bare = bareCode(thscode);
  const found = PRODUCTS.find((p) => p.code === bare);
  return found ? found.firm : "huatai";
}

async function fetchNews(accessToken, tradeDate) {
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
  const rows = flattenTables(json.tables);
  const items = [];
  rows.forEach((row, idx) => {
    const title = String(row.reportTitle || row.title || "").trim();
    if (!title) return;
    const thscode = String(row.thscode || "");
    const institution = mapInstitutionByCode(thscode);
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
      category: classifyNews(title, summary, institution),
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

async function handleRefresh({ token, tradeDate }) {
  const accessToken = await getAccessToken(token);
  const results = await Promise.allSettled([
    fetchEtf(accessToken),
    fetchNews(accessToken, tradeDate),
  ]);
  const etf = results[0].status === "fulfilled" ? results[0].value : emptyEtf();
  const news = results[1].status === "fulfilled" ? results[1].value : [];
  const errors = [];
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

// —— GitHub Contents API：把快照写回仓库，触发 Pages 重新部署 ——
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGetFile(path, token) {
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub 读取 ${path} 失败: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function ghPutFile(path, content, token, sha, message) {
  const body = { message, content: toBase64(content), branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub 写入 ${path} 失败: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 把完整 DaySnapshot 写回仓库三个文件：
 *   data/{tradeDate}.json, data/latest.json, data/dates.json
 * 写 main 分支会自动触发 Pages 部署（deploy.yml on push main）。
 */
async function publishSnapshot(snapshot, githubToken) {
  if (!githubToken) {
    throw new Error("Worker 未配置 GITHUB_TOKEN，请用 `wrangler secret put GITHUB_TOKEN` 配置（需 repo 写权限）");
  }
  const date = snapshot.tradeDate;
  const json = JSON.stringify(snapshot, null, 2);

  const dayPath = `data/${date}.json`;
  const dayExisting = await ghGetFile(dayPath, githubToken);
  await ghPutFile(
    dayPath,
    json,
    githubToken,
    dayExisting && dayExisting.sha,
    `data: ${date}（iFinD 实时，经 Worker 发布）`,
  );

  const latestExisting = await ghGetFile("data/latest.json", githubToken);
  await ghPutFile(
    "data/latest.json",
    json,
    githubToken,
    latestExisting && latestExisting.sha,
    `data: latest -> ${date}`,
  );

  const datesExisting = await ghGetFile("data/dates.json", githubToken);
  let dates = [];
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
  await ghPutFile(
    "data/dates.json",
    JSON.stringify(dates, null, 2),
    githubToken,
    datesExisting && datesExisting.sha,
    `data: 更新 dates.json`,
  );

  return { date, files: [dayPath, "data/latest.json", "data/dates.json"] };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === "/refresh" && request.method === "POST") {
      let body;
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
          const gh = await publishSnapshot(result, env && env.GITHUB_TOKEN);
          result.published = gh;
        }
        return json(result, 200, corsHeaders());
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502, corsHeaders());
      }
    }
    return json({ error: "not found (use POST /refresh)" }, 404, corsHeaders());
  },
};
