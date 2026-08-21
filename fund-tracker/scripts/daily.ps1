# scripts/daily.ps1 - 09:00 本地拉数, 经 SSH:443 直连推 GitHub (无 HTTP 代理)
#
# 架构（满足三大要求：①无代理自动更新 ②免费 ③转移同事无差异）：
#   本机每天 09:00 拉数后 → 经 SSH 通道直连 GitHub(走 ssh.github.com 的 443 端口真 IP)
#   → 触发 GitHub Pages(deploy.yml) 免费部署。
#   关键：SSH 协议 Clash 的 TUN 全局 MITM 不拦截，因此「无代理」也推得动（已实测）。
#   若你另开了 Gitee Pull 镜像，会自行跟随，不必在本脚本处理。
param([switch]$SkipIngest)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

$env:GIT_TERMINAL_PROMPT = "0"
$savedNoProxy = $env:no_proxy
$savedNO_PROXY = $env:NO_PROXY
$savedHttp = $env:HTTP_PROXY
$savedHttps = $env:HTTPS_PROXY
$savedhttp = $env:http_proxy
$savedhttps = $env:https_proxy
$savedAll = $env:ALL_PROXY
$savedall = $env:all_proxy

$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "git not found. Install Git for Windows and add to PATH."; exit 1 }
if (-not $npm) { Write-Error "npm not found. Install Node.js LTS and add to PATH."; exit 1 }

# GitHub 推送目标（默认仓库；publish.json 的 githubUrl 可覆盖）
$githubSsh = "git@github.com:pany65830-max/fund-tracke.git"
$publishPath = Join-Path $proj "config\publish.json"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.githubUrl -match "github\.com[:/]+([^/]+)/([^/.]+)") {
    $githubSsh = "git@github.com:$($Matches[1])/$($Matches[2]).git"
  }
}

# SSH 钥匙：默认 ~/.ssh/fund_tracker_ed25519；可用 FUNDTRACKER_SSH_KEY 环境变量覆盖
$key = $env:FUNDTRACKER_SSH_KEY
if (-not $key) { $key = Join-Path $env:USERPROFILE ".ssh\fund_tracker_ed25519" }
if (-not (Test-Path $key)) {
  Write-Error @"
missing SSH key: $key
此脚本走 SSH:443 直连 GitHub（无代理），必须有一把 SSH 钥匙。
同事新电脑一键配置：
  1) 生成钥匙：  ssh-keygen -t ed25519 -f "$key" -N "" -C "fund-tracker-daily"
  2) 把公钥加到 GitHub：打开 https://github.com/pany65830-max/fund-tracke/settings/keys
     点 [Add deploy key]，Title 填 fund-tracker-daily，把下面内容粘进去，勾选 Allow write：
     $(& $git.Path show "$key.pub" 2>$null)
  3) 重跑 scripts/setup-local.ps1 即可。
（详见 MIGRATE.md「转交同事」）
"@
  exit 1
}

# 解析 ssh.github.com 的当前真 IP（多 DNS 源容错），失败回退到已知稳定 IP
function Get-SshGithubIp {
  foreach ($d in @("https://dns.alidns.com/resolve?name=ssh.github.com&type=A",
                   "https://223.5.5.5/resolve?name=ssh.github.com&type=A",
                   "https://1.1.1.1/resolve?name=ssh.github.com&type=A")) {
    try {
      $json = & curl.exe --noproxy "*" --max-time 8 -s $d
      if ($json -match '"data":"(\d+\.\d+\.\d+\.\d+)"') { return $Matches[1] }
    } catch {}
  }
  return "20.205.243.160"
}
$ip = Get-SshGithubIp

# 强制 SSH 走 443 端口直连真 IP，并用本机专属钥匙；清掉所有代理变量（SSH 通道本身绕开 Clash）
$env:GIT_SSH_COMMAND = "ssh -i `"$key`" -o IdentitiesOnly=yes -p 443 -o HostName=$ip -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
$env:no_proxy = "*"
$env:NO_PROXY = "*"
$env:HTTP_PROXY = ""; $env:HTTPS_PROXY = ""; $env:http_proxy = ""; $env:https_proxy = ""
$env:ALL_PROXY = ""; $env:all_proxy = ""

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs)
  & $git.Path @GitArgs
  return $LASTEXITCODE
}

try {
  Write-Host "==> fetch GitHub via SSH $ip :443"
  $ec = Invoke-Git -GitArgs @("fetch", $githubSsh, "+refs/heads/main:refs/remotes/origin/main")
  if ($ec -eq 0) {
    & $git.Path merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { Write-Host "ff-only merge skipped (local ahead or diverged)" }
  } else {
    Write-Host "fetch GitHub failed, continue with local commits"
  }

  if (-not $SkipIngest) {
    $max = 3; $n = 0
    :ingest do {
      $n++
      try {
        & $npm.Path run ingest
        if ($LASTEXITCODE -eq 0) { break ingest }
      } catch {}
      if ($n -lt $max) { Write-Host "ingest failed, retry $n/$max in 30s"; Start-Sleep -Seconds 30 }
    } while ($n -lt $max)

    if ($n -ge $max) { Write-Host "ingest failed $max times, abort"; exit 0 }

    & $git.Path add data
    & $git.Path diff --cached --quiet data
    if ($LASTEXITCODE -eq 0) { Write-Host "no data change, skip commit"; exit 0 }
    & $git.Path commit -m "daily auto ingest"
    if ($LASTEXITCODE -ne 0) { Write-Error "commit failed"; exit 1 }
  }

  Write-Host "==> push GitHub via SSH (no HTTP proxy)"
  $ec = Invoke-Git -GitArgs @("push", $githubSsh, "HEAD:main")
  if ($ec -ne 0) {
    Write-Error "push GitHub SSH failed. Check GitHub SSH key + deploy key 权限 + 网络."
    exit 1
  }
  Write-Host "done: pushed GitHub. Pages will rebuild. (Gitee Pull mirror follows if enabled.)"
}
finally {
  Remove-Item Env:GIT_SSH_COMMAND -ErrorAction SilentlyContinue
  $env:no_proxy = $savedNoProxy
  $env:NO_PROXY = $savedNO_PROXY
  $env:HTTP_PROXY = $savedHttp
  $env:HTTPS_PROXY = $savedHttps
  $env:http_proxy = $savedhttp
  $env:https_proxy = $savedhttps
  $env:ALL_PROXY = $savedAll
  $env:all_proxy = $savedall
}
