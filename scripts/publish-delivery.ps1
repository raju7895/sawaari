# Copies the built installers into the delivery folder and prints the
# download URLs the phone can use.
#
#   powershell -ExecutionPolicy Bypass -File scripts\publish-delivery.ps1
#
param(
  [string]$Target = (Join-Path $env:USERPROFILE 'Downloads\Local Auto Booking App')
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path -LiteralPath $Target)) {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

$items = @(
  @{ From = 'dist-android\LocalAutoBooking.apk';        To = 'LocalAutoBooking.apk' },
  @{ From = 'dist-windows\LocalAutoBooking-Setup.exe';  To = 'LocalAutoBooking-Setup.exe' },
  @{ From = 'dist-windows\LocalAutoBooking-Portable.exe'; To = 'LocalAutoBooking-Portable.exe' },
  @{ From = 'BUILD-AND-INSTALL.md';                     To = 'BUILD-AND-INSTALL.md' },
  @{ From = 'INSTALL-GUIDE.md';                         To = 'INSTALL-GUIDE.md' },
  @{ From = 'push-to-github.bat';                       To = 'push-to-github.bat' },
  @{ From = 'sawaari-platform.zip';                     To = 'sawaari-platform.zip' }
)

foreach ($i in $items) {
  $src = Join-Path $Root $i.From
  if (-not (Test-Path -LiteralPath $src)) { Write-Host "  ! missing $($i.From)" -ForegroundColor Yellow; continue }
  Copy-Item -LiteralPath $src -Destination (Join-Path $Target $i.To) -Force
  $size = [math]::Round((Get-Item -LiteralPath $src).Length / 1MB, 1)
  Write-Host ("  ✔ {0,-32} {1} MB" -f $i.To, $size)
}

Write-Host "`n  Downloads (the phone must be on the same Wi-Fi):" -ForegroundColor Cyan
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet'
  } |
  Select-Object -ExpandProperty IPAddress
foreach ($ip in $ips) {
  Write-Host "    http://${ip}:8000/" -ForegroundColor Green
  Write-Host "    http://${ip}:8000/LocalAutoBooking.apk" -ForegroundColor Green
}
Write-Host "`n  Folder: $Target`n"
