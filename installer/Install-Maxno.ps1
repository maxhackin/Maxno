#Requires -Version 5.1
<#
.SYNOPSIS
  Downloads and installs Maxno to %LOCALAPPDATA%\Maxno and creates a Desktop shortcut.
#>
$ErrorActionPreference = "Stop"

$Owner = "maxhackin"
$Repo = "Maxno"
$InstallDir = Join-Path $env:LOCALAPPDATA "Maxno"
$Desktop = [Environment]::GetFolderPath("Desktop")
$TempZip = Join-Path $env:TEMP ("Maxno-portable-" + [guid]::NewGuid().ToString("n") + ".zip")
$TempExtract = Join-Path $env:TEMP ("Maxno-extract-" + [guid]::NewGuid().ToString("n"))

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

try {
  Write-Host "Maxno Installer" -ForegroundColor White
  Write-Host "Installs to: $InstallDir"

  Write-Step "Finding latest release asset..."
  $releaseApi = "https://api.github.com/repos/$Owner/$Repo/releases/latest"
  $release = Invoke-RestMethod -Uri $releaseApi -Headers @{ "User-Agent" = "Maxno-Installer" }
  $asset = $release.assets | Where-Object { $_.name -match "Maxno-portable.*\.zip$" } | Select-Object -First 1
  if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
  }
  if (-not $asset) {
    throw "No zip asset found on the latest GitHub release. Tag=$($release.tag_name)"
  }

  Write-Host "Release: $($release.tag_name)"
  Write-Host "Asset:   $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)"

  Write-Step "Downloading..."
  # Prefer browser_download_url; GitHub may redirect
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $TempZip -UseBasicParsing

  Write-Step "Extracting..."
  if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $TempExtract | Out-Null
  Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force

  # Support zip root being Maxno\ or files directly
  $payload = $TempExtract
  $inner = Get-ChildItem $TempExtract -Directory | Select-Object -First 1
  if ($inner -and (Test-Path (Join-Path $inner.FullName "Maxno.exe"))) {
    $payload = $inner.FullName
  } elseif (-not (Test-Path (Join-Path $TempExtract "Maxno.exe"))) {
    $exe = Get-ChildItem $TempExtract -Recurse -Filter "Maxno.exe" | Select-Object -First 1
    if ($exe) { $payload = $exe.Directory.FullName }
    else { throw "Maxno.exe not found inside the zip." }
  }

  Write-Step "Installing to $InstallDir ..."
  if (Test-Path $InstallDir) {
    # Stop running copies first
    Get-Process -Name "Maxno","maxno-v1.3.60" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path (Join-Path $payload "*") -Destination $InstallDir -Recurse -Force

  if (-not (Test-Path (Join-Path $InstallDir "Maxno.exe"))) {
    throw "Install finished but Maxno.exe is missing."
  }

  Write-Step "Creating Desktop shortcut..."
  $shortcutPath = Join-Path $Desktop "Maxno.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($shortcutPath)
  $sc.TargetPath = Join-Path $InstallDir "Maxno.exe"
  $sc.WorkingDirectory = $InstallDir
  $ico = Join-Path $InstallDir "bob.ico"
  if (-not (Test-Path $ico)) { $ico = Join-Path $InstallDir "resources\public\Xeno.ico" }
  if (Test-Path $ico) { $sc.IconLocation = "$ico,0" }
  $sc.Description = "Maxno"
  $sc.Save()

  # Seed attach notice into Xeno autoexec if present / create dirs
  try {
    $ae = Join-Path $env:LOCALAPPDATA "Xeno\autoexec"
    New-Item -ItemType Directory -Force -Path $ae | Out-Null
    $noticeSrc = Join-Path $InstallDir "maxno_attached_notice.lua"
    if (Test-Path $noticeSrc) {
      Copy-Item $noticeSrc (Join-Path $ae "maxno_attached_notice.lua") -Force
    }
  } catch {}

  Write-Host ""
  Write-Host "Installed successfully." -ForegroundColor Green
  Write-Host "Shortcut: $shortcutPath"
  Write-Host "Folder:   $InstallDir"
  Write-Host ""
  $launch = Read-Host "Launch Maxno now? (Y/n)"
  if ($launch -eq "" -or $launch -match "^[Yy]") {
    Start-Process (Join-Path $InstallDir "Maxno.exe") -WorkingDirectory $InstallDir
  }
}
catch {
  Write-Host ""
  Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "You can also download Maxno-portable.zip from:" -ForegroundColor Yellow
  Write-Host "https://github.com/$Owner/$Repo/releases/latest"
  exit 1
}
finally {
  Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
  Remove-Item $TempExtract -Recurse -Force -ErrorAction SilentlyContinue
}
