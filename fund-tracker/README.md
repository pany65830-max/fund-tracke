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

3. 提交并推送 `fund-tracker/data`（以及如有 UI 改动一并推送），GitHub Pages 会重新部署。

失败时若当天完全无数据，**不会覆盖**已有的 `latest.json`，避免把网站刷成空白。

## 配置

| 文件 | 用途 |
|---|---|
| `config/etf-whitelist.json` | 四家公司 ETF 白名单 |
| `config/wechat-accounts.json` | 公众号；填写 `feedUrl`（RSS）后才会拉取 |
| `config/exchange-sources.json` | 上交所/深交所官网入口 |
| `config/category-rules.json` | 资讯类型关键词 |
| `config/holidays-cn.json` | A 股休市日（逐年补充） |

## iFind 密钥

- 本机：`fund-tracker/.env` 中的 `IFIND_REFRESH_TOKEN`
- GitHub：Secrets 里的 `IFIND_REFRESH_TOKEN`（海外节点可能仍失败）
- 调试演示：`IFIND_USE_FIXTURE=1`

## 部署（免费）

1. 推送本仓库到 GitHub  
2. Settings → Pages → Source 选 **GitHub Actions**  
3. 工作流：`.github/workflows/fund-tracker-daily.yml`（工作日 08:30 北京时间）  
4. 若 Actions 拉数失败，以本机推送的 `data/` 为准

## 页面

- `/` 基金资讯（机构 + 类型筛选）  
- `/news/:id` 详情（有正文则展示；仅在有真实链接时显示「阅读原文」）  
- `/etf` ETF 看板（当日亮眼 + 产品涨跌对比）  
- `?date=YYYY-MM-DD` 历史翻看  
