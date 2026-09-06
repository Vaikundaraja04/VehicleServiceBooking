@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install Node.js 24, then run this file again.
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) === 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install Node.js 24, then run this file again.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js 24, then run this file again.
  exit /b 1
)

npm start
set "START_EXIT_CODE=%errorlevel%"
if not "%START_EXIT_CODE%"=="0" (
  echo.
  echo The local demo did not start. Press any key to close this window.
  pause >nul
)
exit /b %START_EXIT_CODE%
