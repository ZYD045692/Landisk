@echo off
cd /d "%~dp0"

echo.
echo ==========================================
echo   LanDisk - Dev Mode (Vite HMR)
echo   http://localhost:5173
echo ==========================================
echo.

start "NAS-Server" node server.js

cd client
npx vite --host
