/**
 * 测试验证工具模块 — 所有断言通过文件系统物理验证
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function dirExists(p)       { return fs.existsSync(p) && fs.statSync(p).isDirectory(); }
function fileExists(p)      { return fs.existsSync(p) && fs.statSync(p).isFile(); }
function allExist(ps)       { return ps.every(p => fs.existsSync(p)); }
function someExist(ps)      { return ps.some(p => fs.existsSync(p)); }
function readFile(p)        { return fs.readFileSync(p, 'utf-8'); }
function filesMatch(a, b)   { return readFile(a) === readFile(b); }
function fileIs(p, s)       { return readFile(p) === s; }
function listDir(p)         { return fs.existsSync(p) ? fs.readdirSync(p) : []; }

/**
 * 校验 config.json 共享目录列表中是否包含/不包含某路径
 */
function checkConfigRoots(opts) {
  const { shouldContain, shouldNotContain } = opts || {};
  const configs = [
    path.join(os.homedir(), '.landisk', 'config.json'),
    path.join(__dirname, '..', 'dev-data', 'config.json'),
    path.join(__dirname, '..', 'src-tauri', 'server', 'target', 'debug', 'config.json'),
    path.join(__dirname, '..', 'src-tauri', 'server', 'target', 'debug', 'data', 'config.json'),
    path.join(__dirname, '..', 'config.json')
  ];
  let anyMatched = false;
  for (const cfgPath of configs) {
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const roots = cfg.roots || [];
      let ok = true;
      if (shouldContain) ok = ok && roots.some(r => r.includes(shouldContain));
      if (shouldNotContain) ok = ok && !roots.some(r => r.includes(shouldNotContain));
      if (ok) anyMatched = true;
    } catch { continue; }
  }
  return anyMatched;
}

// ─── 文件锁 ────────────────────────────

/** 打开文件持有锁，返回文件描述符 */
function lockFile(p) { return fs.openSync(p, 'r+'); }

/** 关闭文件描述符释放锁 */
function unlockFile(fd) { fs.closeSync(fd); }

// ─── HTTP 请求 ─────────────────────────

const BASE = 'http://localhost:22580';

async function httpReq(method, urlPath, opts = {}) {
  const url = `${BASE}${urlPath}`;
  const opt = { method, headers: {}, ...opts };
  if (opts.json) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(opts.json);
  }
  try {
    const res = await fetch(url, opt);
    const status = res.status;
    const text = await res.text();
    try { return { status, data: JSON.parse(text), text }; }
    catch { return { status, data: text, text }; }
  } catch (e) {
    return { status: 0, data: { error: e.message }, text: e.message };
  }
}

/** curl 上传（确保 text fields 在 file field 之前） */
function curlUpload(localPath, filename, targetPath, rootIdx, replace) {
  const p = localPath.replace(/\\/g, '/');
  const fn = filename ? `;filename=${filename}` : '';
  const r = replace || '';
  const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=${targetPath}" -F "root=${rootIdx}" -F "replace=${r}" -F "files=@${p}${fn}"`;
  try {
    return JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim());
  } catch (e) {
    const m = e.stdout?.toString() || e.message;
    try { return JSON.parse(m.trim()); } catch { return { error: m }; }
  }
}

// ─── 日志断言 ─────────────────────────

/** GET /api/logs 返回当前日志列表 */
async function getLogs() {
  const r = await httpReq('GET', '/api/logs');
  return r.data?.data || r.data?.logs || [];
}

/**
 * 断言日志中存在匹配的条目
 * @param {{ type?: number, op?: number, level?: string, file?: string }} criteria
 * @returns {boolean}
 */
function logContains(logs, criteria) {
  if (!logs || !logs.length) return false;
  return logs.some(e => {
    if (criteria.type !== undefined && e.type !== criteria.type) return false;
    if (criteria.op !== undefined && (!e.data || e.data.op !== criteria.op)) return false;
    if (criteria.level !== undefined && (e.level || '').toLowerCase() !== criteria.level.toLowerCase()) return false;
    if (criteria.file !== undefined && (!e.data || !e.data.file || !e.data.file.includes(criteria.file))) return false;
    return true;
  });
}

// ─── Root helpers ────────────────────────

function readConfigSync() {
  const candidates = [
    path.join(os.homedir(), '.landisk', 'config.json'),
    path.join(__dirname, '..', 'dev-data', 'config.json'),
    path.join(__dirname, '..', 'src-tauri', 'server', 'target', 'debug', 'config.json'),
    path.join(__dirname, '..', 'src-tauri', 'server', 'target', 'debug', 'data', 'config.json'),
    path.join(__dirname, '..', 'config.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { return JSON.parse(fs.readFileSync(c, 'utf-8')); } catch {}
    }
  }
  return null;
}

// Ensure root is registered, return its index in config.roots[]
async function resolveRoot(dirPath) {
  const cfg = readConfigSync();
  if (cfg) {
    const exist = (cfg.roots || []).findIndex(r => r === dirPath);
    if (exist >= 0) return exist;
  }
  const a = await httpReq('POST', '/api/roots', { json: { path: dirPath } });
  if (a.data?.success !== true) throw new Error(`add root failed: ${dirPath} — ${a.data?.message}`);
  return a.data?.data?.roots.findIndex(r => r.path === dirPath || r === dirPath);
}

module.exports = { dirExists, fileExists, allExist, someExist, readFile, filesMatch, fileIs, listDir, checkConfigRoots, lockFile, unlockFile, httpReq, curlUpload, getLogs, logContains, resolveRoot };
