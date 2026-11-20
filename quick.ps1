# DailyLog - さっとメモ用の起動
# アプリ風の小さい窓で、メモ欄を開いた状態で立ち上げます。
param([switch]$Full)   # -Full を付けると、メモ欄を開かず日報の画面で立ち上げる
$ErrorActionPreference = "SilentlyContinue"

$page = Join-Path $PSScriptRoot "index.html"
# 日本語を含むパスは、そのままだと --app= で開けないので符号化する
$base = [uri]::EscapeUriString(("file:///" + ($page -replace "\\", "/")))
if ($Full) {
  $url  = $base
  $size = "--window-size=1280,900"
} else {
  # 既に開いている窓にも届くよう、毎回ちがうハッシュにする
  $url  = $base + "#quick" + (Get-Random -Maximum 99999)
  $size = "--window-size=640,620"
}

$candidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", $size
} else {
  # 見つからなければ、既定のブラウザで開く
  Start-Process $url
}
