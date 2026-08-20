# 网页填 iFinD API —— 部署小抄

## 这个功能干嘛用
网站右上角多了个「⚙ 数据」按钮。点开填两样：
1. **中间人地址（Worker URL）** —— 下面第 1 步部署后得到
2. **你的 iFinD token（refresh_token）**

填好保存，点「立即刷新」，网站就通过 Cloudflare 中间人去 iFinD 拉最新行情 + 资讯，覆盖当前看板。
token 只存在你浏览器，并经中间人转发，**不进任何代码、不进 GitHub**。

### 两个按钮的区别
- **「立即刷新（仅本机预览）」**：只拉 iFinD 行情 + iFinD 资讯(`report_query`)，只显示在你当前浏览器，刷新网页就没了；别人打开网站看不到。适合临时看当天行情。
- **「一键全量更新并发布（写线上）」**：Worker 拉取 **ETF 行情 + 全部资讯源**（基金公司官网、巨潮白名单 ETF、上交所基金专区、WeWe 微信 RSS、iFinD 资讯），去重过滤后把 `data/{日期}.json` + `latest.json` + `dates.json` **写回 GitHub 仓库**，自动触发 Pages 重新部署，**线上所有人都能看到最新数据**。相当于"点一下就更新线上"，彻底摆脱对本机定时任务的依赖。
  - 前提：Worker 配置了 `GITHUB_TOKEN`（见下方第 0 步）。微信另需本机 WeWe + 命名隧道，见 `WEWE.md`。
  - 发布后 GitHub Pages 重新部署约需 1–2 分钟，耐心等一下再强刷网站。
  - Worker 必须写回 `fund-tracker/data/*.json`（网站构建读这里）。只写仓库根目录 `data/` 不会更新线上看板。
  - 注意：云端 Worker 的出口 IP 是海外机房，部分基金公司官网可能被反爬；微信不走搜狗，改走你电脑上的 WeWe。Tunnel 断开时官网和 ETF 仍更新，且不会冲掉当天已有微信条目。

---

## 第 0 步（仅「一键全量更新并发布」需要）：给 Worker 配 GitHub 写权限
「一键全量更新并发布」要往你的仓库写文件，所以需要创建一个 **GitHub Personal Access Token (PAT)**：

1. 打开 https://github.com/settings/tokens （或 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic)）
2. 点 **Generate new token (classic)**
3. Note 随便写（如 `fund-tracker-worker`），**Expiration** 选长一点（如 90 天或 No expiration）
4. **勾选 `repo` 权限**（即全仓库读写）—— 这是唯一必须勾的
5. 点 Generate token，复制那串 `ghp_xxx`（只显示一次，存好）
6. 在 `worker` 目录下，把 token 设为 Worker 的加密密钥：
   ```
   cd worker
   wrangler secret put GITHUB_TOKEN
   ```
   提示输入时粘贴 `ghp_xxx`。它会存进 Cloudflare 加密环境变量，**不进代码、不在仓库里**。
7. 重新部署一次 Worker 让密钥生效：
   ```
   wrangler deploy
   ```

微信公众号另需两个密钥（本机 WeWe + 命名隧道就绪后再配，步骤见 `WEWE.md`）：

```
wrangler secret put WEWE_RSS_URL
wrangler secret put WEWE_AUTH_CODE
```

> ⚠️ 安全提示：这个 PAT 有你仓库的**写权限**。它只存在 Cloudflare 的加密配置里（你自己的账号），不在前端代码、也不在你浏览器。若担心泄露，可随时在 GitHub 撤销该 token，Worker 的发布能力会立即失效，但不影响「立即刷新」预览。

---

## 第 1 步：部署中间人（Cloudflare Worker，只需做一次）
前提：你有 Cloudflare 账号（免费就够）。

1. 安装 wrangler（若没装）：
   ```
   npm install -g wrangler
   ```
2. 命令行进入本项目的 `worker` 目录：
   ```
   cd worker
   ```
   （即 `fund-tracker/worker`，里面已有 `index.ts` / `products.js` / `wrangler.toml`）
3. 登录 Cloudflare：
   ```
   wrangler login
   ```
   会弹浏览器，登录你的 Cloudflare 账号并授权。
4. 发布：
   ```
   wrangler deploy
   ```
   成功后终端会打印 Worker 地址，形如：
   `https://fund-tracker-ifind-proxy.<你的子域>.workers.dev`
   **把这一整串复制下来**（下一步要用）。

---

## 第 2 步：把前端推上线
每次改前端都要推。用你平时的推送方式即可，例如双击 `fund-tracker-push.bat`，
或等每天 08:30 定时任务自动跑。
推送后 GitHub Actions 会自动重新构建并部署到 GitHub Pages。

---

## 第 3 步：在网站里填
1. 打开网站，**Ctrl+F5** 强制刷新（确保是最新版）
2. 点右上角「⚙ 数据」
3. 中间人地址：粘贴第 1 步得到的 Worker URL
4. iFinD token：粘贴你的 iFinD `refresh_token`
5. 点「保存」
6. 点「立即刷新」→ 看到「已更新于 xx:xx」即成功，看板变成最新数据（仅本机预览）
   或点「一键全量更新并发布」→ 看到"已全量更新 2026-xx-xx 并触发部署"即成功（线上所有人可见）

---

## 常见问题
- **刷新失败：`get_access_token failed`** → token 不对或没权限，检查 token 是否完整粘贴。
- **全量更新失败：`get_access_token invalid JSON: error code: 520`** → Cloudflare 机房在海外，iFinD 常拦这种访问。新版 Worker 会跳过 iFinD，继续拉官网/交易所，并保留上次 ETF 行情；请重新部署后再点一次「一键全量更新」。本机「立即刷新」仍依赖 iFinD，海外失败属正常。
- **刷新失败：网络错误 / fetch failed** → Worker URL 填错，或 Cloudflare 端网络问题。
- **行情正常、资讯 0 条** → 你的 iFinD 账号可能没开「资讯查询(report_query)」接口权限，这是账号权限问题，不是代码问题。
- **点「一键全量更新并发布」没有微信** → 先按 `WEWE.md` 在本机跑 WeWe 和命名隧道，并把 `WEWE_RSS_URL`、`WEWE_AUTH_CODE` 写入 Worker secrets。官网和 ETF 不受影响；当天已有微信不会被冲掉。
- **点「一键全量更新并发布」提示 `Worker 未配置 GITHUB_TOKEN`** → 没做第 0 步，或 wrangler deploy 前没 put secret；重跑 `wrangler secret put GITHUB_TOKEN` 再 `wrangler deploy`。
- **发布报错 `GitHub 写入 ... 失败: 401`** → PAT 无效或没勾 `repo` 权限；去 GitHub 重新生成带 repo 权限的 token 并 wrangler secret put。
- **想换 token** → 再点「⚙ 数据」改完保存即可；「清除」会删掉浏览器里存的设置。

## 回滚
本次改动已打备份点 `backup-pre-api-20260817`。若需要回到改动前：
```
git checkout backup-pre-api-20260817
```
