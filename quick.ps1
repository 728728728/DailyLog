# DailyLog - さっとメモ用の起動
# アプリ風の小さい窓で、メモ欄を開いた状態で立ち上げます。
$ErrorActionPreference = "SilentlyContinue"

$page = Join-Path $PSScriptRoot "index.html"
# 日本語を含むパスは、そのままだと --app= で開けないので符号化する
$url  = [uri]::EscapeUriString(("file:///" + ($page -replace "\\", "/"))) + "#quick" + (Get-Random -Maximum 99999)

$candidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", "--window-size=640,620"
} else {
  # 見つからなければ、既定のブラウザで開く
  Start-Process $url
}
