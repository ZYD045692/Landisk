/**
 * 用 cargo 编译 Rust 后端为 sidecar（替代 pkg）
 *
 * 产物：src-tauri/binaries/landisk-server-x86_64-pc-windows-msvc.exe
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BINARIES_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const OUT_FILE = path.join(BINARIES_DIR, 'landisk-server-x86_64-pc-windows-msvc.exe');

// 确保输出目录存在
fs.mkdirSync(BINARIES_DIR, { recursive: true });

// 删旧 exe 强制重编
const releaseExe = path.join(ROOT, 'src-tauri', 'server', 'target', 'release', 'landisk-server.exe');
if (fs.existsSync(releaseExe)) fs.unlinkSync(releaseExe);
if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

// 刷新源码时间戳
const touchTarget = path.join(ROOT, 'src-tauri', 'server', 'src', 'main.rs');
try { fs.utimesSync(touchTarget, new Date(), new Date()); } catch {}

console.log('  cargo 编译 Rust 后端为 sidecar...');

try {
  execSync('cargo build --manifest-path server/Cargo.toml --release', {
    cwd: path.join(ROOT, 'src-tauri'),
    stdio: 'inherit',
  });

  // 复制产物到 binaries/
  const builtFile = path.join(ROOT, 'src-tauri', 'server', 'target', 'release', 'landisk-server.exe');
  if (fs.existsSync(builtFile)) {
    fs.copyFileSync(builtFile, OUT_FILE);
    const size = fs.statSync(OUT_FILE).size;
    console.log(`  ✅ sidecar 编译完成: ${OUT_FILE}`);
    console.log(`     大小: ${(size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.error('  ❌ 未找到编译产物:', builtFile);
    process.exit(1);
  }

  // UPX 压缩（已禁用）
  // const upxPath = path.join(ROOT, 'upx-5.2.0-win64', 'upx.exe');
  // if (fs.existsSync(upxPath)) {
  //   console.log('  UPX 压缩 sidecar...');
  //   execSync(`"${upxPath}" --best "${OUT_FILE}"`, {
  //     cwd: ROOT,
  //     stdio: 'inherit',
  //   });
  //   const compressedSize = fs.statSync(OUT_FILE).size;
  //   console.log(`  ✅ UPX 压缩完成: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
  // } else {
  //   console.log('  ⚠️ 未找到 UPX，跳过压缩');
  // }
} catch (err) {
  console.error('  ❌ sidecar 编译失败:', err.message);
  process.exit(1);
}
