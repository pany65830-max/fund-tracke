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

浏览器打开 Vite 提示的本地地址。

Windows PowerShell：

```powershell
$env:IFIND_USE_FIXTURE="1"; npm run ingest -- --date=2026-08-03
```

## 配置

| 文件 | 用途 |
|---|---|
| `config/etf-whitelist.json` | 四家公司 ETF 白名单 |
| `config/wechat-accounts.json` | 公众号；填写 `feedUrl`（RSS）后才会拉取 |
| `config/exchange-sources.json` | 上交所/深交所官网入口 |
| `config/category-rules.json` | 资讯类型关键词 |
| `config/holidays-cn.json` | A 股休市日（逐年补充） |

## iFind 密钥

复制 `.env.example` 为 `.env`（勿提交）。GitHub Actions 使用 Secrets：

- `IFIND_BASE_URL`
- `IFIND_TOKEN`
- `IFIND_NEWS_PATH` / `IFIND_ETF_PATH`（可选）
- `IFIND_USE_FIXTURE=1`（无正式接口时用演示数据）

`scripts/adapters/ifind-*.ts` 中的 `mapIfind*` 按实盘字段微调。

## 部署（免费）

1. 推送本仓库到 GitHub  
2. Settings → Pages → Source 选 **GitHub Actions**  
3. 工作流：`.github/workflows/fund-tracker-daily.yml`（工作日 08:30 北京时间）  
4. 也可改绑 **Cloudflare Pages**：构建目录 `fund-tracker/web`，命令 `npm install && npm run build`，根目录设为 `fund-tracker/web`，并确保构建前有 `data/`（可由 Actions 先 ingest 再构建）

## 页面

- `/` 基金资讯（机构 + 类型筛选）  
- `/news/:id` 详情（有正文则展示；始终提供原文链接）  
- `/etf` ETF 看板（概览 / 板块 / 热榜 / 产品表）  
- `?date=YYYY-MM-DD` 历史翻看  
