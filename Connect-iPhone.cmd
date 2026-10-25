@echo off
setlocal
cd /d "%~dp0"
node scripts\connect-iphone.mjs
pause
