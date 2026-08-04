# 微信公众号列表抓取（搜狗）— 设计补充

**日期：** 2026-08-04  
**状态：** 已确认  
**范围：** fund-tracker 资讯补源（不镜像全文）  
**关联：** `docs/superpowers/specs/2026-08-04-fund-tracker-webapp-design.md`

---

## 1. 目标

为六家公众号自动拉取**近期推文列表**（标题、摘要、原文链接），写入日快照，详情页仅摘要 +「阅读原文」。

## 2. 账号（首版）

| institution | 搜索用公众号名 |
|---|---|
| huaxia | 华夏基金 |
| efunds | 易方达基金 |
| guotai | 国泰基金 |
| huatai | 华泰柏瑞基金 |
| sse | 上交所发布 |
| szse | 深交所 |

配置文件：`fund-tracker/config/wechat-accounts.json`  
- `name`：搜狗搜索词  
- `publishers`：结果页发布账号名白名单（过滤媒体转载；如华泰柏瑞常用「华泰柏瑞微理财」）  
- `feedUrl`：可选，非空则优先 RSS

## 3. 技术方案

**选定：搜狗微信公开搜索列表（方案 B）**

1. 若某账号配置了非空 `feedUrl` → 仍优先走 RSS（二期友好，本轮可不填）。
2. 否则请求搜狗微信文章搜索页（`type=2`，query = 公众号名），解析列表项：
   - 标题
   - 摘要（若有）
   - 原文链接（解搜狗中转链；解不出则保留可点的中转 URL）
   - 时间：能解析则用；否则用当日 `tradeDate` 占位
3. `source: "wechat"`；**不填 `body`**。
4. 进入现有 classify / dedupe 流水线。

**不做：** 全文镜像、登录 Cookie、付费 RSS、自建 RSSHub。

## 4. 容错

- 单账号 HTTP/解析失败：记录 `wechat:<institution>: …`，继续其它账号。
- 全部账号无结果且无 RSS：返回空数组（不抛致命错），由 ingest 标 `partial`/`ok`。
- GitHub 海外节点若被搜狗拦截：当天可无微信条，不影响站点与其它源；失败不覆盖 `latest.json`（沿用既有空失败保护）。

## 5. 请求约定

- 使用常见浏览器 `User-Agent`。
- 账号间短间隔（可选，避免连打）；首版可用极短 delay 或无 delay。
- 每账号最多保留约 10 条；若能识别日期，优先保留 `tradeDate` 当天（或近 2 日）的条目。

## 6. 验收

- 单元测试：mock HTML → 解析出 ≥1 条合法 `NewsItem`（含 `sourceUrl`）。
- `feedUrl` 为空时走搜狗路径；有 `feedUrl` 时不打搜狗。
- 配置中华泰柏瑞 / 上交所 / 深交所名称与上表一致。

## 7. 后续（暂缓，非本轮）

- iFinD `report_query` 无数据问题（另记待办）。
- 搜狗改版后的选择器维护；或再评估 RSSHub 自建。
