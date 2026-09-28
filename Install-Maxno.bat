@echo off
title Maxno Installer
cd /d "%~dp0"
echo.
echo  Maxno Installer
echo  ---------------
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-Maxno.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
echo.
pause
