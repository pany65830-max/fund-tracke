# 迁移本地抓取侧（换电脑 / 交接）

网站的「云端层」（Cloudflare Worker + GitHub Pages）永远不动，只有「本地抓取侧」这一台电脑是可插拔零件。

## 在新电脑上立起（5 步）

1. 装 Git for Windows 与 Node.js LTS（都勾选 Add to PATH）
2. `git clone https://github.com/pany65830-max/fund-tracke.git`
3. `cd fund-tracke` → `pwsh scripts/setup-local.ps1`
   - 自动 `npm install`、生成 `config/.env`、注册每日计划任务
4. 编辑 `config/.env`，填入 `IFIND_REFRESH_TOKEN`（同花顺 iFinD 插件登录后获取）
5. 试跑一次 `pwsh scripts/daily.ps1`；成功后会 push 到 main 并触发网站更新

## 微信（WeWe，可选）

- `docker compose up -d` 起 WeWe RSS（本地 4000 端口）
- 按 `worker/WEWE-SETUP.md` 用 cloudflared 暴露固定公网地址，并把
  `WEWE_RSS_URL` / `WEWE_AUTH_CODE` 填入 `.env`
- 不配则微信为 0 条（官网 / 交易所 / 行情不受影响）

## 让云端也能抓全（可选，A1）

- 在本机跑 `node scripts/proxy-server.mjs`（设 `PROXY_TOKEN`）
- cloudflared 暴露该代理，把 `SCRAPE_PROXY_URL` / `SCRAPE_PROXY_TOKEN` 配进 Worker 环境变量
  （`wrangler secret put`），再 `wrangler deploy`
- 详见 `worker/SCRAPE-PROXY.md`

## 旧电脑下线

直接关掉 / 不再开机即可。云端网站与 Worker 不受影响；新电脑接手后无缝继续。
