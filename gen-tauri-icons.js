const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const toIco = require('to-ico');

const ICONS_DIR = path.join(__dirname, 'src-tauri', 'icons');
const ICO_PATH = path.join(__dirname, 'icon.ico');
const PUBLIC_ICO = path.join(__dirname, 'client', 'public', 'icon.ico');
const TAURI_ICO = path.join(ICONS_DIR, 'icon.ico');

// 找到源文件（优先 jpg）
let srcFile = path.join(__dirname, 'icon.jpg');
if (!fs.existsSync(srcFile)) srcFile = path.join(__dirname, 'icon.png');
if (!fs.existsSync(srcFile)) { console.error('No icon.jpg or icon.png found'); process.exit(1); }
console.log(`Source: ${path.basename(srcFile)}`);

// 解码
let raw, width, height;
const ext = path.extname(srcFile).toLowerCase();
if (ext === '.jpg' || ext === '.jpeg') {
  const jpeg = require('jpeg-js');
  const buf = fs.readFileSync(srcFile);
  const decoded = jpeg.decode(buf, { useTArray: true });
  raw = Buffer.from(decoded.data);
  width = decoded.width; height = decoded.height;
} else {
  const { PNG: PngReader } = require('pngjs');
  const buf = fs.readFileSync(srcFile);
  const png = PngReader.sync.read(buf);
  raw = Buffer.from(png.data);
  width = png.width; height = png.height;
}
console.log(`Decoded: ${width}x${height}`);

// 缩放
function resize(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = (x + 0.5) * srcW / dstW - 0.5, sy = (y + 0.5) * srcH / dstH - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const x0 = Math.max(0, Math.min(srcW - 1, ix)), x1 = Math.max(0, Math.min(srcW - 1, ix + 1));
      const y0 = Math.max(0, Math.min(srcH - 1, iy)), y1 = Math.max(0, Math.min(srcH - 1, iy + 1));
      for (let c = 0; c < 4; c++) {
        dst[(y * dstW + x) * 4 + c] = Math.round(
          src[(y0 * srcW + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          src[(y0 * srcW + x1) * 4 + c] * fx * (1 - fy) +
          src[(y1 * srcW + x0) * 4 + c] * (1 - fx) * fy +
          src[(y1 * srcW + x1) * 4 + c] * fx * fy
        );
      }
    }
  }
  return dst;
}

// PNG 编码
function encodePNG(pixels, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; rows.push(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]); } }
  const deflated = zlib.deflateSync(Buffer.from(rows));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c; }
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii'); const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc, 0); return Buffer.concat([head, data, tail]); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', Buffer.alloc(0))]);
}

// 生成 Tauri PNG
const tauriSizes = [{ file: '32x32.png', size: 32 }, { file: '128x128.png', size: 128 }, { file: '128x128@2x.png', size: 256 }, { file: 'icon.png', size: 512 }];
for (const { file, size } of tauriSizes) {
  fs.writeFileSync(path.join(ICONS_DIR, file), encodePNG(resize(raw, width, height, size, size), size, size));
  console.log(`  ${file}`);
}

// 生成 ICO（用 png-to-ico）
async function makeICO() {
  const icoPngs = [];
  for (const size of [64, 48, 32, 16]) {
    const buf = encodePNG(resize(raw, width, height, size, size), size, size);
    icoPngs.push(buf);
  }
  const ico = await toIco(icoPngs, { resize: false });
  fs.writeFileSync(ICO_PATH, ico);
  fs.writeFileSync(TAURI_ICO, ico);
  fs.writeFileSync(PUBLIC_ICO, ico);
  console.log(`ICO (png-to-ico): ${ICO_PATH} (${(ico.length / 1024).toFixed(1)} KB)`);
}

makeICO().then(() => console.log('Done')).catch(err => { console.error(err); process.exit(1); });