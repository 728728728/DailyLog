# DailyLog - タスクバー用のショートカットを作る
#   .\create-shortcuts.ps1            … このフォルダに作る
#   .\create-shortcuts.ps1 -Desktop   … デスクトップにも置く
param([switch]$Desktop)

$dir  = $PSScriptRoot
$ps   = (Get-Command powershell.exe).Source
$icon = Join-Path $dir "favicon.ico"
$sh   = New-Object -ComObject WScript.Shell

function New-DailyLogShortcut([string]$path, [string]$extraArgs, [string]$desc) {
  $sc = $sh.CreateShortcut($path)
  $sc.TargetPath       = $ps
  $sc.Arguments        = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\quick.ps1`"$extraArgs"
  $sc.WorkingDirectory = $dir
  $sc.IconLocation     = "$icon,0"
  $sc.Description      = $desc
  $sc.WindowStyle      = 7   # 黒い窓を出さない
  $sc.Save()
  Write-Host "作成: $path"
}

$targets = @($dir)
if ($Desktop) { $targets += [Environment]::GetFolderPath("Desktop") }

foreach ($t in $targets) {
  New-DailyLogShortcut (Join-Path $t "DailyLog さっとメモ.lnk") "" "DailyLog - 気になったことをさっとメモ"
  New-DailyLogShortcut (Join-Path $t "DailyLog 日報.lnk") " -Full" "DailyLog - 日報を開く"
}

Write-Host ""
Write-Host "できたショートカットを右クリック →「タスクバーにピン留めする」で登録できます。"
Write-Host "（Windows 11 では「その他のオプションを表示」の中にある場合があります）"
