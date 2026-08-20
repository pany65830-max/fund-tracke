# WeWe RSS 本机部署（微信资讯源）

微信改走本机 WeWe RSS（不再用搜狗）。WeWe 是一个开源 RSS 服务，订阅你关注的基金公司公众号。

## 1. 起服务（Docker）

项目根已有 `docker-compose.yml`：

```powershell
docker compose up -d
```

- 默认地址 http://127.0.0.1:4000
- 首次打开 http://127.0.0.1:4000 用 `admin` / `admin` 登录，添加要订阅的公众号
  （华夏 / 易方达 / 国泰 / 华泰柏瑞 官方号；`feedId` 可空，适配器按名称匹配）
- 镜像 tag 如有变动，以 WeWe RSS 官方仓库为准

## 2. 让云端 Worker 也能拉到（cloudflared 隧道）

WeWe 在你本机，云端 Cloudflare 默认够不着。两种暴露方式：

- 临时：`cloudflared tunnel --url http://localhost:4000`（给一个会变的一次性地址）
- 稳定：`cloudflared tunnel login` → `cloudflared tunnel create wewe` →
  `cloudflared tunnel route dns wewe wewe.你的域名.com` → 用配置文件常驻

拿到公网地址后，填进 `config/.env`：

```
WEWE_RSS_URL=https://wewe.你的域名.com
WEWE_AUTH_CODE=<WeWe 后台的 API 鉴权码>
```

云端 Worker 每次「一键更新」会经隧道拉本机微信；拉不到则合并逻辑保留旧微信条目，不会清空。

## 3. 本机 ingest 也会读 WeWe

`scripts/ingest.ts` 默认 `WEWE_RSS_URL=http://127.0.0.1:4000`，本机定时任务跑时直接抓本地 WeWe，无需隧道。
