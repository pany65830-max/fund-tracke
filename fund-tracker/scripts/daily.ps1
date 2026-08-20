# scripts/daily.ps1 — 本地每日抓取（可插拔：换电脑只需重跑 setup-local.ps1）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

# 清掉可能继承的死代理，保证直连
$env:HTTPS_PROXY = ""; $env:HTTP_PROXY = ""; $env:https_proxy = ""; $env:http_proxy = ""; $env:no_proxy = "*"

$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "未找到 git，请先安装 Git for Windows 并加入 PATH"; exit 1 }
if (-not $npm) { Write-Error "未找到 npm，请先安装 Node.js LTS 并加入 PATH"; exit 1 }

& $git.Path fetch origin
& $git.Path pull --ff-only origin main

# ingest 失败重试（最多 3 次，间隔 30s）
$max = 3; $n = 0
:ingest do {
  $n++
  try {
    & $npm.Path run ingest
    if ($LASTEXITCODE -eq 0) { break ingest }
  } catch {}
  if ($n -lt $max) { Write-Host "ingest 失败，第 $n/$max 次重试，30s 后..."; Start-Sleep -Seconds 30 }
} while ($n -lt $max)

if ($n -ge $max) { Write-Host "ingest 连续失败 $max 次，放弃本次"; exit 0 }

& $git.Path add data
& $git.Path diff --cached --quiet data
if ($LASTEXITCODE -eq 0) { Write-Host "无数据变化，跳过提交"; exit 0 }
& $git.Path commit -m "daily auto ingest"
& $git.Path push origin HEAD
Write-Host "完成"
