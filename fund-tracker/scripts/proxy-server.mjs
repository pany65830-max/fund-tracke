// scripts/proxy-server.mjs
// 本地抓取代理：让海外 Cloudflare Worker 借本机（国内 IP）抓取四家官网/交易所。
// 配套：cloudflared 隧道暴露本服务为公网地址，Worker 配置 SCRAPE_PROXY_URL + SCRAPE_PROXY_TOKEN。
//
// 启动：PROXY_PORT=8787 PROXY_TOKEN=你的随机串 node scripts/proxy-server.mjs
import http from "node:http";
import { Buffer } from "node:buffer";

const PORT = Number(process.env.PROXY_PORT || 8787);
const TOKEN = process.env.PROXY_TOKEN || "";
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1";

function isBlockedHost(host) {
  if (ALLOW_PRIVATE) return false;
  const h = (host || "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0" || h === "127.0.0.1") return true;
  if (h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

function filterOutgoingHeaders(h) {
  const out = {};
  const drop = ["host", "content-length", "connection", "transfer-encoding", "origin", "referer"];
  for (const [k, v] of Object.entries(h || {})) {
    if (drop.includes(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== "/fetch") {
    res.writeHead(404);
    return res.end("not found");
  }

  if (TOKEN && (u.searchParams.get("t") || req.headers["x-proxy-token"]) !== TOKEN) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  const target = u.searchParams.get("url");
  if (!target) {
    res.writeHead(400);
    return res.end("missing url");
  }

  let tUrl;
  try {
    tUrl = new URL(target);
  } catch {
    res.writeHead(400);
    return res.end("bad url");
  }
  if (tUrl.protocol !== "http:" && tUrl.protocol !== "https:") {
    res.writeHead(400);
    return res.end("bad protocol");
  }
  if (isBlockedHost(tUrl.hostname)) {
    res.writeHead(403);
    return res.end("blocked host");
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(tUrl.toString(), {
      method: req.method,
      headers: filterOutgoingHeaders(req.headers),
      body: body && body.length ? body : undefined,
      redirect: "follow",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502);
    res.end("proxy error: " + (e && e.message ? e.message : String(e)));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[scrape-proxy] listening on http://127.0.0.1:${PORT}  token=${TOKEN ? "set" : "NONE(危险：请设 PROXY_TOKEN)"}`,
  );
});
