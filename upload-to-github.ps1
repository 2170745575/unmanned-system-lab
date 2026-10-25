<#
  用 GitHub REST API 直接把本目录发布为仓库（不需要安装 Git）。

  用法：
    $env:GH_TOKEN = 'github_pat_xxx'
    .\upload-to-github.ps1 -RepoName unmanned-system-lab

  它会：
    1. 用 /user 校验 token 并取到你的用户名
    2. 创建仓库（已存在则复用；422 视为已存在）
    3. 按 .gitignore 规则收集文件，逐个上传为 blob（base64，二进制安全）
    4. 建 tree → 建 commit（单次提交）→ 建/更新 refs/heads/main
    5. 开启 GitHub Pages（main 分支 / 根目录）
    6. 打印站点地址

  幂等：重复执行会用新的快照覆盖仓库内容（保留历史提交）。
#>
param(
  [string]$RepoName = 'unmanned-system-lab',
  [string]$Description = 'Procedural Three.js showcase of five unmanned airframes - no external models, textures or audio',
  [switch]$Private,
  [switch]$SkipPages
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$token = $env:GH_TOKEN
if (-not $token) {
  Write-Host "[x] 没有 token。请先设置环境变量：`$env:GH_TOKEN = 'github_pat_xxx'" -ForegroundColor Red
  exit 1
}

$api = 'https://api.github.com'
$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'dsh-publish'
}

function Api($method, $path, $body) {
  $params = @{ Method = $method; Uri = "$api$path"; Headers = $headers; TimeoutSec = 60 }
  if ($body) { $params.Body = ($body | ConvertTo-Json -Depth 8 -Compress); $params.ContentType = 'application/json; charset=utf-8' }
  return Invoke-RestMethod @params
}

# ---------- 1) 校验 token ----------
Write-Host "1/6 校验 token …" -ForegroundColor Cyan
$me = Api 'GET' '/user'
$owner = $me.login
Write-Host "    身份: $owner  (token scopes: $($me.PSObject.Properties.Name -contains 'scopes'))"

# ---------- 2) 建仓库 ----------
Write-Host "2/6 创建仓库 $owner/$RepoName …" -ForegroundColor Cyan
$repoBody = @{ name = $RepoName; description = $Description; private = [bool]$Private; auto_init = $false; has_issues = $true; has_wiki = $false }
try {
  $repo = Api 'POST' '/user/repos' $repoBody
  Write-Host "    已创建" -ForegroundColor Green
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 422) {
    $repo = Api 'GET' "/repos/$owner/$RepoName"
    Write-Host "    已存在，复用"
  } else { throw }
}

# ---------- 3) 收集文件（遵循 .gitignore 的主要规则）----------
Write-Host "3/6 收集文件 …" -ForegroundColor Cyan
$ignoreGlobs = @('*.json', '*.png', '*.txt', '*.csv')
$ignoreDirs  = @('_tmp', '*_tmp', '.git', '.vscode', '.idea')
$skipRoots   = @('_a4_tmp', 'drone-x')

$files = @()
Get-ChildItem -Path $root -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  $parts = $rel.Split('/')
  if ($parts[0] -in $skipRoots) { return }
  if ($parts | Where-Object { $_ -in $ignoreDirs }) { return }
  # 只对 _dji_selftest 目录套用"排除大产物"规则（其余目录的文件一律入库）
  if ($parts[0] -eq '_dji_selftest') {
    $ext = $_.Extension
    if ($ignoreGlobs -contains "*$ext") { return }
  }
  $files += [pscustomobject]@{ rel = $rel; full = $_.FullName; size = $_.Length }
}
$totalMB = [math]::Round((($files | Measure-Object size -Sum).Sum / 1MB), 2)
Write-Host "    $($files.Count) 个文件，合计 $totalMB MB"

# ---------- 4) 上传 blobs ----------
Write-Host "4/6 上传文件内容（blob）…" -ForegroundColor Cyan
$tree = @()
$i = 0
foreach ($f in $files) {
  $i++
  if ($i % 20 -eq 0 -or $i -eq $files.Count) { Write-Host "    $i/$($files.Count)" }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.full))
  $blob = Api 'POST' "/repos/$owner/$RepoName/git/blobs" @{ content = $b64; encoding = 'base64' }
  $tree += @{ path = $f.rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
}

# ---------- 5) tree → commit → ref ----------
Write-Host "5/6 生成提交 …" -ForegroundColor Cyan
$newTree = Api 'POST' "/repos/$owner/$RepoName/git/trees" @{ tree = $tree }
$parent = $null
try {
  $ref = Api 'GET' "/repos/$owner/$RepoName/git/ref/heads/main"
  $parent = @($ref.object.sha)
} catch { $parent = @() }
$commitBody = @{
  message = 'Unmanned System Lab: five-airframe procedural Three.js showcase'
  tree    = $newTree.sha
  parents = $parent
}
$commit = Api 'POST' "/repos/$owner/$RepoName/git/commits" $commitBody
if ($parent.Count -eq 0) {
  Api 'POST' "/repos/$owner/$RepoName/git/refs" @{ ref = 'refs/heads/main'; sha = $commit.sha } | Out-Null
  Write-Host "    已创建 main 分支" -ForegroundColor Green
} else {
  Api 'PATCH' "/repos/$owner/$RepoName/git/refs/heads/main" @{ sha = $commit.sha; force = $false } | Out-Null
  Write-Host "    已更新 main 分支" -ForegroundColor Green
}

# ---------- 6) 开启 Pages ----------
$site = "https://$owner.github.io/$RepoName/"
if (-not $SkipPages) {
  Write-Host "6/6 开启 GitHub Pages …" -ForegroundColor Cyan
  try {
    Api 'POST' "/repos/$owner/$RepoName/pages" @{ source = @{ branch = 'main'; path = '/' } } | Out-Null
    Write-Host "    已开启" -ForegroundColor Green
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) { Write-Host "    已经是开启状态" }
    else { Write-Host "    开启失败（HTTP $code）——请到仓库 Settings → Pages 手动选 main / (root)" -ForegroundColor Yellow }
  }
} else { Write-Host "6/6 已跳过 Pages" }

Write-Host "`n[✓] 完成" -ForegroundColor Green
Write-Host "仓库: https://github.com/$owner/$RepoName"
Write-Host "站点: $site   （首次发布约 1 分钟后可访问）" -ForegroundColor Cyan
Write-Host "`n提醒：上传完成后请立刻到 GitHub 吊销这个 token。" -ForegroundColor Yellow