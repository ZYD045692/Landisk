/**
 * 把 Tauri NSIS 安装包拷贝到项目根目录 dist/
 * 在 `npx tauri build` 完成后由 `npm run build:tauri` 调用
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// 清空 dist/ 目录，避免残留旧安装包
if (fs.existsSync(OUT)) {
  for (const f of fs.readdirSync(OUT)) {
    fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(OUT, { recursive: true });
}

const bundleDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
if (!fs.existsSync(bundleDir)) {
  console.error('错误: NSIS 目录不存在:', bundleDir);
  console.error('请确认 npx tauri build 已成功完成');
  process.exit(1);
}

const files = fs.readdirSync(bundleDir).filter(f => f.endsWith('.exe'));
if (files.length === 0) {
  console.error('错误: 未找到 .exe 安装包:', bundleDir);
  process.exit(1);
}

for (const file of files) {
  const src = path.join(bundleDir, file);
  const dst = path.join(OUT, file);
  fs.copyFileSync(src, dst);
  console.log(`  📦 ${file} → ${dst}`);
}

// 清理 bundle/ 目录（安装包已复制到 dist/，构建产物不再需要）
const bundleRoot = path.resolve(bundleDir, '..');
if (fs.existsSync(bundleRoot)) {
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  console.log(`  🧹 已清理 ${bundleRoot}`);
}

// 清理 sidecar 中间产物（已打进安装包，不再需要）
const sidecarDir = path.join(ROOT, 'src-tauri', 'binaries');
if (fs.existsSync(sidecarDir)) {
  fs.rmSync(sidecarDir, { recursive: true, force: true });
  console.log(`  🧹 已清理 ${sidecarDir}`);
}

console.log(`  已拷贝 ${files.length} 个安装包到 ${OUT}`);
