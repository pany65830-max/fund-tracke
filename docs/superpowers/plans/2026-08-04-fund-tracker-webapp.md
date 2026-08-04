# 基金信息追踪网页应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建团队内部基金资讯 + 四家公司 ETF 看板静态站，交易日 08:30 由 GitHub Actions 自动拉数写入 JSON，经 Cloudflare Pages / GitHub Pages 免费发布。

**Architecture:** 仓库内新增独立目录 `fund-tracker/`：共享 TypeScript 数据契约（zod）→ Node 日更脚本写出 `data/YYYY-MM-DD.json` → Vite+React 静态前端只读 JSON。iFind / 微信 / 交易所均以可替换 adapter 接入；缺凭证或单源失败时降级并写 `status: partial`，不影响站点可读。

**Tech Stack:** TypeScript, Node 20+, Vitest, Zod, Vite, React 18, React Router 6, GitHub Actions, Cloudflare Pages（优先）

**Spec:** `docs/superpowers/specs/2026-08-04-fund-tracker-webapp-design.md`

## Global Constraints

- 无登录、无邮件、不镜像微信全文
- 仅华夏 / 易方达 / 国泰 / 华泰柏瑞 ETF；资讯另含上交所、深交所
- 交易日 08:30 Asia/Shanghai 更新；历史约 90 个交易日
- 视觉：简洁金融风（浅灰底、白卡片、红涨绿跌）
- 密钥仅 GitHub Secrets / 本地 `.env`；不得提交真实密钥
- 新代码全部放在 `fund-tracker/`（勿改动仓库内既有 skill/研报脚本，除非改根 `.gitignore` / `.github/workflows`）

---

## File Structure

```text
fund-tracker/
  package.json                 # workspace scripts: test, build, ingest
  tsconfig.json
  vitest.config.ts
  .env.example
  README.md
  shared/
    schema.ts                  # zod schemas + inferred types
    classify.ts                # 资讯类型打标
    dedupe.ts                  # 去重（优先保留有正文）
    calendar.ts                # 交易日 / 休市判断
    prune.ts                   # 滚动删除 >90 交易日
  config/
    institutions.json
    wechat-accounts.json
    exchange-sources.json
    etf-whitelist.json
    category-rules.json
    holidays-cn.json           # 休市日 YYYY-MM-DD 列表（可逐年补）
  scripts/
    ingest.ts                  # CLI 入口：跑一日流水线
    adapters/
      types.ts                 # NewsAdapter / EtfAdapter 接口
      ifind-news.ts
      ifind-etf.ts
      wechat.ts
      exchange-web.ts
      fixtures.ts              # 无密钥时的演示数据
    write-snapshot.ts
  data/
    .gitkeep
    latest.json                # 指向最近成功日的副本，便于前端默认加载
    2026-08-01.json            # 示例快照（Task 中生成）
  web/
    package.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      styles.css
      lib/loadData.ts
      components/Layout.tsx
      components/DateNav.tsx
      components/StatusBanner.tsx
      pages/NewsPage.tsx
      pages/NewsDetailPage.tsx
      pages/EtfPage.tsx
      components/etf/IndexCards.tsx
      components/etf/SectorGrid.tsx
      components/etf/HotLists.tsx
      components/etf/ProductTables.tsx
.github/workflows/fund-tracker-daily.yml
```

---

### Task 1: Scaffold + shared Zod schema

**Files:**
- Create: `fund-tracker/package.json`
- Create: `fund-tracker/tsconfig.json`
- Create: `fund-tracker/vitest.config.ts`
- Create: `fund-tracker/shared/schema.ts`
- Create: `fund-tracker/shared/schema.test.ts`
- Create: `fund-tracker/data/.gitkeep`
- Create: `fund-tracker/.env.example`
- Modify: `.gitignore`（确保忽略 `fund-tracker/.env`、`node_modules`、`web/dist`）

**Interfaces:**
- Produces: zod schemas `NewsItemSchema`, `EtfDashboardSchema`, `DaySnapshotSchema`；类型 `NewsItem`, `EtfDashboard`, `DaySnapshot`；枚举机构/类型/来源/状态字面量如下面代码

- [ ] **Step 1: 写入 package / tsconfig / vitest，并写失败测试**

`fund-tracker/package.json`:
```json
{
  "name": "fund-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "ingest": "tsx scripts/ingest.ts",
    "build:web": "npm run build --prefix web"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "zod": "^3.24.1"
  },
  "dependencies": {
    "zod": "^3.24.1"
  }
}
```

`fund-tracker/shared/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DaySnapshotSchema } from "./schema";

describe("DaySnapshotSchema", () => {
  it("accepts a minimal valid snapshot", () => {
    const parsed = DaySnapshotSchema.parse({
      tradeDate: "2026-08-03",
      updatedAt: "2026-08-03T08:30:00+08:00",
      status: "ok",
      news: [
        {
          id: "n1",
          title: "示例研报",
          summary: "摘要",
          institution: "huatai",
          category: "research",
          source: "ifind",
          publishedAt: "2026-08-03T07:00:00+08:00",
          sourceUrl: "https://example.com/a",
        },
      ],
      etf: {
        indices: [],
        sectors: [],
        hotInflow: [],
        hotGainers: [],
        hotTurnover: [],
        productsByFirm: {},
      },
    });
    expect(parsed.tradeDate).toBe("2026-08-03");
  });
});
```

- [ ] **Step 2: 安装依赖并确认测试因缺少 schema 失败**

Run:
```bash
cd fund-tracker && npm install && npm test
```
Expected: FAIL（无法解析 `./schema` 或 `DaySnapshotSchema` undefined）

- [ ] **Step 3: 实现 schema**

`fund-tracker/shared/schema.ts`:
```ts
import { z } from "zod";

export const InstitutionSchema = z.enum([
  "huaxia",
  "efunds",
  "guotai",
  "huatai",
  "sse",
  "szse",
]);
export type Institution = z.infer<typeof InstitutionSchema>;

export const NewsCategorySchema = z.enum([
  "research",
  "new_product",
  "active_etf",
  "disclosure",
  "exchange",
  "other",
]);
export type NewsCategory = z.infer<typeof NewsCategorySchema>;

export const NewsSourceSchema = z.enum(["ifind", "wechat", "exchange_web"]);
export type NewsSource = z.infer<typeof NewsSourceSchema>;

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  body: z.string().optional(),
  institution: InstitutionSchema,
  category: NewsCategorySchema,
  source: NewsSourceSchema,
  publishedAt: z.string().min(1),
  sourceUrl: z.string().url(),
  coverUrl: z.string().url().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const IndexCardSchema = z.object({
  code: z.string(),
  name: z.string(),
  last: z.number(),
  changePct: z.number(),
});

export const SectorCellSchema = z.object({
  name: z.string(),
  changePct: z.number(),
});

export const EtfRankItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  institution: InstitutionSchema,
  value: z.number(),
  unit: z.enum(["yi", "pct", "yi_amount"]).default("yi"),
});

export const EtfProductSchema = z.object({
  code: z.string(),
  name: z.string(),
  changePct: z.number(),
  volume: z.number().optional(),
  amount: z.number().optional(),
  shares: z.number().optional(),
  nav: z.number().optional(),
});

export const EtfDashboardSchema = z.object({
  indices: z.array(IndexCardSchema),
  sectors: z.array(SectorCellSchema),
  hotInflow: z.array(EtfRankItemSchema),
  hotGainers: z.array(EtfRankItemSchema),
  hotTurnover: z.array(EtfRankItemSchema),
  productsByFirm: z.record(z.array(EtfProductSchema)),
});
export type EtfDashboard = z.infer<typeof EtfDashboardSchema>;

export const DaySnapshotSchema = z.object({
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updatedAt: z.string().min(1),
  status: z.enum(["ok", "partial", "failed"]),
  errors: z.array(z.string()).optional(),
  news: z.array(NewsItemSchema),
  etf: EtfDashboardSchema,
});
export type DaySnapshot = z.infer<typeof DaySnapshotSchema>;
```

- [ ] **Step 4: 再跑测试**

Run: `cd fund-tracker && npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fund-tracker .gitignore
git commit -m "feat(fund-tracker): scaffold package and day snapshot schema"
```

---

### Task 2: Config loaders + category classify + dedupe

**Files:**
- Create: `fund-tracker/config/institutions.json`
- Create: `fund-tracker/config/category-rules.json`
- Create: `fund-tracker/config/etf-whitelist.json`
- Create: `fund-tracker/config/wechat-accounts.json`
- Create: `fund-tracker/config/exchange-sources.json`
- Create: `fund-tracker/config/holidays-cn.json`
- Create: `fund-tracker/shared/classify.ts`
- Create: `fund-tracker/shared/classify.test.ts`
- Create: `fund-tracker/shared/dedupe.ts`
- Create: `fund-tracker/shared/dedupe.test.ts`

**Interfaces:**
- Consumes: `NewsItem`, `NewsCategory`, `Institution` from `shared/schema.ts`
- Produces:
  - `classifyNews(input: { title: string; summary?: string; institution: Institution; sourceHint?: string }): NewsCategory`
  - `dedupeNews(items: NewsItem[]): NewsItem[]`（同机构 + 归一化标题；保留 `body` 更长者，其次 `source==='ifind'`）

- [ ] **Step 1: 写 classify / dedupe 失败测试**

`classify.test.ts` 关键：标题含「招募说明书」→ `disclosure`；含「主动ETF」→ `active_etf`；含「发行」「认购」→ `new_product`；含「研报」「策略」→ `research`；机构为 sse/szse → `exchange`；否则 `other`。

`dedupe.test.ts`：两条同机构同标题，一条无 body 来自 wechat，一条有 body 来自 ifind → 结果长度 1 且保留 ifind body。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd fund-tracker && npm test`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写入 config JSON + 实现 classify/dedupe**

`category-rules.json` 示例：
```json
{
  "disclosure": ["招募说明书", "公告", "信披", "份额变动", "上市交易"],
  "active_etf": ["主动ETF", "主动管理ETF", "主动型ETF"],
  "new_product": ["发行", "认购", "募集", "新品", "发售"],
  "research": ["研报", "策略会", "月报", "季报观点", "投资观点"]
}
```

`classify.ts`：先若 `institution` 为 `sse`|`szse` 返回 `exchange`；再按规则数组 `includes` 匹配标题+摘要；默认 `other`。

`dedupe.ts`：`normalizeTitle(t) = t.replace(/\s+/g,'').toLowerCase()`；Map key = `${institution}::${normalizeTitle}`。

- [ ] **Step 4: 测试通过**

Run: `cd fund-tracker && npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fund-tracker/config fund-tracker/shared
git commit -m "feat(fund-tracker): add classify/dedupe and source configs"
```

---

### Task 3: Trading calendar + prune

**Files:**
- Create: `fund-tracker/shared/calendar.ts`
- Create: `fund-tracker/shared/calendar.test.ts`
- Create: `fund-tracker/shared/prune.ts`
- Create: `fund-tracker/shared/prune.test.ts`

**Interfaces:**
- Consumes: `config/holidays-cn.json`（字符串数组）
- Produces:
  - `isTradingDay(date: string, holidays: Set<string>): boolean`（周末或 holidays → false）
  - `previousTradingDay(date: string, holidays: Set<string>): string`
  - `listSnapshotFiles(dataDir: string): string[]`（测试可用内存/临时目录）
  - `pruneOldSnapshots(dataDir: string, keepTradingDays: number, holidays: Set<string>, io): Promise<string[]>` 返回删除的文件名；`keepTradingDays` 默认 `90`

- [ ] **Step 1: 写测试**

- 2026-08-01（周六）`isTradingDay` false  
- holidays 含某周一则该日 false  
- 临时目录放入 5 个交易日 json，`keepTradingDays=3` 后只剩 3 个最新交易日文件  

- [ ] **Step 2: 跑测失败 → 实现 → 跑通 → Commit**

```bash
git add fund-tracker/shared/calendar.ts fund-tracker/shared/prune.ts fund-tracker/shared/*.test.ts fund-tracker/config/holidays-cn.json
git commit -m "feat(fund-tracker): trading calendar and 90-day prune"
```

---

### Task 4: Adapter interfaces + fixture providers

**Files:**
- Create: `fund-tracker/scripts/adapters/types.ts`
- Create: `fund-tracker/scripts/adapters/fixtures.ts`
- Create: `fund-tracker/scripts/adapters/fixtures.test.ts`

**Interfaces:**
- Produces:
```ts
export interface NewsAdapter {
  name: string;
  fetchNews(tradeDate: string): Promise<NewsItem[]>;
}
export interface EtfAdapter {
  name: string;
  fetchEtf(tradeDate: string): Promise<EtfDashboard>;
}
export function createFixtureNewsAdapter(): NewsAdapter;
export function createFixtureEtfAdapter(): EtfAdapter;
```
Fixture 必须返回 **通过 `DaySnapshotSchema` 校验** 的样例：至少 6 条资讯（覆盖四家+交易所、多种 category），ETF 含 indices/sectors/三热榜/按四家分组 products。

- [ ] **Step 1–4: TDD 实现 fixture adapters，测试 `NewsItemSchema.array().parse(await adapter.fetchNews(...))` 与 ETF schema**
- [ ] **Step 5: Commit** `feat(fund-tracker): add news/etf adapter interfaces and fixtures`

---

### Task 5: Exchange website adapter（真实 HTTP，可软失败）

**Files:**
- Create: `fund-tracker/scripts/adapters/exchange-web.ts`
- Create: `fund-tracker/scripts/adapters/exchange-web.test.ts`
- Modify: `fund-tracker/config/exchange-sources.json`

**Interfaces:**
- Consumes: `exchange-sources.json` 形如：
```json
[
  {"institution":"sse","name":"上交所","listUrl":"https://www.sse.com.cn/","linkSelector":"a","titleFrom":"text"},
  {"institution":"szse","name":"深交所","listUrl":"https://www.szse.cn/","linkSelector":"a","titleFrom":"text"}
]
```
- Produces: `createExchangeWebAdapter(fetchImpl?: typeof fetch): NewsAdapter`
- 解析策略首版：**尽力而为**：用 `fetch` 取 HTML，用正则提取 `<a href="...">标题</a>`（避免强依赖 cheerio 也可先加 `node-html-parser` 依赖）。将相对链接补全为绝对 URL；`category` 先标 `exchange`；`summary` 可用标题；无 body。
- 网络失败时：**抛错由上层捕获**，adapter 自身也可返回 `[]` 并 `console.error`——统一约定：**抛 `Error`，由 ingest 记入 errors**。

- [ ] **Step 1: 单测用 mock fetch 返回固定 HTML，断言解析出 ≥1 条且 institution/source 正确**
- [ ] **Step 2–4: 实现 → 测试通过**
- [ ] **Step 5: Commit** `feat(fund-tracker): exchange website news adapter`

---

### Task 6: WeChat adapter（配置 feed，无则跳过）

**Files:**
- Create: `fund-tracker/scripts/adapters/wechat.ts`
- Create: `fund-tracker/scripts/adapters/wechat.test.ts`
- Modify: `fund-tracker/config/wechat-accounts.json`

**Interfaces:**
- `wechat-accounts.json`:
```json
[
  {"institution":"huaxia","name":"华夏基金","accountId":"","feedUrl":""},
  {"institution":"efunds","name":"易方达基金","accountId":"","feedUrl":""},
  {"institution":"guotai","name":"国泰基金","accountId":"","feedUrl":""},
  {"institution":"huatai","name":"华泰柏瑞","accountId":"","feedUrl":""},
  {"institution":"sse","name":"上交所","accountId":"","feedUrl":""},
  {"institution":"szse","name":"深交所","accountId":"","feedUrl":""}
]
```
- `createWechatAdapter(): NewsAdapter`
- 若某账号 `feedUrl` 为空 → 跳过该账号（不抛错）
- 若有 `feedUrl`：按 RSS/Atom 解析 `<item>`/`<entry>` 的 title/link/description（可用正则或 `fast-xml-parser`）；`source:'wechat'`；**不填 body**
- 单测：mock 一段 RSS XML → 解析 2 条

- [ ] **Step 1–5: TDD + Commit** `feat(fund-tracker): wechat feed adapter with soft skip`

---

### Task 7: iFind news + ETF adapters（凭证驱动，无凭证走 fixture 合并策略在 ingest）

**Files:**
- Create: `fund-tracker/scripts/adapters/ifind-news.ts`
- Create: `fund-tracker/scripts/adapters/ifind-etf.ts`
- Create: `fund-tracker/scripts/adapters/ifind-news.test.ts`
- Create: `fund-tracker/scripts/adapters/ifind-etf.test.ts`
- Modify: `fund-tracker/.env.example`

**Interfaces:**
- Env: `IFIND_BASE_URL`, `IFIND_TOKEN`（或官方 SDK 所需变量，名称写进 `.env.example` 注释）
- `createIfindNewsAdapter(): NewsAdapter`  
  - 无 token → `throw new Error("IFIND_TOKEN missing")`（由 ingest 决定是否改用 fixture）  
  - 有 token → `GET/POST` 到可配置 path（默认用 env `IFIND_NEWS_PATH`）；将返回 JSON **映射**为 `NewsItem[]`（映射函数单独导出 `mapIfindNewsRow(row): NewsItem`，便于单测）
- `createIfindEtfAdapter(whitelist): EtfAdapter` 同理；只保留 whitelist 内代码
- **注意：** 真实 iFind 字段名以你们账号文档为准；计划要求映射层集中在 `mapIfind*`，字段名用明确的 `row["标题"]` / `row.title` 双读兼容，并在 README 说明需按实盘微调

`.env.example`:
```bash
IFIND_BASE_URL=
IFIND_TOKEN=
IFIND_NEWS_PATH=/api/news
IFIND_ETF_PATH=/api/etf
IFIND_USE_FIXTURE=1
```

- [ ] **Step 1: 单测只测 `mapIfindNewsRow` / `mapIfindEtfPayload` 纯函数（不打真网）**
- [ ] **Step 2–4: 实现 adapters**
- [ ] **Step 5: Commit** `feat(fund-tracker): ifind adapters with mappable row shapes`

---

### Task 8: Ingest pipeline CLI

**Files:**
- Create: `fund-tracker/scripts/write-snapshot.ts`
- Create: `fund-tracker/scripts/ingest.ts`
- Create: `fund-tracker/scripts/ingest.test.ts`

**Interfaces:**
- Produces:
  - `async function runIngest(opts: { tradeDate: string; dataDir: string; useFixture: boolean }): Promise<DaySnapshot>`
  - 流程：若非交易日 → throw 或写 skip（CLI exit 0 并打印 skip；测试覆盖交易日路径）
  - 并行/顺序拉取 news adapters → `classify` 每条 → `dedupe` → etf adapter
  - 任一路失败：`errors.push`，`status = news与etf都空 ? 'failed' : 'partial'`
  - 成功写入 `dataDir/${tradeDate}.json` 与 `dataDir/latest.json`
  - 调用 `pruneOldSnapshots(..., 90)`
- CLI: `tsx scripts/ingest.ts --date=YYYY-MM-DD`；缺省用上海时区当天；`IFIND_USE_FIXTURE=1` 时 news/etf 用 fixture（仍可叠加 exchange）

- [ ] **Step 1: 集成测试在临时目录 `runIngest({useFixture:true})`，断言文件存在且 `DaySnapshotSchema.safeParse` success**
- [ ] **Step 2–4: 实现 write-snapshot + ingest**
- [ ] **Step 5: 本地跑一次生成示例数据并 Commit（含 `data/*.json` 样例）**

```bash
cd fund-tracker && IFIND_USE_FIXTURE=1 npm run ingest -- --date=2026-08-03
git add fund-tracker/scripts fund-tracker/data
git commit -m "feat(fund-tracker): daily ingest pipeline writing JSON snapshots"
```

---

### Task 9: Web app shell — Layout, DateNav, routing, data load

**Files:**
- Create: `fund-tracker/web/package.json`
- Create: `fund-tracker/web/vite.config.ts`
- Create: `fund-tracker/web/index.html`
- Create: `fund-tracker/web/tsconfig.json`
- Create: `fund-tracker/web/src/main.tsx`
- Create: `fund-tracker/web/src/App.tsx`
- Create: `fund-tracker/web/src/styles.css`
- Create: `fund-tracker/web/src/lib/loadData.ts`
- Create: `fund-tracker/web/src/lib/loadData.test.ts`
- Create: `fund-tracker/web/src/components/Layout.tsx`
- Create: `fund-tracker/web/src/components/DateNav.tsx`
- Create: `fund-tracker/web/src/components/StatusBanner.tsx`
- Create: `fund-tracker/web/src/pages/NewsPage.tsx`（先占位标题）
- Create: `fund-tracker/web/src/pages/EtfPage.tsx`（占位）
- Create: `fund-tracker/web/src/pages/NewsDetailPage.tsx`（占位）

**Interfaces:**
- Vite `publicDir` 或 `vite.config.ts` 把 `../data` 拷到 `dist/data`（`viteStaticCopy` 或 build 脚本 `cp -r`）；开发服务器 alias `/data` → `../data`
- `loadSnapshot(date: string): Promise<DaySnapshot>` fetch `/data/${date}.json`；`loadLatest(): Promise<DaySnapshot>` fetch `/data/latest.json`
- 路由：`/` → 资讯；`/etf` → ETF；`/news/:id` → 详情；query `?date=YYYY-MM-DD`
- `DateNav`：上一交易日/下一交易日按钮（前端用 `holidays-cn.json` 静态 import 或内嵌最近一年休市表）
- `StatusBanner`：根据 `status` 显示「数据日期 · 今日已更新」或「部分更新失败」

**样式约束（styles.css）：**
```css
:root {
  --bg: #f5f6f8;
  --card: #ffffff;
  --text: #1a1a1a;
  --muted: #6b7280;
  --up: #c41e3a;
  --down: #128a4b;
  --border: #e5e7eb;
  --accent: #1e3a5f;
}
body { margin:0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background:var(--bg); color:var(--text); }
```

- [ ] **Step 1: `loadData.test.ts` 用 vitest + mock fetch 测 parse**
- [ ] **Step 2: scaffold web，`npm install` in web/**
- [ ] **Step 3: 实现 Layout/DateNav/StatusBanner/路由**
- [ ] **Step 4: `npm run build --prefix web` 成功**
- [ ] **Step 5: Commit** `feat(fund-tracker): vite react shell with date navigation`

---

### Task 10: News list + filters + detail page

**Files:**
- Modify: `fund-tracker/web/src/pages/NewsPage.tsx`
- Modify: `fund-tracker/web/src/pages/NewsDetailPage.tsx`
- Create: `fund-tracker/web/src/components/NewsFilters.tsx`
- Create: `fund-tracker/web/src/components/NewsCard.tsx`
- Create: `fund-tracker/web/src/lib/newsFilters.ts`
- Create: `fund-tracker/web/src/lib/newsFilters.test.ts`

**Interfaces:**
- `filterNews(items, { institution: Institution|'all', category: NewsCategory|'all' }): NewsItem[]`
- 列表展示：标题、机构标签、类型标签、来源、时间、摘要
- 详情：有 `body` 渲染正文（注意 `white-space`/`dangerouslySetInnerHTML` **仅当确认为纯文本或已消毒**；首版按 **纯文本** `white-space:pre-wrap` 输出）；始终显示「阅读原文」`<a href={sourceUrl} target="_blank" rel="noopener noreferrer">`
- 中文标签映射表写在 `web/src/lib/labels.ts`

- [ ] **Step 1: 单测 filter 组合**
- [ ] **Step 2–4: 实现页面**
- [ ] **Step 5: Commit** `feat(fund-tracker): news list filters and detail page`

---

### Task 11: ETF dashboard modules (A/B/E/F)

**Files:**
- Modify: `fund-tracker/web/src/pages/EtfPage.tsx`
- Create: `fund-tracker/web/src/components/etf/IndexCards.tsx`
- Create: `fund-tracker/web/src/components/etf/SectorGrid.tsx`
- Create: `fund-tracker/web/src/components/etf/HotLists.tsx`
- Create: `fund-tracker/web/src/components/etf/ProductTables.tsx`
- Create: `fund-tracker/web/src/lib/format.ts`
- Create: `fund-tracker/web/src/lib/format.test.ts`

**Interfaces:**
- `formatPct(n: number): string` → 红涨绿跌用 class `up`/`down`
- 页面顺序：IndexCards → SectorGrid → HotLists（净流入/涨幅/成交）→ ProductTables（按 huaxia/efunds/guotai/huatai 分组）
- 响应式：`grid` + `@media (max-width: 768px)` 单列

- [ ] **Step 1: formatPct 单测**
- [ ] **Step 2–4: 实现四模块**
- [ ] **Step 5: Commit** `feat(fund-tracker): etf dashboard overview sectors hotlists products`

---

### Task 12: GitHub Actions daily workflow + README

**Files:**
- Create: `.github/workflows/fund-tracker-daily.yml`
- Create: `fund-tracker/README.md`
- Modify: `fund-tracker/package.json`（如需 `ci` script）

**Workflow 要求：**
```yaml
name: fund-tracker-daily
on:
  schedule:
    - cron: "30 0 * * 1-5"   # 08:30 CST = 00:30 UTC（注意 DST 不适用中国）
  workflow_dispatch:
jobs:
  ingest-and-deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: fund-tracker
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: fund-tracker/package-lock.json
      - run: npm ci
      - name: Ingest
        env:
          IFIND_BASE_URL: ${{ secrets.IFIND_BASE_URL }}
          IFIND_TOKEN: ${{ secrets.IFIND_TOKEN }}
          IFIND_USE_FIXTURE: ${{ secrets.IFIND_USE_FIXTURE }}
        run: npm run ingest
      - name: Skip commit if non-trading skip file
        # ingest 非交易日应 exit 0 且不改数据；有变更才 commit
      - run: |
          git config user.name "github-actions"
          git config user.email "github-actions@users.noreply.github.com"
          git add data
          git diff --staged --quiet || git commit -m "data: update fund-tracker snapshot"
          git push
      - name: Build web
        run: npm install --prefix web && npm run build --prefix web
      # Cloudflare Pages：用 cloudflare/pages-action 或将 web/dist 上传；
      # 若暂无 Cloudflare token，则 push 后由 Pages 连 Git 自动构建（需在 README 写清手动绑定步骤）
```

**README 必须包含：** 本地 `npm i` / `npm test` / `IFIND_USE_FIXTURE=1 npm run ingest` / `npm run dev --prefix web`；Secrets 列表；Cloudflare Pages 绑定 `fund-tracker/web` 与构建命令；如何补 `holidays-cn.json`；微信 `feedUrl` 配置说明。

- [ ] **Step 1: 添加 workflow + README**
- [ ] **Step 2: 本地再跑 `npm test` 与 `web` build 冒烟**
- [ ] **Step 3: Commit** `ci(fund-tracker): add weekday ingest workflow and README`

---

## Self-Review vs Spec

| Spec 要求 | 对应 Task |
|---|---|
| 资讯页 + 机构/类型筛选 | Task 10 |
| 详情全文/摘要+原文链接 | Task 10 |
| ETF A/B/E/F 模块、仅四家 | Task 4 fixtures + 7 whitelist + 11 |
| iFind + 微信 + 交易所官网 | Task 5–7 |
| 交易日 08:30 自动更新 | Task 12 cron |
| 90 日历史翻看 | Task 3 prune + Task 9 DateNav |
| 免费 GitHub Actions + Pages | Task 12 |
| 无登录/无邮件/不镜像微信 | Global Constraints + Task 6/10 |
| 简洁金融风 | Task 9 CSS |
| 密钥不进库 | `.env.example` + Secrets |
| partial 失败可展示 | Task 8 status + Task 9 StatusBanner |

**占位符扫描：** 无 TBD；iFind 字段映射要求纯函数可测，实盘字段名在 README 标明需按账号文档微调（实现不阻塞）。

**类型一致性：** 全程使用 `Institution`/`NewsCategory`/`DaySnapshot` 与 `guotai`（国泰）字面量；前端 labels 与 schema 枚举一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-04-fund-tracker-webapp.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — 每个 Task 开新子代理，Task 间复查，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 分批执行并设检查点  

Which approach?
