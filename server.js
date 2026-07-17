const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./utils/logger');

// ============ 加载配置 ============

// 安装目录可能只读（Program Files），用户数据存 %APPDATA%
const userDataDir = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'LanDisk'
);
const defaultConfigPath = path.join(__dirname, 'config.json');
const userConfigPath = path.join(userDataDir, 'config.json');

// 首次运行：复制默认配置到用户目录
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
if (!fs.existsSync(userConfigPath) && fs.existsSync(defaultConfigPath)) {
  fs.copyFileSync(defaultConfigPath, userConfigPath);
}

// 初始化日志（用户目录就绪后）
logger.init(userDataDir);

// 加载配置（优先用户目录，因为可写）
const configPath = fs.existsSync(userConfigPath) ? userConfigPath : defaultConfigPath;
logger.info(`[配置] 路径: ${configPath}`);
try {
  fs.accessSync(configPath, fs.constants.W_OK);
  logger.info(`[配置] 可写: 是`);
} catch {
  logger.info(`[配置] 可写: 否`);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 规范化根目录路径
config.roots = (config.roots || []).map(r => path.resolve(r));

// 验证根目录存在（无效的过滤掉，不阻止启动）
config.roots = (config.roots || []).filter(r => {
  if (!fs.existsSync(r)) {
    logger.warn(`[配置] 根目录不存在，已跳过: ${r}`);
    return false;
  }
  return true;
});

// 默认值
config.port = config.port || 22580;
config.maxFileSizeMB = config.maxFileSizeMB || 500;
config.showHiddenFiles = config.showHiddenFiles || false;

// ============ 创建 Express 应用 ============
const app = express();

// 解析 JSON 请求体
app.use(express.json({ limit: '1mb' }));

// CORS — 允许 Tauri 自定义协议跨域访问 API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============ 注册 API 路由 ============
const { createFilesRouter } = require('./routes/files');
const { createUploadRouter } = require('./routes/upload');
const { createDownloadRouter } = require('./routes/download');
const { createDeleteRouter } = require('./routes/delete');

app.use('/api/files', createFilesRouter(config));
app.use('/api/upload', createUploadRouter(config));
app.use('/api/download', createDownloadRouter(config));
app.use('/api/delete', createDeleteRouter(config));

const { createLogsRouter } = require('./routes/logs');
app.use('/api/logs', createLogsRouter(logger));

// ============ 服务信息（二维码用） ============

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  // 跳过虚拟网卡（VMware、代理 TUN 等），优先返回真实 LAN 口
  const skipNames = ['vmware', 'virtualbox', 'virtual', 'meta', 'tun', 'tap', 'docker', 'hyper-v'];
  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    if (skipNames.some(s => lower.includes(s))) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

app.get('/api/server-info', (req, res) => {
  const ip = getLocalIP();
  res.json({ ip, port: config.port, url: `http://${ip}:${config.port}` });
});

// ============ 根目录管理 ============

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info('[配置] 已保存');
  } catch (err) {
    logger.error('[配置] 保存失败:', err.message);
    throw err;
  }
}

// 获取根目录列表
app.get('/api/roots', (req, res) => {
  res.json({
    roots: config.roots.map(r => ({
      name: path.basename(r),
      path: r
    }))
  });
});

// 添加根目录
app.post('/api/roots', (req, res) => {
  const { path: inputPath } = req.body || {};
  if (!inputPath || typeof inputPath !== 'string') {
    return res.status(400).json({ error: '请提供目录路径' });
  }

  const absPath = path.resolve(inputPath.trim());

  // 校验存在性
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return res.status(400).json({ error: '目录不存在或无权限访问' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: '路径不是目录' });
  }

  // 去重
  if (config.roots.some(r => r === absPath)) {
    return res.status(400).json({ error: '该目录已在共享列表中' });
  }

  // 防嵌套：新目录不能在已有根目录下
  for (const r of config.roots) {
    if (absPath.startsWith(r + path.sep) || absPath === r) {
      return res.status(400).json({ error: `该目录已在 "${path.basename(r)}" 的共享范围内` });
    }
  }

  config.roots.push(absPath);
  try { saveConfig(); } catch (err) {
    return res.status(500).json({ error: '保存配置失败: ' + err.message });
  }

  res.json({
    roots: config.roots.map(r => ({
      name: path.basename(r),
      path: r
    }))
  });
});

// 删除根目录
app.delete('/api/roots', (req, res) => {
  const { path: targetPath } = req.body || {};
  if (!targetPath) {
    return res.status(400).json({ error: '请提供要删除的目录路径' });
  }

  const idx = config.roots.indexOf(targetPath);
  if (idx === -1) {
    return res.status(404).json({ error: '该目录不在共享列表中' });
  }

  config.roots.splice(idx, 1);
  try { saveConfig(); } catch (err) {
    return res.status(500).json({ error: '保存配置失败: ' + err.message });
  }

  res.json({
    roots: config.roots.map(r => ({
      name: path.basename(r),
      path: r
    }))
  });
});

// ============ 静态文件 ============

// 搜索 client/dist（适配不同打包路径）
function findClientDist() {
  const candidates = [
    path.join(__dirname, 'client', 'dist'),
    path.join(__dirname, '..', 'client', 'dist'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const clientDist = findClientDist();
if (clientDist) {
  logger.info(`[静态] 前端目录: ${clientDist}`);
  // 禁止缓存 HTML/JS/CSS（浏览器经常缓存旧版导致看不到更新）
  app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
  });
  app.use(express.static(clientDist));
} else {
  logger.warn('[静态] 未找到前端目录，仅提供 API 服务');
}

// SPA fallback（仅开发模式有 client/dist 时才生效）
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('LanDisk API is running.');
  }
});

// ============ 全局错误处理 ============
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ 启动服务 ============

function startServer(portOverride) {
  const port = portOverride || config.port;
  app.listen(port, '0.0.0.0', () => {
    const localIP = getLocalIP();
    const url = `http://${localIP}:${port}`;

    process.stdout.write('\n');
    process.stdout.write('══════════════════════════════════════════\n');
    process.stdout.write('  📁  LanDisk 服务已启动\n');
    process.stdout.write('══════════════════════════════════════════\n');
    logger.info(`  🌐 本机访问: http://localhost:${port}`);
    logger.info(`  📱 内网访问: ${url}`);
    logger.info(`  📂 共享目录: ${config.roots.join(', ')}`);
    process.stdout.write('══════════════════════════════════════════\n');
    process.stdout.write('\n');

    // 生成二维码
    try {
      const qrcode = require('qrcode');
      // 终端 ANSI 二维码（process.stdout 绕过 logger）
      qrcode.toString(url, { type: 'terminal', small: true }, (err, qr) => {
        if (!err) process.stdout.write(qr + '\n');
      });
      // 干净 UTF-8 文本二维码 → 日志环形缓冲区
      qrcode.toString(url, { type: 'utf8' }, (err, qr) => {
        if (!err) logger.info(`📱 手机扫码访问:\n${qr}`);
      });
    } catch {
      logger.info(`📱 手机浏览器打开: ${url}`);
    }
});
}

if (require.main === module) {
  startServer();
} else {
  module.exports = { app, config, logger, startServer };
}
