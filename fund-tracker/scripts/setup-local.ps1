# scripts/setup-local.ps1 - one-shot local ingest side (re-run on a new PC)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

Write-Host "==> check deps"
$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "git missing. Install Git for Windows and check Add to PATH."; exit 1 }
if (-not $npm) { Write-Error "Node.js missing. Install Node.js LTS and check Add to PATH."; exit 1 }
Write-Host "git = $($git.Path)"
Write-Host "npm = $($npm.Path)"

# 读取仓库地址（默认；publish.json 可覆盖）
$publishPath = Join-Path $proj "config\publish.json"
$githubUrl = "https://github.com/pany65830-max/fund-tracke.git"
$giteeUrl = "https://gitee.com/py6666654/fund-tracke.git"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.githubUrl) { $githubUrl = [string]$pub.githubUrl }
  if ($pub.giteeUrl) { $giteeUrl = [string]$pub.giteeUrl }
}

# 日常推送走 GitHub SSH:443（无代理）。确保 origin 指向 GitHub，并保留 gitee 作为可选镜像。
$remotes = @(& $git.Path remote)
if ($remotes -contains "origin") {
  & $git.Path remote set-url origin $githubUrl
  Write-Host "==> updated origin -> $githubUrl"
} else {
  & $git.Path remote add origin $githubUrl
  Write-Host "==> added origin -> $githubUrl"
}
if ($remotes -notcontains "gitee") {
  & $git.Path remote add gitee $giteeUrl
  Write-Host "==> added gitee remote (optional mirror): $giteeUrl"
}

# 生成/确认基金看板专属 SSH 钥匙（daily.ps1 走 SSH:443 直连 GitHub，无代理，不依赖翻墙）
$key = Join-Path $env:USERPROFILE ".ssh\fund_tracker_ed25519"
$sshDir = Split-Path $key
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
if (-not (Test-Path $key)) {
  Write-Host "==> generating SSH key: $key"
  & $git.Path show $key 2>$null | Out-Null
  ssh-keygen -t ed25519 -f "$key" -N "" -C "fund-tracker-daily" 2>&1 | Out-Null
  Write-Host "    SSH 公钥已生成，请把下面整段加入 GitHub deploy key："
  Write-Host "    -----------------------------------------------------------------"
  Write-Host (Get-Content "$key.pub" -Raw)
  Write-Host "    -----------------------------------------------------------------"
  Write-Host "    操作：打开 https://github.com/pany65830-max/fund-tracke/settings/keys"
  Write-Host "    点 [Add deploy key] → Title 填 fund-tracker-daily → 粘贴公钥 → 勾选 Allow write → Add key"
} else {
  Write-Host "==> SSH key exists: $key"
}

Write-Host "==> npm install"
& $npm.Path install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }

Write-Host "==> prepare .env"
$envPath = Join-Path $proj "config" ".env"
$exPath  = Join-Path $proj "config" ".env.example"
if (-not (Test-Path $envPath)) {
  Copy-Item $exPath $envPath
  Write-Host "created config/.env - fill IFIND_REFRESH_TOKEN"
} else {
  Write-Host "config/.env exists, skip"
}

$taskName = "FundTrackerDailyIngest"
$pwsh = (Get-Process -Id $pid).Path
$dailyPs1 = Join-Path $root "daily.ps1"
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$dailyPs1`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "09:00"),
  (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "registered task $taskName at 09:00 (runs on battery too)"
} catch {
  Write-Host "could not fully re-create the task (need admin). Time/battery may still be updated separately."
  try {
    $t = Get-ScheduledTask -TaskName $taskName
    $t.Settings.DisallowStartIfOnBatteries = $false
    $t.Settings.StopIfGoingOnBatteries = $false
    $t.Settings.StartWhenAvailable = $true
    Set-ScheduledTask -TaskName $taskName -Settings $t.Settings | Out-Null
    schtasks /Change /TN $taskName /ST 09:00 | Out-Null
    Write-Host "updated existing task: 09:00, allow battery"
  } catch {
    Write-Host "please set the task to 09:00 and uncheck AC-only in Task Scheduler"
  }
}

Write-Host ""
Write-Host "Next:"
Write-Host " 1) 把上面的 SSH 公钥加入 GitHub deploy key（必做，否则每日推送失败）"
Write-Host " 2) edit config/.env, set IFIND_REFRESH_TOKEN (必填，iFinD 刷新令牌)"
Write-Host " 3) GITEE_TOKEN 可选：仅当你要开 Gitee 国内镜像时才填"
Write-Host " 4) WeWe: docker compose up -d then scan QR at http://127.0.0.1:4000"
Write-Host " 5) test: powershell -File scripts/daily.ps1"
