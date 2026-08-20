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

---

## 转交同事（离职场景）

和「换自己电脑」几乎一样，**只多一步"云端访问权转移"**。核心结论先放这：

> 你电脑里**没有"必须搬"的东西**——代码在 GitHub、网站跑在 Cloudflare、历史数据在仓库、定时任务只是一段可一键生成的脚本。
> 真正要转移的只有三样：**① GitHub 仓库访问权 ② Cloudflare Worker 的部署权（或重发 GITHUB_TOKEN）③ 同事自己的 iFinD token**。
> 其中 ③ 是唯一"搬不了、必须重发"的（原 token 绑你的 iFinD 登录，你离职后失效）。

### A. 云端层：转移访问权，不搬代码

1. **GitHub 仓库**：Settings → Collaborators 把同事加为协作者，或把仓库转给公司 / 同事账号。
   代码、Pages、以及历史 `fund-tracker/data/*.json` 全在仓库里，无需搬运。
2. **Cloudflare Worker**：Worker 用的 `GITHUB_TOKEN` 是**绑你 GitHub 账号**的 PAT（只勾了 `repo` 权限）。两种处理：
   - **推荐**：在 Cloudflare 把同事加为成员（或转账户给公司）→ 同事本机 `wrangler login` → `wrangler deploy` 重新部署 → `wrangler secret put GITHUB_TOKEN`（填同事**自己**的 GitHub PAT）。
   - 不转账户也行：只要 GitHub 侧把同事账号加为 collaborator，原 Worker 能继续工作（相当于 PAT 还在）。但规范做法是重发 PAT 并注销你的。

### B. 本地侧：同事按上面「5 步」立起，唯一要重发的是 iFinD token

- 同事机器：`git clone` → `pwsh scripts/setup-local.ps1` → 填 `config/.env`。
- **`IFIND_REFRESH_TOKEN` 必须换成同事自己的 iFinD 账号 token**（原 token 绑你的 iFinD 登录，离职后失效/应注销）。这是唯一"搬不了"的。
- 微信 / 代理（若启用了）：`WEWE_RSS_URL` / `SCRAPE_PROXY_URL` 是绑**你这台电脑隧道地址**的，换机器后地址会变 → 同事重新 `wrangler secret put` 这两个 Worker 变量（`WEWE_AUTH_CODE` / `SCRAPE_PROXY_TOKEN` 同理重设）。详见 `worker/WEWE-SETUP.md`、`worker/SCRAPE-PROXY.md`。

### C. 你下线前收尾

- 注销你的 iFinD 登录；在 GitHub Settings → Developer settings 删掉 Worker 用的那个 `GITHUB_TOKEN` 对应 PAT（若走 A 推荐方案已由同事重发，则你的可删）。
- 电脑交还 / 关机即可。云端网站与 Worker 不依赖你电脑，同事接手后无缝继续。

### 一句话 checklist（交接当天照着勾）

- [ ] 同事已能访问 GitHub 仓库（collaborator / 转让）
- [ ] 同事已能部署 Worker（Cloudflare 成员 / 重发 GITHUB_TOKEN）
- [ ] 同事机器已 `git clone` + `setup-local.ps1` + 填入**同事自己的** `IFIND_REFRESH_TOKEN`
- [ ] 若用微信/代理：同事重设 `WEWE_RSS_URL`/`SCRAPE_PROXY_URL` 等 Worker 密钥
- [ ] 你已注销 iFinD 登录 + 撤销自己的 GitHub PAT
