# scripts/setup-local.ps1 — 在本机一键立起"本地抓取侧"
# 用法：在 PowerShell 中 `.\scripts\setup-local.ps1`（建议管理员终端）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$proj = Split-Path -Parent $root
Set-Location $proj

Write-Host "==> 检查依赖"
$git = Get-Command git -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $git) { Write-Error "缺少 git。请安装 Git for Windows (https://git-scm.com) 并勾选 Add to PATH。"; exit 1 }
if (-not $npm) { Write-Error "缺少 Node.js。请安装 Node.js LTS (https://nodejs.org) 并勾选 Add to PATH。"; exit 1 }
Write-Host "git = $($git.Path)`nnpm = $($npm.Path)"

Write-Host "==> npm install"
& $npm.Path install
if ($LASTEXITCODE -ne 0) { Write-Error "npm install 失败"; exit 1 }

Write-Host "==> 准备 .env"
$envPath = Join-Path $proj "config" ".env"
$exPath  = Join-Path $proj "config" ".env.example"
if (-not (Test-Path $envPath)) {
  Copy-Item $exPath $envPath
  Write-Host "已生成 config/.env —— 请打开填写 IFIND_REFRESH_TOKEN 等密钥"
} else {
  Write-Host "config/.env 已存在，跳过"
}

# 注册计划任务：每日 08:30 + 登录时，均运行 scripts/daily.ps1
$taskName = "FundTrackerDailyIngest"
$pwsh = (Get-Process -Id $pid).Path
$dailyPs1 = Join-Path $root "daily.ps1"
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$dailyPs1`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "08:30"),
  (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Force
Write-Host "已注册计划任务 '$taskName'（每日 08:30 与登录时运行）"

Write-Host ""
Write-Host "下一步："
Write-Host " 1) 编辑 config/.env，填入 IFIND_REFRESH_TOKEN"
Write-Host " 2) (可选) 起 WeWe：docker compose up -d，并按 worker/WEWE-SETUP.md 配隧道"
Write-Host " 3) 可手动试跑：pwsh scripts/daily.ps1"
