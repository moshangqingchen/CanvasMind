$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installRoot = Join-Path $env:LOCALAPPDATA "SuperCanvas"
$releaseRoot = Join-Path $installRoot "releases"
$updateRoot = Join-Path $installRoot "updates"
$envPath = Join-Path $installRoot ".local-public.env"
$bootstrap = Join-Path $installRoot "start-local-public.ps1"
$repository = if ($env:SUPERCANVAS_UPDATE_REPOSITORY) { $env:SUPERCANVAS_UPDATE_REPOSITORY.Trim() } else { "moshangqingchen/CanvasMind" }

if ($repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Invalid GitHub repository: $repository" }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null

$headers = @{
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "SuperCanvas-Installer"
}
if ($env:SUPERCANVAS_GITHUB_TOKEN) { $headers.Authorization = "Bearer $($env:SUPERCANVAS_GITHUB_TOKEN.Trim())" }

$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases?per_page=30" -Headers $headers -TimeoutSec 30
$candidate = $null
foreach ($release in $releases) {
  if ($release.draft -or $release.prerelease) { continue }
  if ([string]$release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
  $version = $Matches[1]
  $zipName = "super-canvas-v$version-windows-x64.zip"
  $sidecarName = "super-canvas-v$version-release-manifest.json"
  $zip = @($release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1)
  $sidecar = @($release.assets | Where-Object { $_.name -eq $sidecarName } | Select-Object -First 1)
  if (-not $zip -or -not $sidecar) { continue }
  $candidate = [pscustomobject]@{ Version = $version; Tag = [string]$release.tag_name; Zip = $zip; Sidecar = $sidecar }
  break
}
if (-not $candidate) { throw "No published Windows Release package was found in $repository." }

$downloadDirectory = Join-Path $updateRoot "downloads"
New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
$archivePath = Join-Path $downloadDirectory $candidate.Zip.name
$sidecarPath = Join-Path $downloadDirectory $candidate.Sidecar.name
Invoke-WebRequest -Uri $candidate.Zip.browser_download_url -Headers $headers -OutFile $archivePath -UseBasicParsing -TimeoutSec 600
Invoke-WebRequest -Uri $candidate.Sidecar.browser_download_url -Headers $headers -OutFile $sidecarPath -UseBasicParsing -TimeoutSec 60
$manifest = Get-Content -LiteralPath $sidecarPath -Raw -Encoding utf8 | ConvertFrom-Json
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if (
  [int]$manifest.formatVersion -ne 1 -or
  [string]$manifest.app -ne "super-canvas" -or
  [string]$manifest.version -ne $candidate.Version -or
  [string]$manifest.tag -ne $candidate.Tag -or
  [string]$manifest.assetName -ne [string]$candidate.Zip.name -or
  [string]$manifest.assetSha256.ToLowerInvariant() -ne $hash
) {
  throw "Downloaded Release package failed verification."
}

$candidateRoot = Join-Path $releaseRoot "v$($candidate.Version)"
if (Test-Path -LiteralPath $candidateRoot) { Remove-Item -LiteralPath $candidateRoot -Recurse -Force }
New-Item -ItemType Directory -Path $candidateRoot -Force | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $candidateRoot -Force
if (-not (Test-Path -LiteralPath (Join-Path $candidateRoot "apps\web\package.json"))) { throw "Downloaded Release package is incomplete." }

if (-not (Test-Path -LiteralPath $envPath)) {
  $masterBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($masterBytes)
  $masterKey = [Convert]::ToBase64String($masterBytes)
  $dataPath = Join-Path $installRoot "data\super-canvas.json"
  $storagePath = Join-Path $installRoot "storage"
  @(
    "MASTER_KEY=base64:$masterKey"
    "USE_MEMORY_STORE=true"
    "LOCAL_DATABASE_PATH=$dataPath"
    "LOCAL_STORAGE_PATH=$storagePath"
    "RUN_IN_PROCESS=true"
    "NEXT_PUBLIC_LOCAL_DOWNLOAD_ORIGIN=http://127.0.0.1:3210"
    "NEXT_PUBLIC_APP_NAME=超级画布"
    "SUPERCANVAS_UPDATE_ENABLED=true"
    "SUPERCANVAS_UPDATE_REPOSITORY=$repository"
    "SUPERCANVAS_UPDATE_INTERVAL_SECONDS=600"
  ) | Set-Content -LiteralPath $envPath -Encoding utf8
}
Copy-Item -LiteralPath (Join-Path $workspace "scripts\start-local-public-bootstrap.ps1") -Destination $bootstrap -Force
[System.IO.File]::WriteAllText((Join-Path $installRoot "active-release.txt"), "$candidateRoot`r`n", [System.Text.Encoding]::ASCII)
Write-Output "Installed Super Canvas $($candidate.Tag) to $candidateRoot"
Write-Output "Start it with: $bootstrap"
