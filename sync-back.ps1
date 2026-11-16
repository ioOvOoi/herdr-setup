# sync-back.ps1 — 把 Herdr 应用目录里的改动收回本仓库（install.ps1 的反向）
#
# 为什么需要：Herdr 只热重载它自己目录里的 mod。所以改 UI 最快的循环是
#   改 <home>/mods/<name>/main.js → 存盘即生效 → 满意后跑本脚本收回仓库 → git commit
#
# 用法：
#   pwsh -File C:\Users\Zhannan\herdr-setup\sync-back.ps1            # 收回
#   pwsh -File C:\Users\Zhannan\herdr-setup\sync-back.ps1 -DryRun    # 只看会改哪些文件
#
# 只收布局、八个 mod（源码与资源，不收 jsconfig.json / *.d.ts）与主题；
# keys.json 只在 layout:workspace 段有差异时提醒你手动对齐，不自动覆盖整份。

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
if (-not (Test-Path $home_)) { throw "找不到 Herdr 应用目录：$home_" }

$mods = @('agents-list', 'terminals-list', 'footer', 'icons', 'shortcuts', 'worktrees', 'sidebar-menu', 'pane-header', 'hoverfocus')
$skip = @('jsconfig.json', 'gpui-kit.d.ts', 'herdr.d.ts')
$changed = @()

function Copy-Back($from, $to) {
  if (-not (Test-Path $from)) { return }
  # 只收真的变了的文件：内容相同就跳过，省得把没动的也列出来
  if (Test-Path $to) {
    $h1 = (Get-FileHash $from -Algorithm SHA256).Hash
    $h2 = (Get-FileHash $to -Algorithm SHA256).Hash
    if ($h1 -eq $h2) { return }
  }
  $script:changed += $(if (Test-Path $to) { "modified $to" } else { "new      $to" })
  if ($DryRun) { return }
  $dir = Split-Path $to -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item $from $to -Force
}

# 布局
foreach ($f in @('workspace.json', 'workspace.svg')) {
  $from = Join-Path $home_ "layouts\$f"
  if (Test-Path $from) { Copy-Back $from (Join-Path $src "layouts\$f") }
}

# mod 源码与资源
foreach ($m in $mods) {
  $installed = Join-Path $home_ "mods\$m"
  if (-not (Test-Path $installed)) { Write-Warning "应用目录里没有 mods/$m"; continue }
  Get-ChildItem $installed -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($installed.Length + 1)
    if ($skip -contains (Split-Path $rel -Leaf)) { return }
    if ($rel -like '*.error') { return }
    if ($_.FullName -like '*\.git\*') { return }
    Copy-Back $_.FullName (Join-Path $src "mods\$m\$rel")
  }
}

# 主题
$themeFrom = Join-Path $home_ 'themes\omarchy.json'
if (Test-Path $themeFrom) { Copy-Back $themeFrom (Join-Path $src 'themes\omarchy.json') }

Write-Output "收回 $($changed.Count) 个文件$(if ($DryRun) { '（dry run，没写入）' })"

# layout:workspace 段提醒：应用目录的段与仓库的不同就提示
$homeKeys = Join-Path $home_ 'keys.json'
$repoKeys = Join-Path $src 'keys.json'
if ((Test-Path $homeKeys) -and (Test-Path $repoKeys)) {
  $a = (Get-Content $homeKeys -Raw | ConvertFrom-Json -AsHashtable)['layout:workspace'] | ConvertTo-Json -Depth 5 -Compress
  $b = (Get-Content $repoKeys -Raw | ConvertFrom-Json -AsHashtable)['layout:workspace'] | ConvertTo-Json -Depth 5 -Compress
  if ($a -ne $b) { Write-Warning 'layout:workspace 段与应用目录不一致：改键请直接编辑本仓库 keys.json，再跑 install.ps1 合并（它会保留你其它段）。' }
}

Write-Output ''
Write-Output '下一步：'
Write-Output "  git -C $src status --short"
Write-Output "  herdr-app check $(Join-Path $home_ 'mods\agents-list')"
