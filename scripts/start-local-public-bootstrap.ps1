$ErrorActionPreference = "Stop"

$installRoot = (Resolve-Path $PSScriptRoot).Path
$activePath = Join-Path $installRoot "active-release.txt"
$envPath = Join-Path $installRoot ".local-public.env"
$updateRoot = Join-Path $installRoot "updates"
$releaseRoot = Join-Path $installRoot "releases"

if (-not (Test-Path -LiteralPath $activePath)) {
  throw "No installed Super Canvas release was found. Run pnpm public:install first."
}
$active = (Get-Content -LiteralPath $activePath -Raw).Trim()
if (-not $active -or -not (Test-Path -LiteralPath $active)) {
  throw "The active Super Canvas release directory is missing: $active"
}
$manager = Join-Path $active "scripts\start-local-public-managed.ps1"
if (-not (Test-Path -LiteralPath $manager)) {
  throw "The active Super Canvas release is incomplete: $manager"
}

$env:SUPERCANVAS_ACTIVE_RELEASE_ROOT = $active
$env:SUPERCANVAS_RUNTIME_ENV_PATH = $envPath
$env:SUPERCANVAS_UPDATE_ROOT = $updateRoot
$env:SUPERCANVAS_RELEASE_ROOT = $releaseRoot

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager
