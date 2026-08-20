# 本地抓取代理（A1 方案）

让海外 Cloudflare Worker 借你电脑的国内 IP 抓取四家官网与交易所，使「一键更新」按钮也能抓全。

## 原理

```
云端 Worker --(公网)--> cloudflared 隧道 --> 本机 proxy-server.mjs --(国内IP)--> 四家/交易所
```

适配器（company-web / exchange-web / sse-fund-site）的 `fetch` 被替换为"经代理转发"的 fetch；代理在本机用国内 IP 实抓后回传。未配置 `SCRAPE_PROXY_URL` 时 Worker 直连（现状），合并逻辑保留已有数据。

## 本机端

```powershell
# 设置共享密钥后启动（务必设 PROXY_TOKEN，否则是开放代理！）
$env:PROXY_PORT = "8787"
$env:PROXY_TOKEN = "你的随机串"
node scripts/proxy-server.mjs
```

- 只暴露 `/fetch?url=...&t=TOKEN` 一个端点
- 校验 `t` 参数；拒绝 localhost / 内网 / 非常规协议（防 SSRF）
- 用 cloudflared 暴露为公网地址（隧道用法见 `worker/WEWE-SETUP.md`）

## Worker 端（一次性）

```powershell
cd worker
wrangler secret put SCRAPE_PROXY_URL    # 填 https://你的隧道地址
wrangler secret put SCRAPE_PROXY_TOKEN  # 填同一个随机串
wrangler deploy
```

配置后，云端抓四家/交易所会经代理走你电脑国内 IP；你电脑关机时自动回退为直连 + 合并保留（不破坏已有数据）。
