# 基金信息追踪（fund-tracker）

团队内部日报站：四家基金公司资讯 + ETF 看板。交易日自动拉数，静态站免费托管。

## 本地开发

```bash
cd fund-tracker
npm install
npm test

# 生成演示数据（无 iFind 密钥时自动用 fixture）
IFIND_USE_FIXTURE=1 npm run ingest -- --date=2026-08-03

cd web
npm install
npm run dev
```

Windows PowerShell：

```powershell
$env:IFIND_USE_FIXTURE="1"; npm run ingest -- --date=2026-08-03
```

## 正式拉数（推荐：本机）

GitHub Actions 跑在**海外**，经常连不上 `quantapi.51ifind.com`，会导致站点被写成空数据。  
**正式数据请在国内网络的电脑上拉数后推送 `data/`。**

1. 复制 `.env.example` → `.env`，填入 `IFIND_REFRESH_TOKEN`（同花顺 Super Command 刷新令牌）
2. 本机执行：

```powershell
cd fund-tracker
npm install
npm run ingest
```

3. 工作日早上由 `scripts/daily.ps1` 提交 `data/` 并推到码云；GitHub Pages 随后同步。

失败时若当天完全无数据，**不会覆盖**已有的 `latest.json`，避免把网站刷成空白。

## 微信公众号

默认用**搜狗微信文章搜索**按公众号名拉近期标题/摘要/链接（不存全文）。  
账号在 `config/wechat-accounts.json`：`name` 为搜索词，`publishers` 为官方发布名白名单（过滤媒体转载；华泰柏瑞常见为「华泰柏瑞微理财」）。  
若填了 `feedUrl` 则优先 RSS。搜狗验证码/拦截时该源记 partial。

设计说明：`docs/superpowers/specs/2026-08-04-wechat-sogou-design.md`

## 配置

| 文件 | 用途 |
|---|---|
| `config/etf-whitelist.json` | 四家公司 ETF 白名单 |
| `config/wechat-accounts.json` | 公众号名（搜狗搜索用）；若填写 `feedUrl` 则优先走 RSS |
| `config/exchange-sources.json` | 上交所/深交所官网入口 |
| `config/category-rules.json` | 资讯类型关键词 |
| `config/holidays-cn.json` | A 股休市日（逐年补充） |

## iFind 密钥

- 本机：`fund-tracker/.env` 中的 `IFIND_REFRESH_TOKEN`
- GitHub：Secrets 里的 `IFIND_REFRESH_TOKEN`（海外节点可能仍失败）
- 调试演示：`IFIND_USE_FIXTURE=1`

## 部署（免费）

1. 本机工作日 **09:00** 拉数，推送到码云 `py6666654/fund-tracke`（直连，不用代理）  
2. GitHub Actions `sync-from-gitee.yml` 把码云镜像过来，再由 `deploy.yml` 发布 Pages  
3. 网站：https://pany65830-max.github.io/fund-tracke/  
4. 换电脑：按 `MIGRATE.md` 从码云 clone，重跑 `scripts/setup-local.ps1`

## 页面

- `/` 基金资讯（机构 + 类型筛选）  
- `/news/:id` 详情（有正文则展示；仅在有真实链接时显示「阅读原文」）  
- `/etf` ETF 看板（当日亮眼 + 产品涨跌对比）  
- `?date=YYYY-MM-DD` 历史翻看  
