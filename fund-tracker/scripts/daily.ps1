# scripts/daily.ps1 - 09:00 ingest, push GitHub over SSH:443 (no HTTP proxy)
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

$publishPath = Join-Path $proj "config\publish.json"
$githubSsh = "git@github.com:pany65830-max/fund-tracke.git"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.githubUrl -match "github.com[:/]+([^/]+)/([^/.]+)") {
    $githubSsh = "git@github.com:$($Matches[1])/$($Matches[2]).git"
  }
}

$key = Join-Path $env:USERPROFILE ".ssh\fund_tracker_ed25519"
if (-not (Test-Path $key)) {
  Write-Error "missing SSH key $key . Add the public key to GitHub and re-run setup-local.ps1"
  exit 1
}

function Get-SshGithubIp {
  try {
    $json = & curl.exe --noproxy "*" --max-time 8 -s "https://dns.alidns.com/resolve?name=ssh.github.com&type=A"
    if ($json -match '"data":"(\d+\.\d+\.\d+\.\d+)"') { return $Matches[1] }
  } catch {}
  return "20.205.243.160"
}

$ip = Get-SshGithubIp
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
    Write-Error "push GitHub SSH failed. Check GitHub SSH key fund-tracker-daily"
    exit 1
  }
  Write-Host "done: pushed GitHub. Pages will rebuild. Gitee Pull mirror can follow."
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
