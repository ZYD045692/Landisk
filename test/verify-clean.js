/**
 * 环境清洁 — 删除整个 testdir/ + config 残留检查
 * 在 try/finally 中调用
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const TESTDIR = path.join(__dirname, 'testdir');

function verifyClean() {
  // 1. 删除 testdir/
  if (fs.existsSync(TESTDIR)) {
    fs.rmSync(TESTDIR, { recursive: true, force: true });
    console.log('  ✔ testdir/ 已删除（清洁）');
  }

  // 2. config 残留检查
  for (const cfgPath of [
    path.join(os.homedir(), '.landisk', 'config.json'),
    path.join(__dirname, '..', 'config.json')
  ]) {
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const bad = (cfg.roots || []).filter(r => r.includes('test_a') || r.includes('test_b'));
      if (bad.length > 0) {
        console.error('  ⚠ config.json 残留根目录:', bad.join(', '));
      }
    } catch {}
  }
}

module.exports = { verifyClean };
