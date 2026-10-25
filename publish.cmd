@echo off
chcp 65001 >nul
setlocal
title Unmanned System Lab - publish to GitHub
cd /d "%~dp0"

echo.
echo   UNMANNED SYSTEM LAB - publish to GitHub (Route B, with auto-retry)
echo   =================================================================
echo.
echo   Repo : https://github.com/2170745575/unmanned-system-lab  (empty)
echo   git  : portable MinGit (ready)
echo   Login: a browser window will open for GitHub sign-in
echo   Log  : publish-log.txt
echo.
echo   NOTE: this network sometimes times out connecting to github.com
echo         (21s per attempt). The script retries up to 10 times with
echo         different connection strategies, so just let it run.
echo.

set "DEFUSER=%GH_DEFAULT_USER%"
if "%DEFUSER%"=="" set "DEFUSER=2170745575"
set "DEFREPO=%GH_DEFAULT_REPO%"
if "%DEFREPO%"=="" set "DEFREPO=unmanned-system-lab"

set "GHUSER="
set /p GHUSER=GitHub username [%DEFUSER%]: 
if "%GHUSER%"=="" set "GHUSER=%DEFUSER%"
if "%GHUSER%"=="" (
  echo.
  echo   [x] Username is required. Aborted.
  echo.
  pause
  exit /b 1
)

set "REPO="
set /p REPO=Repo name [%DEFREPO%]: 
if "%REPO%"=="" set "REPO=%DEFREPO%"

echo.
echo   Pushing to https://github.com/%GHUSER%/%REPO%.git
echo   A browser window will open - finish the GitHub sign-in there.
echo   Progress is shown below; each attempt may take up to ~25s.
echo.

if exist "publish-log.txt" del "publish-log.txt" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0publish.ps1' -GitHubUser '%GHUSER%' -RepoName '%REPO%' 2>&1 | Tee-Object -FilePath 'publish-log.txt'"

echo.
echo   ------------------------------------------------------------
echo   Next step: enable GitHub Pages
echo     https://github.com/%GHUSER%/%REPO%/settings/pages
echo     Source: Deploy from a branch  -  Branch: main / (root)  -  Save
echo   Site: https://%GHUSER%.github.io/%REPO%/
echo   ------------------------------------------------------------
echo.
pause