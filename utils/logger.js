const fs = require('fs');
const path = require('path');

const MAX_SIZE = 1 * 1024 * 1024; // 1 MB
const LOG_FILE = 'landisk.log';

let _logDir = null;
let _logFilePath = null;
let _currentDate = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function init(dir) {
  _logDir = path.join(dir, 'logs');
  _logFilePath = path.join(_logDir, LOG_FILE);
  _currentDate = todayStr();

  try {
    if (!fs.existsSync(_logDir)) {
      fs.mkdirSync(_logDir, { recursive: true });
    }
  } catch (err) {
    console.error('[日志] 创建日志目录失败:', err.message);
    _logDir = null;
    _logFilePath = null;
  }
}

function rotateIfNeeded() {
  if (!_logFilePath) return;
  const today = todayStr();

  // 日期变更 → 归档
  if (today !== _currentDate) {
    archive(today);
    _currentDate = today;
    return;
  }

  // 超出大小 → 归档
  try {
    const stat = fs.statSync(_logFilePath);
    if (stat.size > MAX_SIZE) {
      archive(today);
    }
  } catch {
    // 文件不存在或无法访问，忽略
  }
}

function archive(dateStr) {
  if (!_logFilePath) return;
  const archived = path.join(_logDir, `landisk-${dateStr}.log`);
  try {
    if (fs.existsSync(archived)) {
      // 当天已有归档，追加内容
      const content = fs.readFileSync(_logFilePath, 'utf-8');
      fs.appendFileSync(archived, content, 'utf-8');
      fs.unlinkSync(_logFilePath);
    } else {
      fs.renameSync(_logFilePath, archived);
    }
  } catch (err) {
    console.error('[日志] 轮转失败:', err.message);
  }
}

function formatEntry(level, args) {
  const ts = formatTimestamp();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  return `[${ts}] [${level}] ${msg}`;
}

function write(level, stream) {
  return (...args) => {
    const entry = formatEntry(level, args);
    // 写入文件
    if (_logFilePath) {
      try {
        rotateIfNeeded();
        fs.appendFileSync(_logFilePath, entry + '\n', 'utf-8');
      } catch { /* 写入失败时静默处理 */ }
    }
    // 写入控制台
    stream.write(entry + '\n');
  };
}

module.exports = {
  init,
  info: write('INFO', process.stdout),
  warn: write('WARN', process.stdout),
  error: write('ERROR', process.stderr),
  getLogPath: () => _logFilePath,
  getLogDir: () => _logDir
};
