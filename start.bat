@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Interview Trainer] Node.js 20 or newer is required.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)
node server.mjs --open
pause
