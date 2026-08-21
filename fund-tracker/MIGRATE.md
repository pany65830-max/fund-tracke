# 换电脑 / 交接（国内码云为日常推送）

每天 **09:00** 本机拉数 → 经本机小中转 **直连推码云**（不需要开代理）→ 码云 Push 镜像到 GitHub → 网站仍是：

https://pany65830-max.github.io/fund-tracke/

不要把日常更新押在 workers.dev 或本机开代理上。

## 在新电脑上立起

1. 装 Git for Windows 与 Node.js LTS（都勾选 Add to PATH）
2. **从码云克隆**（不要 clone GitHub，国内经常要代理）：

   ```powershell
   git clone https://gitee.com/py6666654/fund-tracke.git
   cd fund-tracke
   ```

3. `pwsh scripts/setup-local.ps1`
   - `npm install`、生成 `config/.env`、登记每日 **09:00** 计划任务（电池也能跑）
   - 自动加上码云 remote
4. 编辑 `config/.env`，填入这台电脑上的 `IFIND_REFRESH_TOKEN`（同花顺 iFinD，搬不走，必须重填）
5. 微信：`docker compose up -d`，打开 http://127.0.0.1:4000 **重新扫码订阅**（WeWe 登录态不能拷到另一台机）
6. 码云第一次 `git push` 要用 **私人令牌**（设置 → 私人令牌），用户名 `py6666654`、密码填令牌
7. 试跑 `pwsh scripts/daily.ps1`；成功后数据上码云，十几分钟内 GitHub 页面会跟上

功能和旧电脑应一致：同一套代码、同一份 `data/`、同一批公众号（需在新机 WeWe 里再订一次）。

## 旧电脑下线

关掉即可。新电脑接手后，定时任务写的是新电脑上的 `scripts/daily.ps1`，没有写死路径。

请删掉旧电脑上的计划任务「FundTrackerDailyIngest」，避免两台同时推。

## 转交同事

真正要给同事的只有：

1. **码云仓库权限**（加协作者，或把 `py6666654/fund-tracke` 转给他）
2. **GitHub 仓库权限**（Pages 还在 GitHub；Action 从码云拉）
3. **同事自己的 iFinD token**
4. 同事自己扫 WeWe

云端「一键更新」Worker 如仍使用，再另转 Cloudflare / `GITHUB_TOKEN`（见 `worker/DEPLOY.md`）。日常自动更新不依赖它。
