@echo off
setlocal
cd /d "%~dp0"
node node_modules\tsx\dist\cli.mjs companion\main.ts
if errorlevel 1 pause
