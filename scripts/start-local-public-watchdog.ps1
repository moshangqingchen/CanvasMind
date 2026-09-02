[CmdletBinding()]
param(
  [int]$CheckIntervalSeconds = 10,
  [int]$UnhealthyThreshold = 3,
  [int]$StaleHeartbeatSeconds = 45,
  [int]$StartupGraceSeconds = 180,
  [int]$RestartCooldownSeconds = 20
)

$ErrorActionPreference = "Stop"

$installRoot = (Resolve-Path $PSScriptRoot).Path
$activePath = Join-Path $installRoot "active-release.txt"
$envPath = Join-Path $installRoot ".local-public.env"
$updateRoot = Join-Path $installRoot "updates"
$releaseRoot = Join-Path $installRoot "releases"
$logRoot = Join-Path $env:LOCALAPPDATA "SuperCanvas\logs"
$watchdogLog = Join-Path $logRoot "web-3210-watchdog.log"
$statusPath = Join-Path $updateRoot "status.json"
$pauseFlagPath = Join-Path $logRoot "web-3210-manager.paused"
$mutex = New-Object System.Threading.Mutex($false, "Local\SuperCanvasWeb3210Watchdog")
$ownsMutex = $false
$script:lastManagerStartAt = [DateTime]::MinValue

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Write-WatchdogLog {
  param([string]$Message)

  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  [System.IO.File]::AppendAllText($watchdogLog, "$line`r`n", [System.Text.Encoding]::UTF8)
  [void][Console]::WriteLine($line)
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json } catch { return $null }
}

function Get-ManagerProcess {
  param([int]$ProcessId)

  if ($ProcessId -le 0) { return $null }
  try {
    $command = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if (-not $command -or [string]$command.CommandLine -notmatch "start-local-public-managed\.ps1") {
      return $null
    }
    return Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return $null
  }
}

function Find-ManagerProcess {
  try {
    $candidate = Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.Name -match "^powershell(?:\.exe)?$" -and
        [string]$_.CommandLine -match "start-local-public-managed\.ps1"
      } |
      Select-Object -First 1
    if (-not $candidate) { return $null }
    return Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction Stop
  } catch {
    return $null
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return }
  $children = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }
  try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { }
}

function Test-LocalOrigin {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3210/api/health" -UseBasicParsing -TimeoutSec 3
    return [int]$response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-HeartbeatAgeSeconds {
  param($Status)

  if (-not $Status -or -not $Status.managerHeartbeatAt) { return [double]::PositiveInfinity }
  try {
    return ((Get-Date).ToUniversalTime() - [DateTime]::Parse([string]$Status.managerHeartbeatAt).ToUniversalTime()).TotalSeconds
  } catch {
    return [double]::PositiveInfinity
  }
}

function Start-Manager {
  if (Test-Path -LiteralPath $pauseFlagPath) {
    Write-WatchdogLog "Manager is paused by $pauseFlagPath; waiting for it to be resumed."
    return $false
  }

  if (-not (Test-Path -LiteralPath $activePath)) {
    Write-WatchdogLog "Cannot restart manager: $activePath is missing."
    return $false
  }
  $active = (Get-Content -LiteralPath $activePath -Raw -Encoding utf8).Trim()
  if (-not $active -or -not (Test-Path -LiteralPath $active)) {
    Write-WatchdogLog "Cannot restart manager: active release directory is missing ($active)."
    return $false
  }
  $manager = Join-Path $active "scripts\start-local-public-managed.ps1"
  if (-not (Test-Path -LiteralPath $manager)) {
    Write-WatchdogLog "Cannot restart manager: $manager is missing."
    return $false
  }

  $env:SUPERCANVAS_ACTIVE_RELEASE_ROOT = $active
  $env:SUPERCANVAS_RUNTIME_ENV_PATH = $envPath
  $env:SUPERCANVAS_UPDATE_ROOT = $updateRoot
  $env:SUPERCANVAS_RELEASE_ROOT = $releaseRoot
  try {
    # Start-Process joins ArgumentList entries with spaces. Quote the script
    # path explicitly because release roots commonly contain spaces.
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$manager`""
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $active -WindowStyle Hidden -PassThru
    $script:lastManagerStartAt = Get-Date
    Write-WatchdogLog "Started manager PID $($process.Id) for release $active."
    return $true
  } catch {
    Write-WatchdogLog "Manager restart failed: $($_.Exception.Message)"
    return $false
  }
}

try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) { exit 0 }

  Write-WatchdogLog "Super Canvas watchdog started."
  $failures = 0
  while ($true) {
    if (Test-Path -LiteralPath $pauseFlagPath) {
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }

    $originHealthy = Test-LocalOrigin
    $status = Read-JsonFile -Path $statusPath
    $managerPid = if ($status) { [int]$status.managerPid } else { 0 }
    $managerProcess = Get-ManagerProcess -ProcessId $managerPid
    if (-not $managerProcess) {
      $managerProcess = Find-ManagerProcess
    }
    if (-not $managerProcess) {
      $launchAge = ((Get-Date) - $script:lastManagerStartAt).TotalSeconds
      if ($launchAge -ge $RestartCooldownSeconds) {
        if (Start-Manager) { $failures = 0 }
      }
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }

    if ($originHealthy) {
      $failures = 0
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }

    $failures += 1
    $heartbeatAge = Get-HeartbeatAgeSeconds -Status $status
    $processAge = ((Get-Date) - $managerProcess.StartTime).TotalSeconds
    if ($processAge -lt $StartupGraceSeconds) {
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }
    if ($failures -ge $UnhealthyThreshold -and $heartbeatAge -ge $StaleHeartbeatSeconds) {
      Write-WatchdogLog "Origin is unhealthy; manager PID $managerPid heartbeat is $([math]::Round($heartbeatAge))s old. Restarting manager tree."
      Stop-ProcessTree -ProcessId $managerPid
      Start-Sleep -Seconds 2
      if (Start-Manager) { $failures = 0 }
    }
    Start-Sleep -Seconds $CheckIntervalSeconds
  }
} catch {
  Write-WatchdogLog "Watchdog stopped because of an error: $($_.Exception.Message)"
  throw
} finally {
  if ($ownsMutex) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}
