# DailyLog - タスクバー用のショートカットを作る
#   .\create-shortcuts.ps1            … このフォルダに作る
#   .\create-shortcuts.ps1 -Desktop   … デスクトップにも置く
#
# ブラウザのアプリ窓を直接開くショートカットを作り、DailyLog専用のアイコンと
# アプリIDを付けます。アプリIDを付けないと、タスクバーに留めたときに
# ブラウザ（Edge）のアイコンに吸収されてしまいます。
param([switch]$Desktop)

$dir  = $PSScriptRoot
$icon = Join-Path $dir "favicon.ico"
$page = Join-Path $dir "index.html"
$base = [uri]::EscapeUriString(("file:///" + ($page -replace "\\", "/")))

$candidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# --- ショートカットにアプリIDを書き込むための補助 ---
$code = @'
using System;
using System.Runtime.InteropServices;

public static class LnkAumid {
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT {
        public ushort vt; public ushort r1; public ushort r2; public ushort r3;
        public IntPtr p; public IntPtr p2;
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        int Commit();
    }

    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPersistFile {
        int GetClassID(out Guid pClassID);
        [PreserveSig] int IsDirty();
        int Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
        int Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, [MarshalAs(UnmanagedType.Bool)] bool fRemember);
        int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
        int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
    }

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PROPVARIANT pv);

    static PROPERTYKEY AppIdKey() {
        PROPERTYKEY k = new PROPERTYKEY();
        k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        k.pid = 5;
        return k;
    }

    static object NewShellLink() {
        Type t = Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046"));
        return Activator.CreateInstance(t);
    }

    public static void Set(string lnk, string appId) {
        object link = NewShellLink();
        ((IPersistFile)link).Load(lnk, 2);
        IPropertyStore store = (IPropertyStore)link;
        PROPERTYKEY key = AppIdKey();
        PROPVARIANT pv = new PROPVARIANT();
        pv.vt = 31; // VT_LPWSTR
        pv.p = Marshal.StringToCoTaskMemUni(appId);
        try {
            int hr = store.SetValue(ref key, ref pv);
            if (hr != 0) throw new Exception("SetValue hr=" + hr);
            hr = store.Commit();
            if (hr != 0) throw new Exception("Commit hr=" + hr);
            ((IPersistFile)link).Save(lnk, true);
        } finally {
            PropVariantClear(ref pv);
            Marshal.FinalReleaseComObject(link);
        }
    }

    public static string Get(string lnk) {
        object link = NewShellLink();
        ((IPersistFile)link).Load(lnk, 0);
        IPropertyStore store = (IPropertyStore)link;
        PROPERTYKEY key = AppIdKey();
        PROPVARIANT pv;
        store.GetValue(ref key, out pv);
        string s = (pv.vt == 31) ? Marshal.PtrToStringUni(pv.p) : "";
        PropVariantClear(ref pv);
        Marshal.FinalReleaseComObject(link);
        return s;
    }
}
'@
try { Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop } catch { }

$sh = New-Object -ComObject WScript.Shell

function New-DailyLogShortcut {
  param([string]$Path, [string]$Hash, [string]$Size, [string]$Desc, [string]$AppId, [switch]$FullApp)

  Remove-Item $Path -Force -ErrorAction SilentlyContinue
  $sc = $sh.CreateShortcut($Path)
  if ($browser) {
    $sc.TargetPath = $browser
    $sc.Arguments  = "--app=`"$base$Hash`" --window-size=$Size"
  } else {
    # ブラウザが見つからない場合は quick.ps1 経由で開く
    $extra = ""
    if ($FullApp) { $extra = " -Full" }
    $sc.TargetPath = (Get-Command powershell.exe).Source
    $sc.Arguments  = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\quick.ps1`"$extra"
  }
  $sc.WorkingDirectory = $dir
  $sc.IconLocation     = "$icon,0"
  $sc.Description      = $Desc
  $sc.WindowStyle      = 7
  $sc.Save()

  # タスクバーで独立したアプリとして扱わせる
  try { [LnkAumid]::Set($Path, $AppId) } catch { Write-Host "  （アプリIDの設定はできませんでした: $($_.Exception.Message)）" }
  Write-Host "作成: $Path"
}

$targets = @($dir)
if ($Desktop) { $targets += [Environment]::GetFolderPath("Desktop") }

foreach ($t in $targets) {
  New-DailyLogShortcut -Path (Join-Path $t "DailyLog さっとメモ.lnk") -Hash "#quick" -Size "640,620" `
    -Desc "DailyLog - 気になったことをさっとメモ" -AppId "DailyLog.QuickNote"
  New-DailyLogShortcut -Path (Join-Path $t "DailyLog 日報.lnk") -Hash "" -Size "1280,900" `
    -Desc "DailyLog - 日報を開く" -AppId "DailyLog.Report" -FullApp
}

Write-Host ""
if (-not $browser) { Write-Host "※ EdgeもChromeも見つからないため、既定のブラウザで開く形にしました。" }
Write-Host "できたショートカットを右クリック →「タスクバーにピン留めする」で登録してください。"
Write-Host "（Windows 11 では「その他のオプションを表示」の中にある場合があります）"
Write-Host "※ 開いた窓を右クリックして留めると、Edgeのアイコンになります。必ずショートカット側を留めてください。"
