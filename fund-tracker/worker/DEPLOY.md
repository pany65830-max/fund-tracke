# 网页填 iFinD API —— 部署小抄

## 这个功能干嘛用
网站右上角多了个「⚙ 数据」按钮。点开填两样：
1. **中间人地址（Worker URL）** —— 下面第 1 步部署后得到
2. **你的 iFinD token（refresh_token）**

填好保存，点「立即刷新」，网站就通过 Cloudflare 中间人去 iFinD 拉最新行情 + 资讯，覆盖当前看板。
token 只存在你浏览器，并经中间人转发，**不进任何代码、不进 GitHub**。

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
6. 点「立即刷新」→ 看到「已更新于 xx:xx」即成功，看板变成最新数据

---

## 常见问题
- **刷新失败：`get_access_token failed`** → token 不对或没权限，检查 token 是否完整粘贴。
- **刷新失败：网络错误 / fetch failed** → Worker URL 填错，或 Cloudflare 端网络问题。
- **行情正常、资讯 0 条** → 你的 iFinD 账号可能没开「资讯查询(report_query)」接口权限，这是账号权限问题，不是代码问题。
- **想换 token** → 再点「⚙ 数据」改完保存即可；「清除」会删掉浏览器里存的设置。

## 回滚
本次改动已打备份点 `backup-pre-api-20260817`。若需要回到改动前：
```
git checkout backup-pre-api-20260817
```
