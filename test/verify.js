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
 * 有一个配置文件满足条件即为通过
 */
function checkConfigRoots(opts) {
  const { shouldContain, shouldNotContain } = opts || {};
  const configs = [
    path.join(os.homedir(), '.landisk', 'config.json'),
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

module.exports = { dirExists, fileExists, allExist, someExist, readFile, filesMatch, fileIs, listDir, checkConfigRoots };
