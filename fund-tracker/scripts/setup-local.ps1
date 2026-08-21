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

$publishPath = Join-Path $proj "config\publish.json"
$giteeUrl = "https://gitee.com/py6666654/fund-tracke.git"
if (Test-Path $publishPath) {
  $pub = Get-Content -Raw -Encoding UTF8 $publishPath | ConvertFrom-Json
  if ($pub.giteeUrl) { $giteeUrl = [string]$pub.giteeUrl }
}

$remotes = @(& $git.Path remote)
if ($remotes -contains "gitee") {
  & $git.Path remote set-url gitee $giteeUrl
  Write-Host "==> updated gitee remote: $giteeUrl"
} else {
  & $git.Path remote add gitee $giteeUrl
  Write-Host "==> added gitee remote: $giteeUrl"
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
Write-Host " 1) edit config/.env, set IFIND_REFRESH_TOKEN"
Write-Host " 2) WeWe: docker compose up -d then scan QR at http://127.0.0.1:4000"
Write-Host " 3) create public Gitee repo fund-tracke with NO README"
Write-Host " 4) Gitee private token: https://gitee.com/profile/personal_access_tokens"
Write-Host " 5) test: powershell -File scripts/daily.ps1"