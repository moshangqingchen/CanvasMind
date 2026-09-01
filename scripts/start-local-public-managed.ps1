$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$activeReleaseRoot = $env:SUPERCANVAS_ACTIVE_RELEASE_ROOT
if ($activeReleaseRoot -and (Test-Path -LiteralPath $activeReleaseRoot)) {
  $workspace = (Resolve-Path $activeReleaseRoot).Path
}
$webRoot = Join-Path $workspace "apps\web"
$packagesRoot = Join-Path $workspace "packages"
$envPath = if ($env:SUPERCANVAS_RUNTIME_ENV_PATH) {
  [System.IO.Path]::GetFullPath($env:SUPERCANVAS_RUNTIME_ENV_PATH)
} else {
  Join-Path $workspace ".local-public.env"
}
$logRoot = Join-Path $env:LOCALAPPDATA "SuperCanvas\logs"
$managerLog = Join-Path $logRoot "web-3210-manager.log"
$serverOutLog = Join-Path $logRoot "web-3210.out.log"
$serverErrorLog = Join-Path $logRoot "web-3210.err.log"
$drainFlagPath = Join-Path $logRoot "web-3210-draining"
$pauseFlagPath = Join-Path $logRoot "web-3210-manager.paused"
$liveSlots = @(".next-live-a", ".next-live-b")
$activeSlotPath = Join-Path $logRoot "web-3210-active-slot.txt"
$updateRoot = if ($env:SUPERCANVAS_UPDATE_ROOT) {
  [System.IO.Path]::GetFullPath($env:SUPERCANVAS_UPDATE_ROOT)
} else {
  Join-Path $env:LOCALAPPDATA "SuperCanvas\updates"
}
$updateStatusPath = Join-Path $updateRoot "status.json"
$updateCommandPath = Join-Path $updateRoot "command.json"
$releaseRoot = if ($env:SUPERCANVAS_RELEASE_ROOT) {
  [System.IO.Path]::GetFullPath($env:SUPERCANVAS_RELEASE_ROOT)
} else {
  Join-Path (Split-Path -Parent $updateRoot) "releases"
}
$installRoot = Split-Path -Parent $updateRoot
$port = 3210
$script:previousWebRoots = New-Object System.Collections.Generic.List[string]
$script:activeReleaseVersion = $null

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

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

function Get-ApplicationVersion {
  $packagePath = Join-Path $workspace "package.json"
  try {
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding utf8 | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { return $version }
  } catch { }
  return "0.1.0"
}

function Get-UpdateConfig {
  $interval = 600
  if ($env:SUPERCANVAS_UPDATE_INTERVAL_SECONDS -match '^\d+$') {
    $interval = [Math]::Max(60, [int]$env:SUPERCANVAS_UPDATE_INTERVAL_SECONDS)
  }
  return @{
    Enabled = $env:SUPERCANVAS_UPDATE_ENABLED -ne "false"
    Repository = if ($env:SUPERCANVAS_UPDATE_REPOSITORY) { $env:SUPERCANVAS_UPDATE_REPOSITORY.Trim() } else { "moshangqingchen/CanvasMind" }
    IntervalSeconds = $interval
    Token = if ($env:SUPERCANVAS_GITHUB_TOKEN) { $env:SUPERCANVAS_GITHUB_TOKEN.Trim() } else { $null }
  }
}

function Get-UpdateHeaders {
  $config = Get-UpdateConfig
  $headers = @{
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent" = "SuperCanvas-Updater"
  }
  if ($config.Token) { $headers.Authorization = "Bearer $($config.Token)" }
  return $headers
}

function Read-UpdateStatusObject {
  if (-not (Test-Path -LiteralPath $updateStatusPath)) { return $null }
  try { return Get-Content -LiteralPath $updateStatusPath -Raw -Encoding utf8 | ConvertFrom-Json } catch { return $null }
}

function Write-UpdateStatus {
  param([hashtable]$Patch)

  $status = Read-UpdateStatusObject
  if (-not $status) { $status = [pscustomobject]@{} }
  foreach ($entry in $Patch.GetEnumerator()) {
    $property = $status.PSObject.Properties[$entry.Key]
    if ($property) { $property.Value = $entry.Value }
    else { $status | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value }
  }
  $status.formatVersion = 1
  if (-not $status.currentVersion) { $status.currentVersion = Get-ApplicationVersion }
  $status.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  $temporaryPath = "$updateStatusPath.$PID.tmp"
  [System.IO.File]::WriteAllText($temporaryPath, ($status | ConvertTo-Json -Depth 8), [System.Text.Encoding]::UTF8)
  Move-Item -LiteralPath $temporaryPath -Destination $updateStatusPath -Force
}

function Compare-SemVer {
  param([string]$Left, [string]$Right)
  try { return ([version]$Left).CompareTo([version]$Right) } catch { return 0 }
}

function Set-ActiveReleaseRoot {
  param([string]$Root)

  $resolved = (Resolve-Path -LiteralPath $Root).Path
  if ($script:webRoot -and ($script:webRoot -ne (Join-Path $resolved "apps\web"))) {
    [void]$script:previousWebRoots.Add($script:webRoot)
  }
  $script:workspace = $resolved
  $script:webRoot = Join-Path $resolved "apps\web"
  $script:packagesRoot = Join-Path $resolved "packages"
  $script:nextScript = Join-Path $script:webRoot "node_modules\next\dist\bin\next"
  $version = Get-ApplicationVersion
  $script:activeReleaseVersion = $version
  $script:envPath = if ($env:SUPERCANVAS_RUNTIME_ENV_PATH) {
    [System.IO.Path]::GetFullPath($env:SUPERCANVAS_RUNTIME_ENV_PATH)
  } else {
    Join-Path $resolved ".local-public.env"
  }
}

function Invoke-ReleaseCheck {
  $config = Get-UpdateConfig
  if (-not $config.Enabled) {
    Write-UpdateStatus @{ phase = "disabled"; currentVersion = Get-ApplicationVersion }
    return
  }

  $now = (Get-Date).ToUniversalTime().ToString("o")
  Write-UpdateStatus @{ phase = "checking"; lastCheckedAt = $now; error = $null }
  try {
    if ($config.Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Invalid GitHub repository configuration." }
    $url = "https://api.github.com/repos/$($config.Repository)/releases?per_page=30"
    $releases = @(Invoke-RestMethod -Uri $url -Headers (Get-UpdateHeaders) -TimeoutSec 20)
    $currentVersion = Get-ApplicationVersion
    $candidate = $null
    foreach ($release in $releases) {
      if ($release.draft -or $release.prerelease) { continue }
      $tag = [string]$release.tag_name
      if ($tag -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
      $version = $Matches[1]
      if ((Compare-SemVer $version $currentVersion) -le 0) { continue }
      if ($candidate -and (Compare-SemVer $version $candidate.Version) -le 0) { continue }
      $zipName = "super-canvas-v$version-windows-x64.zip"
      $sidecarName = "super-canvas-v$version-release-manifest.json"
      $zip = @($release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1)
      $sidecar = @($release.assets | Where-Object { $_.name -eq $sidecarName } | Select-Object -First 1)
      $candidate = [pscustomobject]@{
        Version = $version
        Tag = $tag
        Commit = [string]$release.target_commitish
        PublishedAt = [string]$release.published_at
        HtmlUrl = [string]$release.html_url
        Notes = ([string]$release.body).Substring(0, [Math]::Min(50000, ([string]$release.body).Length))
        AssetName = $zipName
        AssetSize = if ($zip) { [int64]$zip.size } else { $null }
        AssetUrl = if ($zip) { [string]$zip.browser_download_url } else { $null }
        ManifestUrl = if ($sidecar) { [string]$sidecar.browser_download_url } else { $null }
      }
    }
    if (-not $candidate) {
      Write-UpdateStatus @{ phase = "idle"; currentVersion = $currentVersion; lastSuccessfulCheckAt = $now; latest = $null }
      return
    }
    $status = Read-UpdateStatusObject
    $deferred = if ($status) { [string]$status.deferredVersion } else { "" }
    $phase = if ($deferred -eq $candidate.Version) { "idle" } else { "available" }
    Write-UpdateStatus @{
      phase = $phase
      currentVersion = $currentVersion
      latest = $candidate
      lastSuccessfulCheckAt = $now
      error = if ($candidate.AssetUrl -and $candidate.ManifestUrl) { $null } else { "此版本缺少 Windows 更新包或校验清单" }
    }
    Write-ManagerLog "GitHub Release check found $($candidate.Tag)."
  } catch {
    Write-UpdateStatus @{ phase = "failed"; currentVersion = Get-ApplicationVersion; error = "检查 GitHub Release 失败：$($_.Exception.Message)" }
    Write-ManagerLog "GitHub Release check failed: $($_.Exception.Message)"
  }
}

function Invoke-ReleaseDownload {
  $status = Read-UpdateStatusObject
  $latest = if ($status) { $status.latest } else { $null }
  if (-not $latest -or -not $latest.assetUrl -or -not $latest.manifestUrl) {
    Invoke-ReleaseCheck
    $status = Read-UpdateStatusObject
    $latest = if ($status) { $status.latest } else { $null }
  }
  if (-not $latest -or -not $latest.assetUrl -or -not $latest.manifestUrl) {
    Write-UpdateStatus @{ phase = "failed"; error = "当前 Release 没有可用的 Windows 更新包" }
    return
  }
  if ([string]$latest.version -notmatch '^\d+\.\d+\.\d+$') { throw "Unsafe release version." }
  $downloadDirectory = Join-Path $updateRoot "downloads"
  New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
  $archivePath = Join-Path $downloadDirectory ([System.IO.Path]::GetFileName([string]$latest.assetName))
  $manifestPath = Join-Path $downloadDirectory "release-manifest.json"
  Write-UpdateStatus @{ phase = "downloading"; progress = @{ downloadedBytes = 0; totalBytes = $latest.assetSize } ; error = $null }
  try {
    Invoke-WebRequest -Uri ([string]$latest.assetUrl) -Headers (Get-UpdateHeaders) -OutFile $archivePath -UseBasicParsing -TimeoutSec 300
    Invoke-WebRequest -Uri ([string]$latest.manifestUrl) -Headers (Get-UpdateHeaders) -OutFile $manifestPath -UseBasicParsing -TimeoutSec 60
    $sidecar = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ([string]$sidecar.version -ne [string]$latest.version -or [string]$sidecar.tag -ne [string]$latest.tag -or [string]$sidecar.assetName -ne [string]$latest.assetName -or [string]$sidecar.assetSha256.ToLowerInvariant() -ne $hash) {
      throw "更新包校验失败。"
    }
    Write-UpdateStatus @{ phase = "ready"; downloadedVersion = [string]$latest.version; downloadPath = $archivePath; progress = @{ downloadedBytes = (Get-Item -LiteralPath $archivePath).Length; totalBytes = (Get-Item -LiteralPath $archivePath).Length }; error = $null }
    Write-ManagerLog "Downloaded and verified $($latest.tag)."
  } catch {
    Write-UpdateStatus @{ phase = "failed"; error = "下载更新失败：$($_.Exception.Message)" }
    Write-ManagerLog "Release download failed: $($_.Exception.Message)"
  }
}

function Read-UpdateCommand {
  if (-not (Test-Path -LiteralPath $updateCommandPath)) { return $null }
  try {
    $command = Get-Content -LiteralPath $updateCommandPath -Raw -Encoding utf8 | ConvertFrom-Json
    Remove-Item -LiteralPath $updateCommandPath -Force -ErrorAction SilentlyContinue
    return $command
  } catch {
    Remove-Item -LiteralPath $updateCommandPath -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Remove-OldReleaseDirectories {
  param([string]$KeepVersion)

  if (-not (Test-Path -LiteralPath $releaseRoot)) { return }
  $directories = @(Get-ChildItem -LiteralPath $releaseRoot -Directory -Force |
    Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' } |
    Sort-Object LastWriteTimeUtc -Descending)
  $keptRollback = $false
  foreach ($directory in $directories) {
    if ($directory.Name -eq "v$KeepVersion") { continue }
    if (-not $keptRollback) {
      $keptRollback = $true
      continue
    }
    try {
      Remove-Item -LiteralPath $directory.FullName -Recurse -Force -ErrorAction Stop
      Write-ManagerLog "Removed old release directory $($directory.Name)."
    } catch {
      Write-ManagerLog "Unable to remove old release directory $($directory.Name): $($_.Exception.Message)"
    }
  }
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

  $env:NEXT_PUBLIC_APP_VERSION = Get-ApplicationVersion
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
  param([switch]$Optional)

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

  if ($Optional) { return $null }
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

function Adopt-PrebuiltBuild {
  param(
    [string]$Slot,
    [string]$Fingerprint
  )

  $prebuiltRoot = Join-Path $webRoot ".next"
  if (-not (Test-Path -LiteralPath (Join-Path $prebuiltRoot "BUILD_ID"))) { return $false }
  $slotRoot = Join-Path $webRoot $Slot
  if (Test-Path -LiteralPath $slotRoot) { Remove-Item -LiteralPath $slotRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $slotRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $prebuiltRoot "*") -Destination $slotRoot -Recurse -Force
  [System.IO.File]::WriteAllText((Join-Path $slotRoot ".source-fingerprint"), "$Fingerprint`r`n", [System.Text.Encoding]::ASCII)
  return Test-ValidBuildSlot $Slot
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
    $knownRoots = @($webRoot) + @($script:previousWebRoots)
    $isCanvasServer =
      ($knownRoots | Where-Object {
        $commandLine.IndexOf([System.IO.Path]::GetFullPath($_), [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      }).Count -gt 0 -and
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

function Invoke-ReleaseApply {
  param(
    [ref]$ActiveSlot,
    [ref]$ServerProcess,
    [ref]$DeployedFingerprint,
    [ref]$LastAttemptedFingerprint,
    [string]$NodeCommand
  )

  $status = Read-UpdateStatusObject
  $archivePath = if ($status) { [string]$status.downloadPath } else { "" }
  $version = if ($status) { [string]$status.downloadedVersion } else { "" }
  if (-not $status -or $status.phase -ne "ready" -or -not $archivePath -or $version -notmatch '^\d+\.\d+\.\d+$' -or -not (Test-Path -LiteralPath $archivePath)) {
    Write-UpdateStatus @{ phase = "failed"; error = "更新包尚未准备完成" }
    return
  }
  $currentVersion = Get-ApplicationVersion
  if ((Compare-SemVer $version $currentVersion) -le 0) {
    Write-UpdateStatus @{ phase = "failed"; currentVersion = $currentVersion; error = "拒绝安装低于或等于当前版本的更新包" }
    return
  }

  $candidateRoot = Join-Path $releaseRoot "v$version"
  $previousRoot = $script:workspace
  $previousSlot = $ActiveSlot.Value
  $previousFingerprint = $DeployedFingerprint.Value
  Write-UpdateStatus @{ phase = "waiting_for_idle"; error = $null }
  # Stop new paid submissions while waiting, otherwise a continuously busy
  # canvas could keep extending the drain window forever.
  Enter-DeploymentDrain
  try {
    if (Test-Path -LiteralPath $candidateRoot) { Remove-Item -LiteralPath $candidateRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $candidateRoot -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $candidateRoot -Force
    $manifestPath = Join-Path $candidateRoot "release-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
    if (
      [int]$manifest.formatVersion -ne 1 -or
      [string]$manifest.app -ne "super-canvas" -or
      [string]$manifest.version -ne $version -or
      [string]$manifest.tag -ne "v$version"
    ) { throw "更新包版本清单不匹配。" }
    $candidatePackage = Get-Content -LiteralPath (Join-Path $candidateRoot "package.json") -Raw -Encoding utf8 | ConvertFrom-Json
    if ([string]$candidatePackage.version -ne $version) { throw "更新包 package.json 版本不匹配。" }

    # The drain protocol guarantees that a paid run is not killed by a release
    # switch. Port 3210 is then handed to the candidate; a failed health check
    # starts the previous release again.
    Wait-ForActiveRunDrain
    Write-UpdateStatus @{ phase = "applying"; error = $null }
    Set-ActiveReleaseRoot -Root $candidateRoot
    if (-not (Test-Path -LiteralPath $script:nextScript)) { throw "更新包缺少 Next.js 运行时。" }
    $candidateFingerprint = Get-SourceFingerprint
    $candidateSlot = Select-InactiveSlot -ActiveSlot $previousSlot
    $buildOutcome = if (Adopt-PrebuiltBuild -Slot $candidateSlot -Fingerprint $candidateFingerprint) {
      @($true)
    } elseif ($pnpmCommand) {
      @(Invoke-LiveBuild -Slot $candidateSlot -Fingerprint $candidateFingerprint -PnpmCommand $pnpmCommand -PnpmPrefixArguments $pnpmPrefixArguments)
    } else {
      @($false)
    }
    $buildSucceeded = $buildOutcome.Count -eq 1 -and $buildOutcome[0] -is [bool] -and $buildOutcome[0]
    if (-not $buildSucceeded) { throw "更新包构建失败。" }
    $newServer = Start-LiveServer -Slot $candidateSlot -NodeCommand $NodeCommand -NextScript $script:nextScript
    $ServerProcess.Value = $newServer
    $ActiveSlot.Value = $candidateSlot
    $DeployedFingerprint.Value = $candidateFingerprint
    $LastAttemptedFingerprint.Value = $null
    [System.IO.File]::WriteAllText((Join-Path $installRoot "active-release.txt"), "$candidateRoot`r`n", [System.Text.Encoding]::ASCII)
    Remove-OldReleaseDirectories -KeepVersion $version
    Write-UpdateStatus @{ phase = "idle"; currentVersion = $version; downloadedVersion = $version; error = $null }
    Write-ManagerLog "Applied GitHub Release v$version."
  } catch {
    Write-ManagerLog "Release apply failed: $($_.Exception.Message)"
    $failedRoot = $script:workspace
    if ($previousRoot -and (Test-Path -LiteralPath $previousRoot)) {
      Set-ActiveReleaseRoot -Root $previousRoot
      $ActiveSlot.Value = $previousSlot
      $DeployedFingerprint.Value = $previousFingerprint
      try {
        $ServerProcess.Value = Start-LiveServer -Slot $previousSlot -NodeCommand $NodeCommand -NextScript $script:nextScript
      } catch {
        Write-ManagerLog "Unable to restore previous release: $($_.Exception.Message)"
      }
    }
    if ($failedRoot -and $failedRoot -ne $previousRoot) {
      Write-ManagerLog "Keeping failed release directory for diagnostics: $failedRoot"
    }
    Write-UpdateStatus @{ phase = "failed"; currentVersion = Get-ApplicationVersion; error = "应用更新失败：$($_.Exception.Message)" }
  } finally {
    Exit-DeploymentDrain
  }
}

function Invoke-UpdateCommand {
  param(
    [ref]$ActiveSlot,
    [ref]$ServerProcess,
    [ref]$DeployedFingerprint,
    [ref]$LastAttemptedFingerprint,
    [string]$NodeCommand
  )

  $command = Read-UpdateCommand
  if (-not $command) { return }
  switch ([string]$command.action) {
    "check" { Invoke-ReleaseCheck }
    "download" { Invoke-ReleaseDownload }
    "apply" { Invoke-ReleaseApply -ActiveSlot $ActiveSlot -ServerProcess $ServerProcess -DeployedFingerprint $DeployedFingerprint -LastAttemptedFingerprint $LastAttemptedFingerprint -NodeCommand $NodeCommand }
    "defer" {
      $version = [string]$command.version
      if ($version) { Write-UpdateStatus @{ phase = "idle"; deferredVersion = $version } }
    }
    default { Write-ManagerLog "Ignoring unknown update command $($command.action)." }
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

  $packageManager = Resolve-PnpmCommand -Optional
  $pnpmCommand = if ($packageManager) { $packageManager.Command } else { $null }
  $pnpmPrefixArguments = if ($packageManager) { @($packageManager.PrefixArguments) } else { @() }
  $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
  Set-ActiveReleaseRoot -Root $workspace
  $nextScript = $script:nextScript
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
    $initialBuildOutcome = if (Adopt-PrebuiltBuild -Slot $targetSlot -Fingerprint $deployedFingerprint) {
      @($true)
    } elseif ($pnpmCommand) {
      @(Invoke-LiveBuild -Slot $targetSlot -Fingerprint $deployedFingerprint -PnpmCommand $pnpmCommand -PnpmPrefixArguments $pnpmPrefixArguments)
    } else {
      Write-ManagerLog "No prebuilt Next.js output or pnpm was found; cannot build the active release."
      @($false)
    }
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

  Write-UpdateStatus @{
    phase = if ((Get-UpdateConfig).Enabled) { "idle" } else { "disabled" }
    currentVersion = Get-ApplicationVersion
    error = $null
  }
  Invoke-ReleaseCheck
  $nextUpdateCheckAt = (Get-Date).AddSeconds((Get-UpdateConfig).IntervalSeconds)

  $lastAttemptedFingerprint = $deployedFingerprint
  while ($true) {
    Start-Sleep -Seconds 2

    Invoke-UpdateCommand -ActiveSlot ([ref]$activeSlot) -ServerProcess ([ref]$serverProcess) -DeployedFingerprint ([ref]$deployedFingerprint) -LastAttemptedFingerprint ([ref]$lastAttemptedFingerprint) -NodeCommand $nodeCommand
    $nextScript = $script:nextScript
    if ((Get-Date) -ge $nextUpdateCheckAt) {
      Invoke-ReleaseCheck
      $nextUpdateCheckAt = (Get-Date).AddSeconds((Get-UpdateConfig).IntervalSeconds)
    }

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

    $buildOutcome = if (Adopt-PrebuiltBuild -Slot $targetSlot -Fingerprint $targetFingerprint) {
      @($true)
    } elseif ($pnpmCommand) {
      @(Invoke-LiveBuild -Slot $targetSlot -Fingerprint $targetFingerprint -PnpmCommand $pnpmCommand -PnpmPrefixArguments $pnpmPrefixArguments)
    } else {
      @($false)
    }
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
