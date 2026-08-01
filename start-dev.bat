@echo off
cd /d "%~dp0"
echo [0/4] Cleaning old processes and binaries...
taskkill /f /im landisk-server.exe >nul 2>&1
taskkill /f /im landisk-server-x86_64-pc-windows-msvc.exe >nul 2>&1
taskkill /f /im landisk.exe >nul 2>&1

echo [1/4] Building Rust backend...
if exist "src-tauri\server\target\debug\landisk-server.exe" del /F "src-tauri\server\target\debug\landisk-server.exe" >nul 2>&1
call cargo build --manifest-path src-tauri/server/Cargo.toml
if errorlevel 1 exit /b 1
if not exist "src-tauri\binaries" mkdir "src-tauri\binaries" >nul 2>&1
copy /Y "src-tauri\server\target\debug\landisk-server.exe" "src-tauri\binaries\landisk-server-x86_64-pc-windows-msvc.exe" >nul 2>&1

echo [2/4] Building frontend...
cd /d "%~dp0client"
call npm run build
cd /d "%~dp0"

echo [3/4] Starting Tauri + Vite...
start "LanDisk Tauri" cmd /k "cd /d %~dp0 && npm start"
start "LanDisk Vite" cmd /k "cd /d %~dp0client && npm run dev -- --host"

echo [4/4] Done!
echo   Tauri window: desktop app
echo   Vite: http://localhost:5173 (LAN: http://192.168.1.12:5173)
