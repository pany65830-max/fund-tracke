# scripts/daily.ps1 - local daily ingest, push Gitee without proxy
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

# Clear env proxies. Global git http.proxy is overridden by -c below.
$env:HTTPS_PROXY = ""; $env:HTTP_PROXY = ""; $env:https_proxy = ""; $env:http_proxy = ""; $env:ALL_PROXY = ""; $env:all_proxy = ""
$env:no_proxy = "*"
$env:GIT_TERMINAL_PROMPT = "0"

$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "git not found. Install Git for Windows and add to PATH."; exit 1 }
if (-not $npm) { Write-Error "npm not found. Install Node.js LTS and add to PATH."; exit 1 }

function Invoke-GitDirect {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs)
  & $git.Path -c "http.proxy=" -c "https.proxy=" @GitArgs
  return $LASTEXITCODE
}

$publishPath = Join-Path $proj "config\publish.json"
$giteeUrl = "https://gitee.com/py6666654/fund-tracke.git"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.giteeUrl) { $giteeUrl = [string]$pub.giteeUrl }
}

$remotes = @(& $git.Path remote)
if ($remotes -notcontains "gitee") {
  Write-Host "==> add gitee remote: $giteeUrl"
  & $git.Path remote add gitee $giteeUrl
  if ($LASTEXITCODE -ne 0) { Write-Error "remote add gitee failed"; exit 1 }
  $remotes = @(& $git.Path remote)
}

$pushRemote = "gitee"
if ($remotes -notcontains "gitee") { $pushRemote = "origin" }

Write-Host "==> fetch $pushRemote (direct, ignore git proxy)"
$ec = Invoke-GitDirect -GitArgs @("fetch", $pushRemote)
if ($ec -ne 0) {
  Write-Error "fetch $pushRemote failed. Create the Gitee repo and login first: $giteeUrl"
  exit 1
}

$heads = & $git.Path -c "http.proxy=" -c "https.proxy=" ls-remote --heads $pushRemote main
if ($heads) {
  Write-Host "==> pull --ff-only $pushRemote main"
  $ec = Invoke-GitDirect -GitArgs @("pull", "--ff-only", $pushRemote, "main")
  if ($ec -ne 0) { Write-Error "pull $pushRemote failed"; exit 1 }
} else {
  Write-Host "remote $pushRemote has no main yet, skip pull"
}

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

Write-Host "==> push $pushRemote"
$ec = Invoke-GitDirect -GitArgs @("push", "-u", $pushRemote, "HEAD:main")
if ($ec -ne 0) { Write-Error "push $pushRemote failed"; exit 1 }

if ($pushRemote -eq "gitee" -and $remotes -contains "origin") {
  Write-Host "==> try GitHub push (ignore failure)"
  $null = Invoke-GitDirect -GitArgs @("push", "origin", "HEAD:main")
}

Write-Host "done: pushed $pushRemote; GitHub Pages will sync from Gitee"
