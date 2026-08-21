/**
 * Local CONNECT proxy so git can reach gitee.com without Clash fake-IP DNS.
 * Forwards only gitee.com:443 to Baidu-hosted Gitee IPs.
 */
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.GITEE_HTTPS_PROXY_PORT || 18076);
const TARGETS = String(
  process.env.GITEE_IPS || "180.76.198.225,180.76.199.13,180.76.198.77",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW = new Set(["gitee.com", "www.gitee.com"]);

function tcpConnect(ip, port, ms) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: ip, port, family: 4 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout ${ip}`));
    }, ms);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function connectGitee() {
  let lastErr;
  for (const ip of TARGETS) {
    try {
      return await tcpConnect(ip, 443, 4000);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("no gitee IPs");
}

const server = http.createServer((_req, res) => {
  res.writeHead(405);
  res.end("CONNECT only");
});

server.on("connect", (req, clientSocket, head) => {
  const host = String(req.url || "")
    .split(":")[0]
    .toLowerCase();
  if (!ALLOW.has(host)) {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  connectGitee()
    .then((remote) => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) remote.write(head);
      clientSocket.pipe(remote);
      remote.pipe(clientSocket);
      const close = () => {
        clientSocket.destroy();
        remote.destroy();
      };
      clientSocket.on("error", close);
      remote.on("error", close);
      clientSocket.on("close", close);
      remote.on("close", close);
    })
    .catch(() => {
      try {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      } catch {
        clientSocket.destroy();
      }
    });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`gitee-https-proxy 127.0.0.1:${PORT}\n`);
});
