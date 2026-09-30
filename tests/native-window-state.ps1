param([string]$HandleValue, [switch]$Move)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class WindowState {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int left,top,right,bottom;}
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h,out uint affinity);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
$previous = [WindowState]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $handle = [IntPtr]([long]$HandleValue)
  $rect = New-Object WindowState+RECT
  if(-not [WindowState]::GetWindowRect($handle,[ref]$rect)) { throw 'GetWindowRect failed' }
  if($Move) {
    for($i=0;$i -lt 40;$i++) {
      # SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE: reproduce native movement.
      if(-not [WindowState]::SetWindowPos($handle,[IntPtr]::Zero,($rect.left+($i%2)),($rect.top+($i%2)),0,0,0x15)) { throw 'SetWindowPos failed' }
      Start-Sleep -Milliseconds 40
    }
  }
  [uint32]$affinity=0
  if(-not [WindowState]::GetWindowDisplayAffinity($handle,[ref]$affinity)) { throw 'GetWindowDisplayAffinity failed' }
  @{affinity=$affinity} | ConvertTo-Json -Compress
} finally { [void][WindowState]::SetThreadDpiAwarenessContext($previous) }
