@echo off
cd /d "%~dp0"
REM 开发模式数据目录：壳与 sidecar 都读 dev-data/config.json（port=22581，与打包版 22580 分开）
REM 用绝对路径（%~dp0 展开为仓库根）——tauri dev 的壳 current_dir 是 src-tauri/，相对 dev-data 读不到
set LANDISK_DATA_DIR=%~dp0dev-data
echo [1/3] Cleaning old processes and binaries...
taskkill /f /im landisk-server.exe >nul 2>&1
taskkill /f /im landisk-server-x86_64-pc-windows-msvc.exe >nul 2>&1
taskkill /f /im landisk.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM 预置 sidecar 到 binaries（兜底：beforeDevCommand 的 copy 偶发失败时，壳 build 仍能找到）
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
