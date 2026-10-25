@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run companion:check
if errorlevel 1 goto failed
echo Setup complete. Read docs\windows-companion.md, then run Start-Vegetate.cmd.
pause
exit /b 0
:failed
echo Setup did not complete. Keep the error above so it can be investigated.
pause
exit /b 1
