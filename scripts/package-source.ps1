# Rebuilds sawaari-platform.zip from the tracked source tree.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package-source.ps1
#
# The archive is the source-only snapshot that is handed to anyone who wants
# to build the apps themselves. It contains exactly the files git tracks
# (no node_modules, no .env, no build output, no signing keys) and it is
# regenerated whenever the source changes.
param(
  [string]$OutFile = (Join-Path (Split-Path $PSScriptRoot -Parent) 'sawaari-platform.zip')
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Stage = Join-Path $env:TEMP ('sawaari-package-' + ([guid]::NewGuid()).ToString().Substring(0,6))

Write-Host "== staging the tracked files ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $Stage | Out-Null
$files = & git -C $Root ls-files --cached --others --exclude-standard | Where-Object { $_ -ne 'sawaari-platform.zip' }
foreach ($f in $files) {
  $src = Join-Path $Root $f
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dest = Join-Path $Stage $f
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dest -Force
}
Write-Host "  staged $($files.Count) files"

Write-Host "== compressing ==" -ForegroundColor Cyan
if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $OutFile -CompressionLevel Optimal -Force

$size = [math]::Round((Get-Item -LiteralPath $OutFile).Length / 1MB, 1)
Write-Host "  wrote $OutFile ($size MB)" -ForegroundColor Green
Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
