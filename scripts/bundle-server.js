/**
 * 打包服务端文件到 server-dist/，供 Tauri resources 捆绑
 * 只复制生产依赖（不含 devDependencies）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'server-dist');

// 清理旧输出
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true });
}
fs.mkdirSync(OUT, { recursive: true });

// 复制 server 源码文件
const sourceFiles = [
  'server.js',
  'config.json',
];

for (const f of sourceFiles) {
  const src = path.join(ROOT, f);
  const dst = path.join(OUT, path.basename(f));
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`  COPY ${f}`);
  }
}

// 复制目录
const sourceDirs = ['middleware', 'routes'];
for (const dir of sourceDirs) {
  copyDir(path.join(ROOT, dir), path.join(OUT, dir));
}

// 只复制生产依赖的 node_modules（只复制顶层包）
const prodDeps = Object.keys(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).dependencies || {}
);

console.log(`  DEPS: ${prodDeps.join(', ')}`);

fs.mkdirSync(path.join(OUT, 'node_modules'), { recursive: true });

const queue = [...prodDeps];
const copied = new Set();

while (queue.length > 0) {
  const name = queue.shift();
  if (copied.has(name)) continue;

  const srcDir = path.join(ROOT, 'node_modules', name);
  if (!fs.existsSync(srcDir)) {
    console.warn(`  WARN: ${name} not found in node_modules`);
    continue;
  }

  const dstDir = path.join(OUT, 'node_modules', name);
  copyDir(srcDir, dstDir);
  copied.add(name);

  // 读取该包的 package.json，找出它的依赖，递归复制
  const pkgJsonPath = path.join(srcDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const subDeps = Object.keys(pkgJson.dependencies || {});
      for (const d of subDeps) {
        if (!copied.has(d)) queue.push(d);
      }
    } catch {}
  }
}

console.log(`  Total packages copied: ${copied.size}`);

/**
 * 递归复制目录
 */
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
