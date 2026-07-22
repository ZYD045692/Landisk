const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const MAX_SIZE = 1 * 1024 * 1024; // 1 MB
const LOG_FILE = 'landisk.log';
const MAX_BUFFER = 100; // 内存环形缓冲区上限

let _logDir = null;
let _logFilePath = null;
let _currentDate = null;

// 内存环形缓冲区 — API 从此读取，零文件 I/O
const ringBuffer = [];

// SSE 推流 — 新日志实时通知前端
const logEmitter = new EventEmitter();
function onLog(fn) { logEmitter.on('log', fn); }
function offLog(fn) { logEmitter.off('log', fn); }

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

  // 启动时从日志文件抓取最后 50 条，避免重启后日志查看器空白
  loadFromFile(50);
}

function loadFromFile(count) {
  if (!_logFilePath) return;
  try {
    const content = fs.readFileSync(_logFilePath, 'utf-8');
    const blocks = content.split('\n\n').filter(Boolean);
    const entries = [];
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block);
        entries.push({
          timestamp: parsed.ts,
          level: parsed.level,
          type: parsed.type,
          data: parsed.data,
          message: parsed.msg || ''
        });
      } catch { /* 跳过无法解析的行 */ }
    }
    const loaded = entries.slice(-count);
    for (const e of loaded) {
      ringBuffer.push(e);
    }
    if (loaded.length > 0) console.log(`[日志] 从文件加载 ${loaded.length} 条历史`);
  } catch { /* 文件不存在或无法读取 */ }
}

function rotateIfNeeded() {
  if (!_logFilePath) return;
  const today = todayStr();

  // 日期变更 → 归档（用 _currentDate 命名，因为归档的是旧日期的内容）
  if (today !== _currentDate) {
    archive(_currentDate);
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

const TYPE_NAMES = {
  1: '新增', 2: '替换', 3: '阻断', 4: '删除', 5: '下载',
  6: '打开', 7: '根目录', 8: '配置', 9: '启动', 10: '浏览',
  11: '日志', 12: '服务'
};

function write(level, stream) {
  return (...args) => {
    const ts = formatTimestamp();
    let type = null, data = null, msg = '';

    // 结构化日志：logger.info({ message, type, data })
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && 'type' in args[0]) {
      const entry = args[0];
      msg = entry.message || '';
      type = entry.type;
      data = entry.data || {};
    } else {
      // 传统字符串日志（向后兼容）
      msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    }

    // 控制台文字格式（带详细内容）
    const typeName = type ? (TYPE_NAMES[type] || type) : '';
    let detail = '';
    if (type === 1 || type === 2) {
      if (data.files) detail = '\n' + data.files.map(f => `       ${f.name} (${f.size})`).join('\n');
    } else if (type === 3) {
      if (data.files) detail = '\n' + data.files.map(f => `       ${f}`).join('\n');
    } else if (type === 4) {
      if (data.dest) detail = ` → ${data.dest}`;
      else if (data.error) detail = ` — ${data.error}`;
    } else if (type === 5 || type === 6) {
      if (data.error) detail = ` — ${data.error}`;
    } else if (type === 10) {
      if (data.error) detail = ` — ${data.error}`;
    } else if (type === 12) {
      if (data.error) detail = ` — ${data.error}`;
    }
    const text = type ? `[${ts}] [${level}] [${typeName}] ${msg}${detail}` : `[${ts}] [${level}] ${msg}`;

    // 内存环形缓冲区（供 API 即时读取）— 存结构化数据
    const entry = { timestamp: ts, level };
    if (type !== null) {
      entry.type = type;
      entry.data = data;
      entry.message = msg; // 简短摘要
    } else {
      entry.message = msg; // 旧格式纯文字
    }
    ringBuffer.push(entry);
    if (ringBuffer.length > MAX_BUFFER) {
      ringBuffer.splice(0, ringBuffer.length - MAX_BUFFER);
    }
    logEmitter.emit('log', entry);

    // 写入文件（格式化 JSON，每条之间空行分隔）
    if (_logFilePath) {
      try {
        rotateIfNeeded();
        const jsonObj = { ts, level };
        if (type !== null) {
          jsonObj.type = type;
          jsonObj.data = data;
        } else {
          jsonObj.msg = msg;
        }
        fs.appendFileSync(_logFilePath, JSON.stringify(jsonObj, null, 2) + '\n\n', 'utf-8');
      } catch {}
    }

    // 写入控制台
    stream.write(text + '\n');
  };
}

/**
 * 从内存环形缓冲区读取日志条目
 * @param {number} [lines=200] - 返回条数
 * @param {object} [options]
 * @param {string} [options.level] - 按等级过滤（INFO/WARN/ERROR）
 * @param {string} [options.search] - 按文本过滤
 * @returns {Array<{timestamp, level, message}>}
 */
function getBuffer(lines = 200, options = {}) {
  let result = ringBuffer;

  if (options.level) {
    const lv = options.level.toUpperCase();
    result = result.filter(e => e.level === lv);
  }

  if (options.search) {
    const s = options.search.toLowerCase();
    result = result.filter(e => e.message.toLowerCase().includes(s));
  }

  return result.slice(-lines);
}

/** 清空内存环形缓冲区 + 日志文件 */
function clearBuffer() {
  ringBuffer.length = 0;
  if (_logFilePath) {
    try {
      fs.writeFileSync(_logFilePath, '', 'utf-8');
    } catch { /* 忽略 */ }
  }
}

module.exports = {
  init,
  info: write('INFO', process.stdout),
  warn: write('WARN', process.stdout),
  error: write('ERROR', process.stderr),
  getLogPath: () => _logFilePath,
  getLogDir: () => _logDir,
  getBuffer,
  clearBuffer,
  onLog,
  offLog
};
