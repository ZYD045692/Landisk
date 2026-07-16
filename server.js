const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ============ 加载配置 ============
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ config.json 未找到，请创建配置文件');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// 规范化根目录路径
config.roots = (config.roots || []).map(r => path.resolve(r));

// 验证根目录存在（无效的过滤掉，不阻止启动）
config.roots = (config.roots || []).filter(r => {
  if (!fs.existsSync(r)) {
    console.warn(`⚠️  根目录不存在，已跳过: ${r}`);
    return false;
  }
  return true;
});

// 默认值
config.port = config.port || 3000;
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

// ============ 服务信息（二维码用） ============

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
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
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
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
  saveConfig();

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
  saveConfig();

  res.json({
    roots: config.roots.map(r => ({
      name: path.basename(r),
      path: r
    }))
  });
});

// ============ 静态文件 ============
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  const indexPath = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head><meta charset="UTF-8"><title>LanDisk</title></head>
      <body style="font-family:sans-serif;text-align:center;padding-top:100px;">
        <h1>📁 LanDisk 服务已启动</h1>
        <p>前端尚未构建。请运行 <code>cd client && npm run build</code></p>
        <hr>
        <p>API: <a href="/api/files?path=/">/api/files?path=/</a></p>
      </body>
      </html>
    `);
  }
});

// ============ 全局错误处理 ============
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ 启动服务 ============
const port = config.port;

app.listen(port, '0.0.0.0', () => {
  const localIP = getLocalIP();
  const url = `http://${localIP}:${port}`;

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  📁  LanDisk 服务已启动');
  console.log('══════════════════════════════════════════');
  console.log(`  🌐 本机访问: http://localhost:${port}`);
  console.log(`  📱 内网访问: ${url}`);
  console.log(`  📂 共享目录: ${config.roots.join(', ')}`);
  console.log('══════════════════════════════════════════');
  console.log('');

  // 生成终端二维码
  try {
    const qrcode = require('qrcode');
    qrcode.toString(url, { type: 'terminal', small: true }, (err, qr) => {
      if (!err) {
        console.log(qr);
        console.log(`📱 手机扫码访问: ${url}`);
      }
    });
  } catch {
    console.log(`📱 手机浏览器打开: ${url}`);
  }
});
