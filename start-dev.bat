@echo off
cd /d "%~dp0"
REM Dev data dir: shell & sidecar both read dev-data/config.json (port 22581, separated from packaged 22580).
REM Use absolute path (%~dp0 = repo root). tauri dev shell cwd is src-tauri/, so a relative dev-data would be missed.
set LANDISK_DATA_DIR=%~dp0dev-data
echo [1/3] Cleaning old processes and binaries...
taskkill /f /im landisk-server.exe >nul 2>&1
taskkill /f /im landisk-server-x86_64-pc-windows-msvc.exe >nul 2>&1
taskkill /f /im landisk.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Pre-seed sidecar into binaries (fallback: if beforeDevCommand copy occasionally fails, shell build still finds it).
if exist "src-tauri\server\target\debug\landisk-server.exe" (
  if not exist "src-tauri\binaries" mkdir "src-tauri\binaries"
  copy /Y "src-tauri\server\target\debug\landisk-server.exe" "src-tauri\binaries\landisk-server-x86_64-pc-windows-msvc.exe" >nul
)

echo [2/3] Starting Vite dev server (HMR, http://localhost:5173)...
start "LanDisk Vite" cmd /k "cd /d %~dp0client && npm run dev -- --host"
timeout /t 3 /nobreak >nul

echo [3/3] Starting Tauri (beforeDevCommand rebuilds backend, loads Vite at 5173)...
start "LanDisk Tauri" cmd /k "cd /d %~dp0 && npm start"

echo Done!
echo   Tauri window: desktop app (frontend from Vite HMR @5173, backend rebuilt by beforeDevCommand)
echo   Vite: http://localhost:5173 (LAN: http://192.168.1.12:5173)
