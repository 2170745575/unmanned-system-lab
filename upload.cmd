@echo off
chcp 65001 >nul
setlocal
title Unmanned System Lab - upload to GitHub
cd /d "%~dp0"

echo.
echo   UNMANNED SYSTEM LAB - upload to GitHub
echo   =====================================
echo.
echo   This needs a GitHub token:
echo     Fine-grained token with
echo       - Contents: Read and write
echo       - Administration: Read and write   (only to create the repo and enable Pages)
echo   Create one at:
echo     https://github.com/settings/personal-access-tokens/new
echo.

set "GH_TOKEN="
set /p GH_TOKEN=Paste token: 
if "%GH_TOKEN%"=="" (
  echo.
  echo   [x] No token entered. Aborted.
  echo.
  pause
  exit /b 1
)

set "REPO="
set /p REPO=Repo name [unmanned-system-lab]: 
if "%REPO%"=="" set "REPO=unmanned-system-lab"

echo.
echo   Uploading to repository: %REPO%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload-to-github.ps1" -RepoName "%REPO%"

echo.
echo   Done. Reminder: revoke the token you just used:
echo     https://github.com/settings/tokens
echo.
pause