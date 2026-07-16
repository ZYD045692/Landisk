@echo off
cd /d "%~dp0"

:: Kill port 3000 if occupied
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo ==========================================
echo   LanDisk - CLI Mode
echo   http://localhost:3000
echo ==========================================
echo.

node server.js
