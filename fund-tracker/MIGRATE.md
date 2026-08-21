# 换电脑 / 交接（日常推送走 GitHub SSH:443，无代理）

每天 **09:00** 本机拉数 → 经 **SSH:443 直连推 GitHub**（不需要开代理/VPN，SSH 通道 Clash 不拦截）→
GitHub Pages 自动部署：

https://pany65830-max.github.io/fund-tracke/

GitHub 服务器在境外，但**走 SSH（不是网页 HTTPS）就能无代理直连**——已实测通过。不要把日常更新押在 workers.dev 或本机开代理上。

## 在新电脑上立起

1. 装 Git for Windows 与 Node.js LTS（都勾选 Add to PATH）
2. **从 GitHub 克隆**：

   ```powershell
   git clone https://github.com/pany65830-max/fund-tracke.git
   cd fund-tracke
   ```

3. `pwsh scripts/setup-local.ps1`
   - 生成专属 SSH 钥匙 `~/.ssh/fund_tracker_ed25519`
   - `npm install`、生成 `config/.env`、登记每日 **09:00** 计划任务（电池也能跑）
   - 自动确认 origin 指向 GitHub（保留 gitee 作为可选镜像）
4. **把 SSH 公钥加入 GitHub deploy key**（脚本会打印公钥，必做）：
   - 打开 https://github.com/pany65830-max/fund-tracke/settings/keys
   - [Add deploy key] → Title 填 `fund-tracker-daily` → 粘贴公钥 → 勾选 **Allow write** → Add key
5. 编辑 `config/.env`，填入 `IFIND_REFRESH_TOKEN`（同花顺 iFinD，搬不走，必须重填）
6. 微信：`docker compose up -d`，打开 http://127.0.0.1:4000 **重新扫码订阅**（WeWe 登录态不能拷到另一台机）
7. 试跑 `pwsh scripts/daily.ps1`；成功后数据上 GitHub，一两分钟 Pages 重建完成

功能和旧电脑应一致：同一套代码、同一份 `data/`、同一批公众号（需在新机 WeWe 里再订一次）。

## 旧电脑下线

关掉即可。新电脑接手后，定时任务写的是新电脑上的 `scripts/daily.ps1`，没有写死路径。
请删掉旧电脑上的计划任务「FundTrackerDailyIngest」，避免两台同时推。

## 转交同事

真正要给同事的只有：

1. **GitHub 仓库写权限**（把同事加为 collaborator，或在 deploy key 里加他的 SSH 公钥并勾 Allow write）
2. **同事自己的 iFinD token**（他按上面第 5 步自己填）
3. 同事自己扫 WeWe

> 注：Gitee 镜像（如有）是可选的国内加速，不影响主线。若要开，同事另填 `GITEE_TOKEN` 即可，文档不变。
