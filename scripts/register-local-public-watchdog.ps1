[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "SuperCanvas")
)

$ErrorActionPreference = "Stop"

$resolvedInstallRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
$watchdog = Join-Path $resolvedInstallRoot "start-local-public-watchdog.ps1"
if (-not (Test-Path -LiteralPath $watchdog)) {
  throw "缺少守护脚本：$watchdog"
}

$taskName = "SuperCanvas-Web3210-Watchdog"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdog`""
$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  try { Start-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch { }
  Write-Output "Registered $taskName for $userId"
} catch {
  $startupRoot = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupRoot "SuperCanvas Watchdog.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $resolvedInstallRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Super Canvas local web watchdog"
  $shortcut.Save()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
  Write-Output "Scheduled task registration was unavailable; installed $shortcutPath instead."
}
