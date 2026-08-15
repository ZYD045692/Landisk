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
  // 只检查测试服务实际使用的 config（LANDISK_DATA_DIR=dev-data）。
  // 之前扫多个候选文件 + anyMatched 会假通过（~/.landisk/config.json 里没有测试根就放行）。
  const cfgPath = path.join(__dirname, '..', 'dev-data', 'config.json');
  if (!fs.existsSync(cfgPath)) return false;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { return false; }
  const roots = cfg.roots || [];
  const rootPath = r => (r && r.path) || r;
  if (shouldContain && !roots.some(r => rootPath(r).includes(shouldContain))) return false;
  if (shouldNotContain && roots.some(r => rootPath(r).includes(shouldNotContain))) return false;
  return true;
}

// ─── 文件锁 ────────────────────────────

/** 打开文件持有锁，返回文件描述符 */
function lockFile(p) { return fs.openSync(p, 'r+'); }

/** 关闭文件描述符释放锁 */
function unlockFile(fd) { fs.closeSync(fd); }

// ─── HTTP 请求 ─────────────────────────

const BASE = 'http://localhost:22581';

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

/** curl 上传（虚拟路径，去掉前导斜杠规避 curl -F 的怪癖；text fields 在 file field 之前） */
function curlUpload(localPath, filename, targetPath, replace) {
  const p = localPath.replace(/\\/g, '/');
  const fn = filename ? `;filename=${filename}` : '';
  const r = replace || '';
  const vpath = targetPath.replace(/^\/+/, '');
  const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=${vpath}" -F "replace=${r}" -F "files=@${p}${fn}"`;
  try {
    return JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim());
  } catch (e) {
    const m = e.stdout?.toString() || e.message;
    try { return JSON.parse(m.trim()); } catch { return { error: m }; }
  }
}

// ─── 日志断言 ─────────────────────────

/** GET /api/logs 返回当前日志列表（后端返回裸数组） */
async function getLogs() {
  const r = await httpReq('GET', '/api/logs');
  if (Array.isArray(r.data)) return r.data;
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

// 确保根目录已注册，返回根目录名（虚拟路径第一段）
// Windows 路径大小写不敏感（后端 dunce::canonicalize 会把盘符统一成大写），
// 这里用不区分大小写匹配，避免 __dirname 的盘符大小写与 config 不一致导致返回 null
async function resolveRoot(dirPath) {
  const key = String(dirPath).toLowerCase();
  const cfg = readConfigSync();
  if (cfg) {
    const exist = (cfg.roots || []).find(r => String(r.path).toLowerCase() === key);
    if (exist) return exist.name;
  }
  const a = await httpReq('POST', '/api/roots', { json: { path: dirPath } });
  if (a.data?.success !== true) throw new Error(`add root failed: ${dirPath} — ${a.data?.message}`);
  const r = (a.data?.data?.roots || []).find(x => String(x.path).toLowerCase() === key);
  return r ? r.name : null;
}

module.exports = { dirExists, fileExists, allExist, someExist, readFile, filesMatch, fileIs, listDir, checkConfigRoots, lockFile, unlockFile, httpReq, curlUpload, getLogs, logContains, resolveRoot };
