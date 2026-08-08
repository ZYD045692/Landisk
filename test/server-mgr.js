/**
 * 测试用后端服务管理：自动「杀旧 → 起新 → 等待就绪 → 停止」
 * 每个测试脚本开始时先调 startServer()，结束时在 finally 里调 stopServer()。
 *
 * 注意：startServer 会先清掉端口 22580 上的旧进程再启动，保证测到的是最新后端。
 */
const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 22580;
const ROOT = path.resolve(__dirname, '..');
const HEALTH_URL = `http://localhost:${PORT}/api/roots`;

const CONFIG_PATH = path.join(ROOT, 'dev-data', 'config.json');
const CONFIG_BACKUP = path.join(ROOT, 'dev-data', 'config.test-backup.json');

/** 备份测试前 dev-data/config.json（保护用户手动添加的真实共享目录，测试后恢复） */
function backupConfig() {
  if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, CONFIG_BACKUP);
}

/** 清空共享根，保证「无共享目录」等用例从确定性状态（roots=[]）开始 */
function clearConfigRoots() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    cfg.roots = [];
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {}
}

/** 测试结束后恢复备份的 config（还原用户共享目录） */
function restoreConfig() {
  if (fs.existsSync(CONFIG_BACKUP)) {
    fs.copyFileSync(CONFIG_BACKUP, CONFIG_PATH);
    fs.unlinkSync(CONFIG_BACKUP);
  }
}

function killByPort(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
  } catch {}
}

function killByName() {
  try { execSync('taskkill /F /IM landisk-server.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM landisk-server-x86_64-pc-windows-msvc.exe /T 2>nul', { stdio: 'ignore' }); } catch {}
}

/** 关闭后端：杀掉端口监听 + landisk-server 相关进程 */
async function stopServer() {
  killByPort(PORT);
  killByName();
}

/** 探测后端是否就绪（/api/roots 返回 200） */
function isUp() {
  return new Promise(resolve => {
    const req = http.get(HEALTH_URL, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/**
 * 启动后端（自动）：先杀旧 → npm run server（LANDISK_DATA_DIR=dev-data）→ 等待就绪
 * @param {number} timeoutMs 超时（首次编译可能较慢，默认 240s）
 * @returns {Promise<boolean>} 是否就绪
 */
async function startServer(timeoutMs = 240000) {
  console.log('  🔄 测试前检查后端进程（有旧则关闭）...');
  await stopServer();
  // 先构建前端，保证测试加载的是最新 client/dist（npm run server 直接读静态文件，不会自己构建）
  console.log('  🏗️  构建前端（npm --prefix client run build）...');
  try {
    execSync('npm --prefix client run build', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('  ❌ 前端构建失败，终止测试');
    return false;
  }
  console.log('  🚀 自动启动后端服务（npm run server）...');
  const child = spawn('npm run server', {
    cwd: ROOT,
    env: { ...process.env, LANDISK_DATA_DIR: 'dev-data' },
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) {
      console.log('  ✅ 后端已就绪 (localhost:' + PORT + ')\n');
      return true;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.error('  ❌ 后端启动超时');
  await stopServer();
  return false;
}

module.exports = { startServer, stopServer, isUp, PORT, backupConfig, clearConfigRoots, restoreConfig };
