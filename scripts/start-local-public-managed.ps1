$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$webRoot = Join-Path $workspace "apps\web"
$packagesRoot = Join-Path $workspace "packages"
$envPath = Join-Path $workspace ".local-public.env"
$logRoot = Join-Path $env:LOCALAPPDATA "SuperCanvas\logs"
$managerLog = Join-Path $logRoot "web-3210-manager.log"
$serverOutLog = Join-Path $logRoot "web-3210.out.log"
$serverErrorLog = Join-Path $logRoot "web-3210.err.log"
$drainFlagPath = Join-Path $logRoot "web-3210-draining"
$pauseFlagPath = Join-Path $logRoot "web-3210-manager.paused"
$liveSlots = @(".next-live-a", ".next-live-b")
$activeSlotPath = Join-Path $logRoot "web-3210-active-slot.txt"
$port = 3210

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if (Test-Path -LiteralPath $pauseFlagPath) {
  Write-Output "Super Canvas live-update manager is paused by $pauseFlagPath."
  exit 0
}

function Write-ManagerLog {
  param([string]$Message)

  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  [System.IO.File]::AppendAllText($managerLog, "$line`r`n", [System.Text.Encoding]::UTF8)
  # Manager helpers return typed values through PowerShell's success stream.
  # Logging there turns `$false` into a truthy `[log lines..., $false]` array
  # and can make a failed build replace the healthy deployment.
  [void][Console]::WriteLine($line)
}

function Load-LocalEnvironment {
  if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing $envPath; run scripts/prepare-local-public.mjs first."
  }

  foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
    $trimmed = $line.Trim().TrimStart([char]0xFEFF)
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2) { continue }
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
  }

  $env:PORT = "$port"
}

function Get-ServerNodeOptions {
  $configured = 2048
  if ($env:SUPERCANVAS_NODE_MAX_OLD_SPACE_MB -match '^\d+$') {
    $configured = [Math]::Max(1024, [int]$env:SUPERCANVAS_NODE_MAX_OLD_SPACE_MB)
  }
  $withoutHeapLimit = ([string]$env:NODE_OPTIONS -replace '(?i)(?:^|\s)--max-old-space-size(?:=|\s+)\d+', '').Trim()
  return ("$withoutHeapLimit --max-old-space-size=$configured").Trim()
}

function Get-LocalApiHeaders {
  $headers = @{}
  if ($env:SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN) {
    $headers["Cookie"] = "super_canvas_session=$($env:SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN)"
  }
  return $headers
}

function Get-SourceFiles {
  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  $webSourceRoots = @("app", "components", "lib", "public")

  foreach ($relativeRoot in $webSourceRoots) {
    $sourceRoot = Join-Path $webRoot $relativeRoot
    if (Test-Path -LiteralPath $sourceRoot) {
      Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | ForEach-Object {
        if ($_.Name -notmatch "\.(test|spec)\.[^.]+$") {
          $files.Add($_)
        }
      }
    }
  }

  if (Test-Path -LiteralPath $packagesRoot) {
    Get-ChildItem -LiteralPath $packagesRoot -Directory | ForEach-Object {
      $packageJson = Join-Path $_.FullName "package.json"
      $packageSource = Join-Path $_.FullName "src"
      if (Test-Path -LiteralPath $packageJson) {
        $files.Add((Get-Item -LiteralPath $packageJson))
      }
      Get-ChildItem -LiteralPath $_.FullName -File -Filter "tsconfig*.json" -ErrorAction SilentlyContinue | ForEach-Object {
        $files.Add($_)
      }
      if (Test-Path -LiteralPath $packageSource) {
        Get-ChildItem -LiteralPath $packageSource -Recurse -File | ForEach-Object {
          if ($_.Name -notmatch "\.(test|spec)\.[^.]+$") {
            $files.Add($_)
          }
        }
      }
    }
  }

  $configFiles = @(
    (Join-Path $workspace "package.json"),
    (Join-Path $workspace "pnpm-lock.yaml"),
    (Join-Path $workspace "pnpm-workspace.yaml"),
    (Join-Path $workspace "tsconfig.base.json"),
    (Join-Path $webRoot "package.json"),
    (Join-Path $webRoot "next.config.mjs"),
    (Join-Path $webRoot "proxy.ts"),
    (Join-Path $webRoot "tsconfig.json"),
    $envPath
  )

  foreach ($configFile in $configFiles) {
    if (Test-Path -LiteralPath $configFile) {
      $files.Add((Get-Item -LiteralPath $configFile))
    }
  }

  return $files | Sort-Object FullName -Unique
}

function Get-SourceFingerprint {
  $builder = New-Object System.Text.StringBuilder
  foreach ($file in Get-SourceFiles) {
    $fileSha256 = [System.Security.Cryptography.SHA256]::Create()
    $fileStream = [System.IO.File]::OpenRead($file.FullName)
    try {
      $fileHashBytes = $fileSha256.ComputeHash($fileStream)
      $fileHash = ([System.BitConverter]::ToString($fileHashBytes)).Replace("-", "")
    } finally {
      $fileStream.Dispose()
      $fileSha256.Dispose()
    }
    [void]$builder.Append($file.FullName)
    [void]$builder.Append("|")
    [void]$builder.Append($fileHash)
    [void]$builder.Append("`n")
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
    $hash = $sha256.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Wait-ForStableFingerprint {
  param([string]$InitialFingerprint)

  $candidate = $InitialFingerprint
  while ($true) {
    Start-Sleep -Seconds 2
    $nextFingerprint = Get-SourceFingerprint
    if ($nextFingerprint -eq $candidate) {
      return $candidate
    }
    $candidate = $nextFingerprint
  }
}

function Get-SlotFingerprint {
  param([string]$Slot)

  $fingerprintPath = Join-Path (Join-Path $webRoot $Slot) ".source-fingerprint"
  if (-not (Test-Path -LiteralPath $fingerprintPath)) { return $null }
  return (Get-Content -LiteralPath $fingerprintPath -Raw).Trim()
}

function Test-ValidBuildSlot {
  param([string]$Slot)

  return Test-Path -LiteralPath (Join-Path (Join-Path $webRoot $Slot) "BUILD_ID")
}

function Find-MatchingSlot {
  param([string]$Fingerprint)

  foreach ($slot in $liveSlots) {
    if ((Test-ValidBuildSlot $slot) -and ((Get-SlotFingerprint $slot) -eq $Fingerprint)) {
      return $slot
    }
  }
  return $null
}

function Find-LatestValidSlot {
  $candidates = @($liveSlots + ".next") | Where-Object {
    (Test-ValidBuildSlot $_) -and (Get-SlotFingerprint -Slot $_)
  }
  if (-not $candidates) { return $null }
  return $candidates |
    Sort-Object { (Get-Item -LiteralPath (Join-Path (Join-Path $webRoot $_) "BUILD_ID")).LastWriteTimeUtc } -Descending |
    Select-Object -First 1
}

function Get-RecordedActiveSlot {
  if (-not (Test-Path -LiteralPath $activeSlotPath)) { return $null }
  $slot = (Get-Content -LiteralPath $activeSlotPath -Raw).Trim()
  if (($liveSlots -notcontains $slot) -or -not (Test-ValidBuildSlot $slot)) {
    return $null
  }
  return $slot
}

function Resolve-PnpmCommand {
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpm -and $pnpm.Source) {
    return @{
      Command = $pnpm.Source
      PrefixArguments = @()
    }
  }

  $corepackCandidates = @(
    (Join-Path $env:ProgramFiles "nodejs\corepack.cmd"),
    (Get-Command corepack.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

  $corepack = $corepackCandidates | Select-Object -First 1
  if ($corepack) {
    return @{
      Command = $corepack
      PrefixArguments = @("pnpm")
    }
  }

  throw "Neither pnpm.cmd nor corepack.cmd could be found."
}

function Select-InactiveSlot {
  param([string]$ActiveSlot)

  if ($ActiveSlot -eq $liveSlots[0]) { return $liveSlots[1] }
  return $liveSlots[0]
}

function Invoke-LiveBuild {
  param(
    [string]$Slot,
    [string]$Fingerprint,
    [string]$PnpmCommand,
    [string[]]$PnpmPrefixArguments = @()
  )

  Write-ManagerLog "Building source fingerprint $Fingerprint into $Slot."
  Load-LocalEnvironment
  $env:NEXT_DIST_DIR = $Slot
  $env:NEXT_DEPLOYMENT_ID = $Fingerprint
  $slotRoot = Join-Path $webRoot $Slot
  $fingerprintPath = Join-Path $slotRoot ".source-fingerprint"

  # A failed or interrupted build must never look deployable to a later loop.
  Remove-Item -LiteralPath $fingerprintPath -Force -ErrorAction SilentlyContinue

  Push-Location -LiteralPath $workspace
  try {
    & $PnpmCommand @PnpmPrefixArguments "--filter" "@super-canvas/web..." "build" 2>&1 | ForEach-Object {
      Write-ManagerLog "build: $_"
    }
    $buildExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($buildExitCode -ne 0 -or -not (Test-ValidBuildSlot $Slot)) {
    Remove-Item -LiteralPath $fingerprintPath -Force -ErrorAction SilentlyContinue
    Write-ManagerLog "Build failed with exit code $buildExitCode. The current service remains active."
    return $false
  }

  [System.IO.File]::WriteAllText($fingerprintPath, "$Fingerprint`r`n", [System.Text.Encoding]::ASCII)
  Write-ManagerLog "Build completed in $Slot."
  return $true
}

function Stop-ProcessTree {
  param([int]$TargetProcessId)

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -TargetProcessId ([int]$child.ProcessId)
  }
  Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-StaleCanvasServers {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $ownerId = [int]$listener.OwningProcess
    if ($ownerId -le 0 -or $ownerId -eq $PID) { continue }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
    if (-not $processInfo) { continue }
    $commandLine = [string]$processInfo.CommandLine
    $resolvedWebRoot = [System.IO.Path]::GetFullPath($webRoot)
    $resolvedNextScript = [System.IO.Path]::GetFullPath($nextScript)
    $isCanvasServer =
      $commandLine.IndexOf($resolvedWebRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $commandLine.IndexOf($resolvedNextScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $commandLine -match '(?i)\bstart\b.*(?:-p|--port)\s+[\"]?3210\b'
    if (-not $isCanvasServer) {
      throw "Port $port is occupied by another application (PID $ownerId)."
    }
    Write-ManagerLog "Stopping stale Super Canvas server PID $ownerId."
    Stop-ProcessTree -TargetProcessId $ownerId
  }

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $port did not become available."
}

function Enter-DeploymentDrain {
  [System.IO.File]::WriteAllText(
    $drainFlagPath,
    "deployment in progress`r`n",
    [System.Text.Encoding]::ASCII
  )
}

function Exit-DeploymentDrain {
  Remove-Item -LiteralPath $drainFlagPath -Force -ErrorAction SilentlyContinue
}

function Rotate-ServerLog {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  Move-Item -LiteralPath $Path -Destination "$Path.$timestamp" -Force
}

function Wait-ForActiveRunDrain {
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    return
  }

  $attempt = 0
  $failures = 0
  while ($true) {
    try {
      $response = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$port/api/runs" `
        -Headers (Get-LocalApiHeaders) `
        -TimeoutSec 10
      # Windows PowerShell may preserve a top-level JSON array as one object;
      # piping the stored response enumerates every run snapshot reliably.
      $snapshots = @($response | ForEach-Object { $_ })
      $active = @($snapshots | Where-Object {
        $_.run.status -eq "queued" -or $_.run.status -eq "running"
      })
      $failures = 0
      if ($active.Count -eq 0) {
        if ($attempt -gt 0) {
          Write-ManagerLog "All active runs finished; continuing the live update."
        }
        return
      }
      if (($attempt % 6) -eq 0) {
        Write-ManagerLog "Deferring live update while $($active.Count) paid run(s) are active."
      }
    } catch {
      $failures += 1
      if ($failures -ge 3) {
        throw "Unable to verify that active runs are drained; keeping the current service alive."
      }
    }
    $attempt += 1
    Start-Sleep -Seconds 5
  }
}

function Start-LiveServer {
  param(
    [string]$Slot,
    [string]$NodeCommand,
    [string]$NextScript
  )

  if (-not (Test-ValidBuildSlot $Slot)) {
    throw "Refusing to replace the active service with invalid build slot $Slot."
  }

  Load-LocalEnvironment
  Enter-DeploymentDrain
  try {
    Wait-ForActiveRunDrain
    Stop-StaleCanvasServers
    $env:NEXT_DIST_DIR = $Slot
    $slotFingerprint = Get-SlotFingerprint -Slot $Slot
    if (-not $slotFingerprint) {
      throw "Refusing to start $Slot without a source fingerprint."
    }
    $env:NEXT_DEPLOYMENT_ID = $slotFingerprint

    Rotate-ServerLog -Path $serverOutLog
    Rotate-ServerLog -Path $serverErrorLog

    $quotedNextScript = '"' + $NextScript + '"'
    $previousNodeOptions = $env:NODE_OPTIONS
    try {
      $env:NODE_OPTIONS = Get-ServerNodeOptions
      $serverProcess = Start-Process `
        -FilePath $NodeCommand `
        -ArgumentList @($quotedNextScript, "start", "-p", "$port") `
        -WorkingDirectory $webRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverOutLog `
        -RedirectStandardError $serverErrorLog `
        -PassThru
    } finally {
      $env:NODE_OPTIONS = $previousNodeOptions
    }

    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
      if ($serverProcess.HasExited) {
        $errorTail = ""
        if (Test-Path -LiteralPath $serverErrorLog) {
          $errorTail = (Get-Content -LiteralPath $serverErrorLog -Tail 8) -join " | "
        }
        throw "Server exited during startup. $errorTail"
      }
      try {
        $health = Invoke-WebRequest `
          -Uri "http://127.0.0.1:$port/api/health" `
          -Headers (Get-LocalApiHeaders) `
          -UseBasicParsing `
          -TimeoutSec 2
        if ($health.StatusCode -eq 200) {
          [System.IO.File]::WriteAllText($activeSlotPath, "$Slot`r`n", [System.Text.Encoding]::ASCII)
          Write-ManagerLog "Serving $Slot on port $port with PID $($serverProcess.Id)."
          return $serverProcess
        }
      } catch {
        Start-Sleep -Seconds 1
      }
    }

    Stop-ProcessTree -TargetProcessId $serverProcess.Id
    throw "Server did not become healthy within 30 seconds."
  } finally {
    Exit-DeploymentDrain
  }
}

$managerMutex = New-Object System.Threading.Mutex($false, "Local\SuperCanvasWeb3210")
$ownsMutex = $false
try {
  try {
    $ownsMutex = $managerMutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }

  if (-not $ownsMutex) {
    Write-ManagerLog "Another Super Canvas manager is already running; waiting as hot standby."
    try {
      $ownsMutex = $managerMutex.WaitOne()
    } catch [System.Threading.AbandonedMutexException] {
      $ownsMutex = $true
    }
    Write-ManagerLog "Hot standby acquired the manager lock; taking over."
  }

  $packageManager = Resolve-PnpmCommand
  $pnpmCommand = $packageManager.Command
  $pnpmPrefixArguments = @($packageManager.PrefixArguments)
  $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
  $nextScript = Join-Path $webRoot "node_modules\next\dist\bin\next"
  if (-not (Test-Path -LiteralPath $nextScript)) {
    throw "Missing Next.js command: $nextScript"
  }

  Write-ManagerLog "Super Canvas live-update manager started."
  $deployedFingerprint = Get-SourceFingerprint
  $activeSlot = Find-MatchingSlot -Fingerprint $deployedFingerprint
  $serverProcess = $null

  if (-not $activeSlot) {
    $previousActiveSlot = Get-RecordedActiveSlot
    if (-not $previousActiveSlot) {
      $previousActiveSlot = Find-LatestValidSlot
    }
    $targetSlot = Select-InactiveSlot -ActiveSlot $previousActiveSlot
    $initialBuildOutcome = @(Invoke-LiveBuild -Slot $targetSlot -Fingerprint $deployedFingerprint -PnpmCommand $pnpmCommand -PnpmPrefixArguments $pnpmPrefixArguments)
    $initialBuildSucceeded =
      $initialBuildOutcome.Count -eq 1 -and
      $initialBuildOutcome[0] -is [bool] -and
      $initialBuildOutcome[0]
    if ($initialBuildSucceeded) {
      $postBuildFingerprint = Get-SourceFingerprint
      if ($postBuildFingerprint -eq $deployedFingerprint) {
        $activeSlot = $targetSlot
      } else {
        Write-ManagerLog "Source changed during the initial build; another build will run."
        $deployedFingerprint = $null
      }
    }
  }

  if ($activeSlot) {
    $serverProcess = Start-LiveServer -Slot $activeSlot -NodeCommand $nodeCommand -NextScript $nextScript
  } elseif (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    $fallbackSlot = Find-LatestValidSlot
    if ($fallbackSlot) {
      Write-ManagerLog "Starting last successful build $fallbackSlot until the source builds successfully."
      $activeSlot = $fallbackSlot
      $serverProcess = Start-LiveServer -Slot $activeSlot -NodeCommand $nodeCommand -NextScript $nextScript
    }
  }

  $lastAttemptedFingerprint = $deployedFingerprint
  while ($true) {
    Start-Sleep -Seconds 2

    if ($serverProcess -and $serverProcess.HasExited) {
      Write-ManagerLog "Server PID $($serverProcess.Id) exited; restarting the active build in 5 seconds."
      Start-Sleep -Seconds 5
      $serverProcess = $null
      while (-not $serverProcess) {
        try {
          $serverProcess = Start-LiveServer -Slot $activeSlot -NodeCommand $nodeCommand -NextScript $nextScript
        } catch {
          Write-ManagerLog "Server restart failed: $($_.Exception.Message). Retrying in 5 seconds."
          Start-Sleep -Seconds 5
        }
      }
    }

    $observedFingerprint = Get-SourceFingerprint
    if ($observedFingerprint -eq $deployedFingerprint -or $observedFingerprint -eq $lastAttemptedFingerprint) {
      continue
    }

    $targetFingerprint = Wait-ForStableFingerprint -InitialFingerprint $observedFingerprint
    $lastAttemptedFingerprint = $targetFingerprint
    $targetSlot = Select-InactiveSlot -ActiveSlot $activeSlot

    $buildOutcome = @(Invoke-LiveBuild -Slot $targetSlot -Fingerprint $targetFingerprint -PnpmCommand $pnpmCommand -PnpmPrefixArguments $pnpmPrefixArguments)
    $buildSucceeded =
      $buildOutcome.Count -eq 1 -and
      $buildOutcome[0] -is [bool] -and
      $buildOutcome[0]
    if (-not $buildSucceeded) {
      continue
    }

    if ((Get-SourceFingerprint) -ne $targetFingerprint) {
      Write-ManagerLog "Source changed during build; keeping the current service and rebuilding the latest source."
      continue
    }

    $previousSlot = $activeSlot
    try {
      $newServerProcess = Start-LiveServer -Slot $targetSlot -NodeCommand $nodeCommand -NextScript $nextScript
      $serverProcess = $newServerProcess
      $activeSlot = $targetSlot
      $deployedFingerprint = $targetFingerprint
      $lastAttemptedFingerprint = $null
      Write-ManagerLog "Live update completed: $previousSlot -> $activeSlot."
    } catch {
      Write-ManagerLog "New build could not start: $($_.Exception.Message)"
      if ($previousSlot) {
        Write-ManagerLog "Starting the previous successful build in a fresh process."
        $activeSlot = $previousSlot
        $serverProcess = Start-LiveServer -Slot $activeSlot -NodeCommand $nodeCommand -NextScript $nextScript
      }
    }
  }
} catch {
  Write-ManagerLog "Manager stopped because of an error: $($_.Exception.Message)"
  throw
} finally {
  if ($ownsMutex) {
    try { $managerMutex.ReleaseMutex() } catch { }
  }
  $managerMutex.Dispose()
}
