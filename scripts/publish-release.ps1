#Requires -Version 5.1
# Creates GitHub release v1.0.0 and uploads Maxno-portable zip.
# Prerequisite: gh auth login

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Zip = Join-Path $Root "dist\Maxno-portable-v1.0.0.zip"
$Tag = "v1.0.0"

if (-not (Test-Path $Zip)) { throw "Missing $Zip — build the portable zip first." }

gh auth status
gh release create $Tag $Zip `
  --repo maxhackin/Maxno `
  --title "Maxno $Tag" `
  --notes @"
## Maxno $Tag

Custom black/white UI for Xeno.

### Easy install
1. Download **Install-Maxno.bat** (or run the PowerShell one-liner from the README)
2. Or download **Maxno-portable-v1.0.0.zip**, extract, run ``Maxno.exe``

### Includes
- Import / Attach / Execute
- Custom icon + attach notice
"@

Write-Host "Done: https://github.com/maxhackin/Maxno/releases/tag/$Tag" -ForegroundColor Green
