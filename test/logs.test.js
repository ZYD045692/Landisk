const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

// ============ 测试环境 ============

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'landisk-test-'));
const TEST_FILE = path.join(TEST_DIR, 'test-log-file.txt');
const PORT = 22581;
const BASE = `http://localhost:${PORT}`;
let server = null;

function request(method, urlPath, body, contentType) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method,
      headers: {}
    };
    if (body) {
      if (contentType === 'multipart') {
        // 直接用 form-data 边界
        const boundary = '----TestBoundary' + Date.now();
        const CRLF = '\r\n';
        let payload = '';
        for (const [key, val] of Object.entries(body)) {
          payload += `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}${val}${CRLF}`;
        }
        // 支持文件
        if (body._files) {
          for (const f of body._files) {
            const content = fs.readFileSync(f.path);
            payload += `--${boundary}${CRLF}` +
              `Content-Disposition: form-data; name="${f.field}"; filename="${f.name}"${CRLF}` +
              `Content-Type: application/octet-stream${CRLF}${CRLF}` +
              content.toString('binary') + CRLF;
          }
        }
        payload += `--${boundary}--${CRLF}`;
        opts.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
        opts.headers['Content-Length'] = Buffer.byteLength(payload);
        body = payload;
      } else {
        body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(body);
      }
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============ 测试用例 ============

describe('日志系统测试', () => {

  before(async () => {
    // 创建测试文件
    fs.writeFileSync(TEST_FILE, 'Hello, this is a test log file.', 'utf-8');

    // 设置环境变量，让服务器使用测试配置目录
    process.env.LANDISK_DATA_DIR = TEST_DIR;

    // 服务器读取 LANDISK_DATA_DIR/config.json，提前创建好
    const testConfig = {
      roots: [TEST_DIR],
      port: PORT,
      maxFileSizeMB: 10,
      showHiddenFiles: false
    };
    fs.writeFileSync(path.join(TEST_DIR, 'config.json'), JSON.stringify(testConfig, null, 2), 'utf-8');
    // 清理可能残留的日志目录
    const logsDir = path.join(TEST_DIR, 'logs');
    if (fs.existsSync(logsDir)) {
      fs.rmSync(logsDir, { recursive: true, force: true });
    }

    // 导入并启动 server
    const srv = require('../server');
    server = srv.startServer(PORT);

    // 等待服务就绪
    for (let i = 0; i < 30; i++) {
      try {
        const r = await request('GET', '/api/server-info');
        if (r.status === 200) return;
      } catch {}
      await sleep(500);
    }
    throw new Error('服务器启动超时');
  });

  after(() => {
    // 关闭 server
    if (server) {
      server.close();
    }
    // 清理临时目录
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  it('日志 API 返回启动日志', async () => {
    const r = await request('GET', '/api/logs?lines=50');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data), '返回数组');
    assert.ok(r.data.length > 0, '有日志条目');
    assert.ok(r.data[0].timestamp, '有时间戳');
    assert.ok(r.data[0].level, '有级别');
    assert.ok(r.data[0].message, '有消息');
    // 应有启动日志
    const hasStartup = r.data.some(e => e.message.includes('LanDisk 服务'));
    assert.ok(hasStartup, '包含启动日志');
  });

  it('上传后日志包含上传记录', async () => {
    // 上传文件
    const filePath = path.join(TEST_DIR, 'upload-test.txt');
    fs.writeFileSync(filePath, 'upload test content', 'utf-8');

    const r = await request('POST', '/api/upload', {
      targetPath: '/',
      _files: [{ field: 'files', path: filePath, name: 'upload-test.txt' }]
    }, 'multipart');
    assert.strictEqual(r.status, 200, `上传返回 ${r.status}: ${JSON.stringify(r.data)}`);

    // 等日志写入
    await sleep(300);

    // 检查日志
    const log = await request('GET', '/api/logs?lines=50');
    assert.strictEqual(log.status, 200);
    const found = log.data.some(e => e.message.includes('上传完成') && e.message.includes('upload-test'));
    assert.ok(found, `日志应包含上传记录，实际日志: ${log.data.map(e => e.message).slice(-3).join(' | ')}`);

    // 清理上传的文件
    try { fs.unlinkSync(filePath); } catch {}
  });

  it('下载后日志包含下载记录', async () => {
    // 确保文件存在
    const downloadFile = path.join(TEST_DIR, 'upload-test.txt');
    if (!fs.existsSync(downloadFile)) {
      fs.writeFileSync(downloadFile, 'download test content', 'utf-8');
    }

    const r = await request('GET', '/api/download?path=/upload-test.txt');
    assert.strictEqual(r.status, 200, `下载返回 ${r.status}`);

    await sleep(300);

    const log = await request('GET', '/api/logs?lines=50');
    assert.strictEqual(log.status, 200);
    const found = log.data.some(e => e.message.includes('下载文件') && e.message.includes('upload-test.txt'));
    assert.ok(found, `日志应包含下载记录，实际日志: ${log.data.map(e => e.message).slice(-3).join(' | ')}`);
  });

  it('删除后日志包含删除记录', async () => {
    // 确保文件存在
    const deleteFile = path.join(TEST_DIR, 'upload-test.txt');
    if (!fs.existsSync(deleteFile)) {
      fs.writeFileSync(deleteFile, 'delete test content', 'utf-8');
    }

    const r = await request('DELETE', '/api/delete?path=/upload-test.txt');
    assert.strictEqual(r.status, 200, `删除返回 ${r.status}`);

    await sleep(300);

    const log = await request('GET', '/api/logs?lines=50');
    assert.strictEqual(log.status, 200);
    const found = log.data.some(e =>
      (e.message.includes('删除成功') || e.message.includes('已永久删除')) &&
      e.message.includes('upload-test.txt')
    );
    assert.ok(found, `日志应包含删除记录，实际日志: ${log.data.map(e => e.message).slice(-3).join(' | ')}`);
  });

});
