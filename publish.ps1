<#
  路线 B：用 Git 标准流程把本作品集推到 GitHub，并打印开启 GitHub Pages 的步骤。

  前置
    1) 有一个可用的 git（本机已备好便携版 MinGit，脚本会自动找到它）
    2) 在 GitHub 上新建一个**空**仓库（不要勾 Add README / .gitignore / license）

  用法
    powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -GitHubUser 你的用户名 -RepoName 仓库名

  关于重试
    本机到 github.com 的链路会间歇性超时（实测 21 秒连接超时，但也多次 1~2 秒成功），
    因此推送阶段默认最多重试 10 次，每次失败后换一种连接方式再试（见下方策略）。
    可用 -MaxPushAttempts 调整，或 -NoRetry 只试一次。
#>
param(
  [Parameter(Mandatory = $true)][string]$GitHubUser,
  [string]$RepoName = 'unmanned-system-lab',
  [string]$CommitMessage = 'Unmanned System Lab - 5 airframes 3D showcase (procedural Three.js)',
  [int]$MaxPushAttempts = 10,
  [switch]$NoRetry,
  [switch]$Private
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "仓库目录: $root" -ForegroundColor Cyan

# ---- 1) 找 git：先 PATH，再常见安装位置，最后本机便携版 ----
function Find-Git {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\MinGit\cmd\git.exe"
  )
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  return $null
}
$git = Find-Git
if (-not $git) {
  Write-Host "`n[x] 没找到 git。" -ForegroundColor Red
  Write-Host "    可执行：winget install --id Git.Git -e  （装完重开 PowerShell）"
  exit 1
}
Write-Host "git: $git"

# ---- 2) 提交身份 ----
if (-not (& $git config user.name))  { & $git config user.name  $GitHubUser }
if (-not (& $git config user.email)) { & $git config user.email "$GitHubUser@users.noreply.github.com" }
& $git config core.autocrlf false | Out-Null
& $git config http.version HTTP/1.1 | Out-Null
& $git config http.lowSpeedLimit 1000 | Out-Null
& $git config http.lowSpeedTime 60 | Out-Null
if (-not (& $git config credential.helper)) { & $git config credential.helper manager }

# ---- 3) 初始化 / 提交 ----
if (-not (Test-Path (Join-Path $root '.git'))) { & $git init -b main | Out-Null; Write-Host "已初始化本地仓库" }
& $git add -A 2>$null
$staged = (& $git diff --cached --name-only | Measure-Object).Count
if ($staged -gt 0) {
  & $git commit -m $CommitMessage 2>&1 | Out-Null
  Write-Host "已提交 $staged 个文件" -ForegroundColor Green
} else {
  Write-Host "没有新的改动需要提交"
}
& $git branch -M main 2>$null

# ---- 4) 远端 ----
$url = "https://github.com/$GitHubUser/$RepoName.git"
$remotes = & $git remote
if ($remotes -contains 'origin') { & $git remote set-url origin $url } else { & $git remote add origin $url }
Write-Host "远端: $url"
Write-Host "本地提交: $(& $git rev-parse --short HEAD)  文件数: $((& $git ls-files | Measure-Object).Count)"

# ---- 5) 推送（带自动重试；每次换一种连接策略）----
# 策略说明：本机链路会间歇性拒绝连接，实测这几种方式都有可能成功，轮换着试命中率更高
$strategies = @(
  @{ name = '默认';                 args = @() },
  @{ name = 'HTTP/1.1 + 大缓冲';    args = @('-c','http.version=HTTP/1.1','-c','http.postBuffer=524288000') },
  @{ name = '钉 IPv4 20.205.243.166'; args = @('-c','http.curloptResolve=github.com:443:20.205.243.166') },
  @{ name = '钉 IPv4 20.205.243.168'; args = @('-c','http.curloptResolve=github.com:443:20.205.243.168') },
  @{ name = '钉 IP + 不校验证书链缓存'; args = @('-c','http.curloptResolve=github.com:443:20.205.243.166','-c','http.sslVerify=true') }
)
$maxAttempts = if ($NoRetry) { 1 } else { $MaxPushAttempts }

Write-Host "`n开始推送（最多 $maxAttempts 次，失败会自动换方式重试）…" -ForegroundColor Yellow
Write-Host "首次会弹出浏览器让你登录 GitHub（Git Credential Manager）。" -ForegroundColor Yellow
Write-Host "如果长时间没有登录窗口，说明连 github.com 又超时了，脚本会自己重试，请等它。" -ForegroundColor DarkGray

$pushed = $false
for ($i = 1; $i -le $maxAttempts; $i++) {
  $st = $strategies[($i - 1) % $strategies.Count]
  Write-Host "`n--- 第 $i/$maxAttempts 次（$($st.name)）---" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $out = & $git @($st.args) push -u origin main 2>&1
  $code = $LASTEXITCODE
  $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $out | Where-Object { $_ -notmatch '^\s*$' } | Select-Object -First 6 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

  if ($code -eq 0) {
    Write-Host "`n[OK] 推送成功（用时 ${secs}s）" -ForegroundColor Green
    $pushed = $true
    break
  }

  $isConn = ($out -join ' ') -match 'Failed to connect|unable to access|Could not connect|Connection (timed out|reset)|Empty reply'
  if ($isConn) {
    Write-Host "    → 连接超时（${secs}s），换下一种方式重试" -ForegroundColor Yellow
  } else {
    Write-Host "    → 非连接类错误（${secs}s）" -ForegroundColor Yellow
    if (($out -join ' ') -match 'rejected|non-fast-forward|fetch first') {
      Write-Host "      远端有脚本不知道的提交，先合并再推…" -ForegroundColor Yellow
      & $git pull --rebase --allow-unrelated-histories origin main 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }
    if (($out -join ' ') -match 'Authentication failed|could not read Username|403|401') {
      Write-Host "      [!] 认证问题：请在弹出的登录窗口完成 GitHub 登录，然后重跑本脚本。" -ForegroundColor Red
    }
  }
  Start-Sleep -Seconds 2
}

if (-not $pushed) {
  Write-Host "`n[x] $maxAttempts 次都没推上去。" -ForegroundColor Red
  Write-Host "    你到 github.com 的链路被限速（实测 21 秒超时），但 api.github.com 很稳（141ms）。"
  Write-Host "    建议改用 API 上传：建一个 token 后运行 upload.cmd（或让助手直接做）。"
  Write-Host "    也可以过一会儿网络好点时重跑本脚本。"
  exit 1
}

# ---- 6) 远端核验 + Pages 指引 ----
Write-Host "`n远端核验：" -ForegroundColor Cyan
& $git ls-remote --heads origin 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host "`n最后一步：开启 GitHub Pages" -ForegroundColor Cyan
Write-Host "  打开 https://github.com/$GitHubUser/$RepoName/settings/pages"
Write-Host "  Source 选 'Deploy from a branch' → Branch 选 main / (root) → Save"
Write-Host "`n约 1 分钟后站点地址："
Write-Host "  https://$GitHubUser.github.io/$RepoName/" -ForegroundColor Green
Write-Host "（根路径会自动跳到作品展台 dji-hub/）"