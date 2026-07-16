@echo off
cd /d "%~dp0"

:: Kill port 22580 if occupied
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":22580.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo ==========================================
echo   LanDisk - CLI Mode
echo   http://localhost:22580
echo ==========================================
echo.

node server.js
