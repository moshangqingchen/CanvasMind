$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$webRoot = Join-Path $workspace "apps\web"
$envPath = Join-Path $workspace ".local-public.env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "缺少 $envPath，请先运行 scripts/prepare-local-public.mjs"
}

foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
  $parts = $trimmed.Split("=", 2)
  if ($parts.Count -ne 2) { continue }
  [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
}

$env:PORT = "3210"
$nextCommand = Join-Path $webRoot "node_modules\.bin\next.cmd"
if (-not (Test-Path -LiteralPath $nextCommand)) {
  throw "缺少 Next.js 启动程序：$nextCommand"
}

Set-Location -LiteralPath $webRoot
& $nextCommand start -p 3210
exit $LASTEXITCODE
