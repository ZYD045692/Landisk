@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo   LanDisk - Tauri Dev Mode
echo ==========================================
echo.

:: 1. Kill old processes
call :killport 3000
call :killport 5173

:: 2. Start Express (background, no extra window)
echo [INFO] Starting Express API server...
start /B node server.js

:: 3. Wait for API
set /a count=0
:wait_api
timeout /t 1 /nobreak >nul
set /a count+=1
netstat -ano 2>nul | findstr ":3000.*LISTENING" >nul
if errorlevel 1 (
    if !count! lss 30 (goto wait_api) else (
        echo [ERROR] API timed out
        goto cleanup
    )
)
echo [OK] API ready ^(!count!s^)

:: 4. Start Vite (background, no extra window)
echo [INFO] Starting Vite dev server ^(:5173, HMR^)...
start /B npm --prefix client run dev

:: 5. Wait for Vite
set /a count=0
:wait_vite
timeout /t 1 /nobreak >nul
set /a count+=1
netstat -ano 2>nul | findstr ":5173.*LISTENING" >nul
if errorlevel 1 (
    if !count! lss 30 (goto wait_vite) else (
        echo [ERROR] Vite timed out
        goto cleanup
    )
)
echo [OK] Vite ready ^(!count!s^)

:: 6. Launch Tauri
echo.
echo [INFO] Launching Tauri...
echo.
npx tauri dev

:: 7. Cleanup
:cleanup
echo.
echo [INFO] Shutting down...
taskkill /F /IM node.exe >nul 2>&1
echo [OK] Done.
goto :eof

:killport
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%~1.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
goto :eof
