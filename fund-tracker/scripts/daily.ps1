# scripts/daily.ps1 - ingest at 09:00, push Gitee without Clash/GitHub proxy
param([switch]$SkipIngest)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

$env:GIT_TERMINAL_PROMPT = "0"
$env:HTTPS_PROXY = ""; $env:HTTP_PROXY = ""; $env:https_proxy = ""; $env:http_proxy = ""; $env:ALL_PROXY = ""; $env:all_proxy = ""

$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "git not found. Install Git for Windows and add to PATH."; exit 1 }
if (-not $npm) { Write-Error "npm not found. Install Node.js LTS and add to PATH."; exit 1 }
if (-not $node) { Write-Error "node not found. Install Node.js LTS and add to PATH."; exit 1 }

function Read-DotEnvValue([string]$Key) {
  foreach ($p in @((Join-Path $proj "config\.env"), (Join-Path $proj ".env"))) {
    if (-not (Test-Path $p)) { continue }
    foreach ($line in Get-Content -Path $p -Encoding UTF8) {
      if ($line -match ("^\s*" + [regex]::Escape($Key) + "\s*=\s*(.*)$")) {
        $val = $Matches[1].Trim().Trim("'").Trim('"')
        if ($val) { return $val }
      }
    }
  }
  return $null
}

$publishPath = Join-Path $proj "config\publish.json"
$giteeUrl = "https://gitee.com/py6666654/fund-tracke.git"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.giteeUrl) { $giteeUrl = [string]$pub.giteeUrl }
}

$giteeToken = Read-DotEnvValue "GITEE_TOKEN"
$proxyPort = 18076
$proxyJs = Join-Path $root "gitee-https-proxy.mjs"
$proxyProc = Start-Process -FilePath $node.Path -ArgumentList $proxyJs -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1
if ($proxyProc.HasExited) {
  Write-Error "gitee-https-proxy failed to start"
  exit 1
}

$giteeCfg = @(
  "http.proxy=http://127.0.0.1:$proxyPort",
  "https.proxy=http://127.0.0.1:$proxyPort",
  "http.version=HTTP/1.1"
)
if ($giteeToken) {
  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(("oauth2:" + $giteeToken)))
  $giteeCfg += ("http.extraHeader=Authorization: Basic " + $basic)
}

function Invoke-GitCfg {
  param(
    [Parameter(Mandatory = $true)][string[]]$ExtraConfig,
    [Parameter(Mandatory = $true)][string[]]$GitArgs
  )
  $cfg = @()
  foreach ($c in $ExtraConfig) { $cfg += @("-c", $c) }
  & $git.Path @cfg @GitArgs
  return $LASTEXITCODE
}

function Invoke-GitGitee {
  param([Parameter(Mandatory = $true)][string[]]$GitArgs)
  return Invoke-GitCfg -ExtraConfig $giteeCfg -GitArgs $GitArgs
}

try {
  $remotes = @(& $git.Path remote)
  if ($remotes -notcontains "gitee") {
    Write-Host "==> add gitee remote: $giteeUrl"
    & $git.Path remote add gitee $giteeUrl
    if ($LASTEXITCODE -ne 0) { Write-Error "remote add gitee failed"; exit 1 }
  }

  Write-Host "==> fetch gitee (direct, no Clash)"
  $ec = Invoke-GitGitee -GitArgs @("fetch", "gitee")
  if ($ec -ne 0) { Write-Error "fetch gitee failed"; exit 1 }

  & $git.Path show-ref --verify --quiet "refs/remotes/gitee/main"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "==> pull --ff-only gitee main"
    $ec = Invoke-GitGitee -GitArgs @("pull", "--ff-only", "gitee", "main")
    if ($ec -ne 0) { Write-Error "pull gitee failed"; exit 1 }
  } else {
    Write-Host "gitee has no main yet, skip pull"
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

  Write-Host "==> push gitee"
  $ec = Invoke-GitGitee -GitArgs @("push", "-u", "gitee", "HEAD:main")
  if ($ec -ne 0) {
    Write-Error "push gitee failed. Put a Gitee private token in .env as GITEE_TOKEN="
    exit 1
  }

  Write-Host "done: pushed gitee. Pages will follow via Gitee Push mirror / GitHub Action."
}
finally {
  if ($proxyProc -and -not $proxyProc.HasExited) {
    Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue
  }
}
