/**
 * 一键修改项目版本号 —— 同步所有「项目自身版本」位置
 *
 * 用法: node scripts/set-version.js 0.1.3
 *
 * 更新的位置（只改 landisk 自身版本，不动依赖版本）：
 *   - package.json                  version
 *   - package-lock.json             顶层 version + packages[""] version
 *   - client/package.json           version（Vite 默认 0.0.0，需同步）
 *   - src-tauri/Cargo.toml          version
 *   - src-tauri/server/Cargo.toml   version
 *   - src-tauri/tauri.conf.json     version
 *   - src-tauri/Cargo.lock          landisk 包 version
 *   - src-tauri/server/Cargo.lock   landisk-server 包 version
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('用法: node scripts/set-version.js <x.y.z>');
  process.exit(1);
}

let changed = 0;
const ok = [];

function patchJson(rel, replacer) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf-8');
  const next = replacer(raw);
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf-8');
    changed++;
    ok.push(rel);
  }
}

// JSON 文件（保留原格式缩进）
function setJsonVersion(rel) {
  patchJson(rel, raw => {
    const indent = raw.match(/^\s{2}"version"/) ? 2 : 2;
    return raw.replace(/(^[ \t]*"version"[ \t]*:[ \t]*")[^"]*(")/m, `$1${newVersion}$2`);
  });
}

setJsonVersion('package.json');
setJsonVersion('client/package.json');
setJsonVersion('src-tauri/tauri.conf.json');

// package-lock.json：顶层 + packages[""] 两处（都在文件头部，正则只匹配前两处）
patchJson('package-lock.json', raw => {
  let count = 0;
  return raw.replace(/(^[ \t]*"version"[ \t]*:[ \t]*")[^"]*(")/gm, (m, p1, p2) => {
    if (count < 2) { count++; return p1 + newVersion + p2; }
    return m;
  });
});

// Cargo.toml（src-tauri + server）
function setCargoVersion(rel) {
  patchJson(rel, raw => raw.replace(/(^version[ \t]*=[ \t]*")[^"]*(")/m, `$1${newVersion}$2`));
}
setCargoVersion('src-tauri/Cargo.toml');
setCargoVersion('src-tauri/server/Cargo.toml');

// Cargo.lock：只改 landisk / landisk-server 包块里的 version
function setCargoLockVersion(rel, pkgName) {
  patchJson(rel, raw => {
    const lines = raw.split('\n');
    let inPkg = false;
    return lines.map(line => {
      if (line === `name = "${pkgName}"`) { inPkg = true; return line; }
      if (inPkg && /^name = "/.test(line) && line !== `name = "${pkgName}"`) { inPkg = false; return line; }
      if (inPkg && /^version = "/.test(line)) { return line.replace(/(^version = ")[^"]*(")/, `$1${newVersion}$2`); }
      return line;
    }).join('\n');
  });
}
setCargoLockVersion('src-tauri/Cargo.lock', 'landisk');
setCargoLockVersion('src-tauri/server/Cargo.lock', 'landisk-server');

if (changed === 0) {
  console.log('未发现需要更新的版本号');
} else {
  console.log(`✅ 已将 ${changed} 个文件的版本号更新为 ${newVersion}:`);
  for (const f of ok) console.log(`   - ${f}`);
}
