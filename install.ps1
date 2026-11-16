# install.ps1 — 把本仓库的布局装进 Herdr 的应用目录（Windows 版 install.sh）
#
# 用法：
#   pwsh -File C:\Users\Zhannan\herdr-setup\install.ps1
#   $env:HERDR_APP_HOME = "D:\some\herdr-home"; pwsh -File ...   # 装到别处
#
# 做的事，和 README 的「by hand」一致：
#   1. 复制 layouts/workspace.json 与 layouts/workspace.svg 到 <home>/layouts/
#   2. 复制 mods/<八个 mod> 到 <home>/mods/（已存在则先移到 <home>/backups/）
#   3. 复制 themes/omarchy.json 到 <home>/themes/
#   4. 合并 keys.json：补 layout:workspace 整段，global / terminal 只补缺失的键，
#      原文件留一份 keys.json.bak.<时间>
# 不碰 <home> 里的其它东西。

param([switch]$SkipDeps)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $home_ "backups\herdr-setup-$stamp"

if (-not (Test-Path $home_)) { throw "找不到 Herdr 应用目录：$home_（用 HERDR_APP_HOME 指定）" }
Write-Output "源：      $src"
Write-Output "安装到：  $home_"
Write-Output "备份到：  $backupRoot"

$mods = @('agents-list', 'terminals-list', 'footer', 'icons', 'shortcuts', 'worktrees', 'sidebar-menu', 'pane-header', 'hoverfocus')

# 1. 布局与缩略图
$layoutsDir = Join-Path $home_ 'layouts'
New-Item -ItemType Directory -Force -Path $layoutsDir | Out-Null
foreach ($f in @('workspace.json', 'workspace.svg')) {
  $target = Join-Path $layoutsDir $f
  if (Test-Path $target) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item $target (Join-Path $backupRoot "layouts-$f") -Force
  }
  Copy-Item (Join-Path $src "layouts\$f") $target -Force
  Write-Output "布局：    layouts/$f"
}

# 2. 八个 mod
$modsDir = Join-Path $home_ 'mods'
New-Item -ItemType Directory -Force -Path $modsDir | Out-Null
foreach ($m in $mods) {
  $target = Join-Path $modsDir $m
  if (Test-Path $target) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item $target (Join-Path $backupRoot "mods-$m") -Recurse -Force
    Remove-Item $target -Recurse -Force
  }
  Copy-Item (Join-Path $src "mods\$m") $target -Recurse -Force
  Write-Output "mod：     mods/$m"
}

# 3. 主题
$themesDir = Join-Path $home_ 'themes'
New-Item -ItemType Directory -Force -Path $themesDir | Out-Null
$theme = Join-Path $themesDir 'omarchy.json'
if (Test-Path $theme) {
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  Copy-Item $theme (Join-Path $backupRoot 'themes-omarchy.json') -Force
}
Copy-Item (Join-Path $src 'themes\omarchy.json') $theme -Force
Write-Output "主题：    themes/omarchy.json"

# 5. 第三方 mod：布局顶栏的 Git 与 Review 按钮来自它们，缺哪个装哪个
$deps = @(
  @{ name = 'Git';        repo = 'https://github.com/kaishin/herdr-git-mod.git';    path = 'mods/Git' },
  @{ name = 'Codewalker'; repo = 'https://github.com/kaishin/herdr-codewalker.git'; path = 'mods/Codewalker' }
)
foreach ($dep in $deps) {
  if ($SkipDeps) { Write-Output "依赖：    mods/$($dep.name)（-SkipDeps，跳过）"; continue }
  $depTarget = Join-Path $modsDir $dep.name
  if (Test-Path $depTarget) { Write-Output "依赖：    mods/$($dep.name)（已存在，跳过）"; continue }
  $depTmp = Join-Path ([System.IO.Path]::GetTempPath()) "herdr-dep-$($dep.name)-$stamp"
  if (Test-Path $depTmp) { Remove-Item $depTmp -Recurse -Force }
  git clone --depth 1 $dep.repo $depTmp 2>&1 | Out-Null
  Copy-Item (Join-Path $depTmp $dep.path) $depTarget -Recurse -Force
  Remove-Item $depTmp -Recurse -Force
  Write-Output "依赖：    mods/$($dep.name)（来自 $($dep.repo)）"
}

# 4. 合并 keys.json
$keysPath = Join-Path $home_ 'keys.json'
$mine = Get-Content $keysPath -Raw | ConvertFrom-Json -AsHashtable
$bundle = Get-Content (Join-Path $src 'keys.json') -Raw | ConvertFrom-Json -AsHashtable

$added = 0
foreach ($section in @('global', 'terminal')) {
  if (-not $mine.Contains($section)) { $mine[$section] = [ordered]@{} }
  foreach ($k in $bundle[$section].Keys) {
    if (-not $mine[$section].Contains($k)) { $mine[$section][$k] = $bundle[$section][$k]; $added++ }
  }
}
# layout:workspace 整段按仓库的来（已有的同名段合并：仓库的覆盖同名键）
$sectionName = 'layout:workspace'
if (-not $mine.Contains($sectionName)) { $mine[$sectionName] = [ordered]@{} }
foreach ($k in $bundle[$sectionName].Keys) { $mine[$sectionName][$k] = $bundle[$sectionName][$k] }

Copy-Item $keysPath "$keysPath.bak.$stamp" -Force
$json = $mine | ConvertTo-Json -Depth 12
Set-Content -Path $keysPath -Value $json -Encoding utf8 -NoNewline
Write-Output "按键：    keys.json（新增 $added 个 global/terminal 键，写入 $sectionName 段，旧文件 keys.json.bak.$stamp）"

Write-Output ""
Write-Output "装完。下一步："
Write-Output "  herdr-app check `"$modsDir\agents-list`"     # 每个 mod 都可以 check 一次"
Write-Output "  herdr-app do layout.switch --name workspace"
