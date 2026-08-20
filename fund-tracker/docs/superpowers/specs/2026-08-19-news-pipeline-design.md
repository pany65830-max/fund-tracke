# 基金看板资讯管线改造 — 设计文档

**日期：** 2026-08-19  
**状态：** 已批准并落地（微信需本机 WeWe + 命名隧道后才有新文章）  
**范围：** 资讯拉取 / 去重归日 / 云端一键更新；不改 ETF 行情逻辑，不改 iFinD `report_query`

---

## 1. 目标

团队以网页 **「一键全量更新并发布」** 为日常主路径：点一次后，线上资讯应包含四家基金公司官方公告、沪深交易所相关公告，以及 10 个官方微信公众号当天文章。本机 08:30 定时任务保留为兜底。

验收：

1. 打开某一天，列表里是当天官方材料，不出现华夏银行/华夏学子等串味内容。
2. 同一篇无日期的官网旧稿不会连续多天顶在列表上。
3. 一键更新成功时，官网 + 交易所应有当天条目（若当天确实有公告）；微信在 WeWe/Tunnel 可达时一并写入。
4. WeWe/Tunnel 不可达时，官网和 ETF 仍更新，且 **不删除** 当天文件里已有的微信条目。
5. iFinD 资讯继续软失败，不把整站标成故障。

---

## 2. 明确不做

- 继续使用搜狗微信文章搜索（默认关闭，配置可留作废代码，ingest 不再调用）。
- 在 Cloudflare Worker 内扫码、登录微信或运行 WeWe。
- 镜像微信全文到自建详情页（列表标题 + 摘要 + 原文链接即可，与现状一致）。
- 接 iFinD `report_query` 换参/换接口（按既有约定暂缓）。
- 抓取申赎清单 PCF 等交易文件当资讯。
- 付费微信 RSS、媒体转载源。

---

## 3. 总体架构

```text
同事点「一键全量更新并发布」
        │
        ▼
Cloudflare Worker POST /ingest
  ├─ ETF 行情（iFinD，现有）
  ├─ 四家官网公告/新闻（补栏目 + 真实日期）
  ├─ 上交所基金专区 + 巨潮按 ETF 代码
  ├─ iFinD 资讯（软失败）
  └─ GET WeWe RSS（本机 Docker + Cloudflare Tunnel）
        │
        ▼
去重 → 按北京时间归当天 → 与已有快照合并微信
        │
        ▼
写 GitHub fund-tracker/data/{date,latest,dates}.json → Pages 部署
```

本机 `npm run ingest` 使用 **同一套适配器与同一套过滤规则**。微信适配器在本机可直连 `http://127.0.0.1:4000`，在 Worker 则连 Tunnel 公网 URL。

---

## 4. 资讯源

### 4.1 基金公司官网（主源）

保留现有 7 个栏目，并补上真正每天更新的公告列表：

| 机构 | 必抓栏目 |
|---|---|
| 华夏 | 华夏新闻 `hxdt/hxxw/`（从列表项旁的日期读取，禁止无日期当今天）；信息披露改为请求其列表 JSON，不再解析「暂无内容」空 HTML |
| 易方达 | 现有信息披露页 + **临时公告** `Html5/lm/xxpl/xxpllsgg/` |
| 国泰 | 现有公司公告 + **产品公告** `/Etrade/Report/fundreport/` |
| 华泰柏瑞 | 现有资讯中心/新闻/公司动态 + **临时公告** `/news/information/tempReport/` |

规则：

- 单源 8 秒超时、栏目并行；一栏失败不影响其他栏。
- **没有解析到发布日期的条目不进入当天快照**（可丢弃或写入日志，不得再默认 `tradeDateT08:00+08:00`）。
- 有日期但不等于当天的条目，适配器层可先带回近 14 天，ingest 末尾仍按北京日期 = 当天过滤。
- 入库 `source: company_web`；分类仍走现有 `classifyNews`。

### 4.2 交易所（主源）

| 通道 | 用途 |
|---|---|
| 上交所基金网站 `http://etf.sse.com.cn/disclosure/` | 上交所基金/ETF 公告主列表（替换「搜索索引经常滞后」的主依赖） |
| 巨潮 `hisAnnouncement/query` | 按白名单 **415 只 ETF 代码** 查当天公告（不再只全文搜关键词 `ETF`） |
| 现有 `sse-search` | 仅当基金专区当天 0 条时，再用同一 `tradeDate` 搜一遍；仍 0 条就空，不把旧日期公告塞进当天 |

规则：

- 巨潮按代码查询需控制请求量：按市场分批、限制当天窗口、失败软错误。
- `source` 仍为 `exchange_web`；机构按代码前缀映射 sse/szse（现有逻辑）。
- 不做市商服务类公告若标题可识别，保留（属于交易所资讯）；不另开类型。

### 4.3 微信官方号（主源，经 WeWe）

采集方式：本机 WeWe RSS（微信读书）→ HTTP JSON/Atom → ingest/Worker 拉取。

订阅 10 个号（与现配置一致，名称以 WeWe 里实际订阅的官方号为准）：

| 机构 | 公众号 |
|---|---|
| huaxia | 华夏基金 |
| efunds | 易方达微资讯 |
| guotai | 国泰基金 |
| huatai | 华泰柏瑞微理财 |
| sse | 上交所发布、上交所投服 |
| szse | 深交所、深交所投服、深交所上市通、深市基金 |

规则：

- `source: wechat`；交易所号分类为 `exchange`。
- 只收录 WeWe 返回的该号文章，不再用发布者子串/品牌词去搜全网。
- 按 `pubDate` 北京日期 = 当天过滤。
- 交易所号发文少，当天 0 条视为正常。
- 配置：`config/wewe-feeds.json` 映射 `institution + name → feedId`；缺 feedId 的号跳过并记软错误。
- Worker 密钥：`WEWE_RSS_URL`（Tunnel 公网根，无尾斜杠）、`WEWE_AUTH_CODE`（与 WeWe `AUTH_CODE` 相同）。本机可用环境变量或 `.env`（已 gitignore）。
- 适配器超时 8 秒；失败不抛硬错误。

### 4.4 iFinD 资讯

保持现有调用与软错误（`report_query failed: no data` 不升格为整站失败）。不作为本规格实现范围。

### 4.5 备份源（二期，本规格不实现）

证监会基金电子披露网站、天天基金公司公告页。官网与巨潮稳定后再单独立项。

---

## 5. 共享处理（本机与 Worker 必须一致）

顺序固定：

1. 各适配器 `fetchNews(tradeDate)`（并行 + 单路超时）。
2. `classifyNews`。
3. `dedupeNews`（机构 + 归一化标题；优先带正文 / ifind）。
4. 只保留北京日期 = `tradeDate` 的条目。
5. id 唯一化（`#k` 后缀）。

**微信合并（云端发布必做）：**

Worker 在写出快照前，读取 GitHub 上已有的 `fund-tracker/data/{tradeDate}.json`（若存在）：

- 取出其中 `source === "wechat"` 且北京日期 = 当天的条目。
- 若本次 WeWe 拉取成功且条数 > 0：用新微信集替换旧微信集。
- 若本次 WeWe 失败或 0 条：保留旧微信集，再与本次官网/交易所结果去重合并。

这样同事在 Tunnel 断开时点更新，不会把早上已写入的公众号文章冲掉。

---

## 6. 线上更新与本机分工

| | 一键全量更新（主路径） | 本机 08:30 ingest（兜底） |
|---|---|---|
| ETF | Worker → iFinD | 本机 → iFinD |
| 官网 / 交易所 | Worker 直连 | 本机直连 |
| 微信 | Worker → Tunnel → 本机 WeWe | 本机 localhost WeWe |
| 电脑关机 | 官网+ETF 仍可更新；微信走「保留旧条目」 | 当天任务不跑 |

「立即刷新（仅本机预览）」仍只拉 iFinD，不写仓库，行为不变。

---

## 7. WeWe + Tunnel 运维（用户本机一次性）

1. 安装 Docker Desktop，运行 WeWe RSS（SQLite 版即可），端口 `4000`，设置 `AUTH_CODE`。
2. 微信读书扫码登录（不要勾选 24 小时自动退出）。
3. 为第 4.3 节 10 个号各贴一篇该号文章链接完成订阅。
4. 安装 `cloudflared`，建 **命名隧道** 指向 `http://127.0.0.1:4000`（不用每次一换的 trycloudflare 随机域名）。
5. 把隧道 HTTPS 根地址和 AUTH_CODE 写入 Worker secrets：`WEWE_RSS_URL`、`WEWE_AUTH_CODE`。
6. 电脑需开着 Docker + cloudflared，同事点更新才能拿到 **新的** 微信；关机时官网/ETF 不受影响。

代码侧提供 `worker/WEWE.md` 口语步骤（Docker 命令、隧道命令、如何把 feedId 填进 `wewe-feeds.json`）。不把 AUTH_CODE 写入仓库。

---

## 8. 代码落点（实现时）

- `config/company-sources.json`：增补栏目；解析策略按站点可加可选字段（如 `kind: html-list | json-list`）。
- `scripts/adapters/company-web.ts`：并行已有；去掉无日期默认今天；按栏目类型解析。
- `scripts/adapters/exchange-web.ts`：改为按 ETF 代码 + 当天窗口查巨潮。
- `scripts/adapters/sse-fund-site.ts`（新）：上交所基金专区列表。
- `scripts/adapters/sse-search.ts`：降为 0 条时的兜底。
- `scripts/adapters/wewe-rss.ts`（新）：替换 ingest 中的 `createWechatAdapter`（搜狗）。
- `scripts/ingest.ts` 与 `worker/index.ts`：同一适配器列表；Worker 微信 URL 来自 secrets；发布前合并旧微信。
- `config/wewe-feeds.json`：feed 映射；未配置时微信源为空数组。
- 测试：日期丢弃、去重、微信合并、巨潮按代码过滤、WeWe 解析夹具。

---

## 9. 实施顺序

1. 官网栏目 + 真实日期 + 关掉搜狗 + 云端合并微信旧条目。
2. 巨潮按代码 + 上交所基金专区。
3. WeWe 适配器 + Worker secrets + `WEWE.md`；用户完成本机 Docker/隧道后接通 10 个号。

每一步都保持「一键更新」可发布；第 3 步完成前微信可能仍为空或仅保留历史合并结果。

---

## 10. 风险

- WeWe 项目已归档，微信读书接口可能随时失效；失效时官网/交易所不受影响，微信那路软失败。
- 命名隧道需本机 `cloudflared` 常驻；随机临时隧道域名一变 Worker 就连不上，故规格要求命名隧道。
- 巨潮按 415 代码查询可能较慢，必须分批 + 总超时，避免再次打满 Worker 30 秒。
- 华夏/国泰等列表若仍是强 JS 渲染，JSON 接口探测失败时该栏目记软错误，不拖死整路。
