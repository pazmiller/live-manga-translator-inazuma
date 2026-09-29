param([string]$HandleValue, [string]$PointsJson)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeHit {
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
# Electron supplies physical screen coordinates. Prevent this PowerShell
# thread from virtualizing WM_NCHITTEST coordinates on scaled displays.
$previousDpiContext = [NativeHit]::SetThreadDpiAwarenessContext([IntPtr](-4))
$points = $PointsJson | ConvertFrom-Json
$results = foreach ($point in $points) {
  $packed = (([long]$point.y -band 65535) -shl 16) -bor ([long]$point.x -band 65535)
  $result = [IntPtr]::Zero
  $sent = [NativeHit]::SendMessageTimeout([IntPtr]([long]$HandleValue), 0x84, [IntPtr]::Zero, [IntPtr]$packed, 2, 2000, [ref]$result)
  if ($sent -eq [IntPtr]::Zero) { throw 'WM_NCHITTEST timed out' }
  @{id=$point.id; hit=$result.ToInt64()}
}
ConvertTo-Json -InputObject @($results) -Compress
[void][NativeHit]::SetThreadDpiAwarenessContext($previousDpiContext)
