# 网页填 iFinD API —— 部署小抄

## 这个功能干嘛用
网站右上角多了个「⚙ 数据」按钮。点开填两样：
1. **中间人地址（Worker URL）** —— 下面第 1 步部署后得到
2. **你的 iFinD token（refresh_token）**

填好保存，点「立即刷新」，网站就通过 Cloudflare 中间人去 iFinD 拉最新行情 + 资讯，覆盖当前看板。
token 只存在你浏览器，并经中间人转发，**不进任何代码、不进 GitHub**。

### 两个按钮的区别
- **「立即刷新（仅本机预览）」**：拉数据只显示在你当前浏览器，刷新网页就没了；别人打开网站看不到。适合临时看当天行情。
- **「更新并发布（写线上）」**：拉 iFinD 数据后，让 Worker 把 `data/{日期}.json` + `latest.json` + `dates.json` **写回 GitHub 仓库**，自动触发 Pages 重新部署，**线上所有人都能看到最新数据**。相当于"点一下就更新线上"，彻底摆脱对本机定时任务的依赖。
  - 前提：Worker 配置了 `GITHUB_TOKEN`（见下方第 0 步）。
  - 发布后 GitHub Pages 重新部署约需 1–2 分钟，耐心等一下再强刷网站。

---

## 第 0 步（仅「更新并发布」需要）：给 Worker 配 GitHub 写权限
「更新并发布」要往你的仓库写文件，所以需要创建一个 **GitHub Personal Access Token (PAT)**：

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
   （即 `fund-tracker/worker`，里面已有 `index.js` / `products.js` / `wrangler.toml`）
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
   或点「更新并发布」→ 看到"已写入 2026-xx-xx 并触发部署"即成功（线上所有人可见）

---

## 常见问题
- **刷新失败：`get_access_token failed`** → token 不对或没权限，检查 token 是否完整粘贴。
- **刷新失败：网络错误 / fetch failed** → Worker URL 填错，或 Cloudflare 端网络问题。
- **行情正常、资讯 0 条** → 你的 iFinD 账号可能没开「资讯查询(report_query)」接口权限，这是账号权限问题，不是代码问题。
- **点「更新并发布」提示 `Worker 未配置 GITHUB_TOKEN`** → 没做第 0 步，或 wrangler deploy 前没 put secret；重跑 `wrangler secret put GITHUB_TOKEN` 再 `wrangler deploy`。
- **发布报错 `GitHub 写入 ... 失败: 401`** → PAT 无效或没勾 `repo` 权限；去 GitHub 重新生成带 repo 权限的 token 并 wrangler secret put。
- **想换 token** → 再点「⚙ 数据」改完保存即可；「清除」会删掉浏览器里存的设置。

## 回滚
本次改动已打备份点 `backup-pre-api-20260817`。若需要回到改动前：
```
git checkout backup-pre-api-20260817
```
