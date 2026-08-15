/**
 * LanDisk 截图脚本 — 用 CDP 打开页面，逐场景截图到 images/
 * 用法: node -r ./cdp-wrapper.js test/capture-screens.js
 *
 * 自动管理服务（同爬虫测试）：杀旧 → 构建前端 → 起新 → 等待就绪 → 结束后停止。
 * 双模式截图（同爬虫测试）：
 *   ① 网页端模式（?shell=0）—— 截「下载类」界面：文件浏览(下载按钮)、多选批量(批量下载)、
 *      面包屑、扫码、拖拽上传、冲突弹窗、删除确认、日志查看器；
 *   ② 注入 __TAURI_INTERNALS__ 切桌面应用模式 —— 截「打开类」界面：虚拟根(行内打开/移除)、
 *      设置弹窗(开机自启行仅壳内显示)。
 * 输出: images/*.png（语义命名，无编号；引用顺序见 Landisk.md）
 */
const fs = require('fs');
const path = require('path');
const V = require('./verify');
const { startServer, stopServer, backupConfig, clearConfigRoots, restoreConfig } = require('./server-mgr');
const { verifyClean } = require('./verify-clean');

const BASE = 'http://localhost:22581';
const DIR_A = path.join(__dirname, 'testdir', 'testdira');
const OUT = path.join(__dirname, '..', 'images');

let seq = 0;

async function req(method, urlPath, opts = {}) {
  const opt = { method, headers: {}, ...opts };
  if (opts.json) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opts.json); }
  try {
    const res = await fetch(`${BASE}${urlPath}`, opt);
    return { status: res.status, data: await res.json().catch(()=>({})), text: await res.text().catch(()=>'') };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

async function shot(name) {
  await sleep(700); // 等渲染稳定
  const res = await cdpRaw('Page.captureScreenshot', { format: 'png' });
  if (res && res.data) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(res.data, 'base64'));
    console.log(`  📸 [${String(++seq).padStart(2, '0')}] ${name}`);
  } else {
    console.log(`  ❌ 截图失败: ${name}`);
  }
}

function dropUpload(filename, content) {
  return `(()=>{const f=new File([${JSON.stringify(content)}],${JSON.stringify(filename)},{type:'text/plain'});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`;
}

function clickFolder(name) {
  return `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(r.textContent.includes('${name}')){const n=r.querySelector('.file-name');if(n){n.click();return'ok';}}}return'notfound';})()`;
}

async function cdpClick(selector) {
  const pos = await safe(`(()=>{const e=document.querySelector('${selector}');if(!e)return'notfound';const r=e.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (pos === 'notfound' || typeof pos !== 'string') return false;
  try { const {x,y}=JSON.parse(pos); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); return true; } catch { return false; }
}

async function cdpClickText(containerSel, text) {
  const pos = await safe(`(()=>{const b=Array.from(document.querySelectorAll('${containerSel}')).find(x=>x.textContent.includes('${text}'));if(!b)return'notfound';const r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (pos === 'notfound' || typeof pos !== 'string') return false;
  try { const {x,y}=JSON.parse(pos); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); return true; } catch { return false; }
}

async function cdpSelectAll() {
  const hdr = await safe(`(()=>{const c=document.querySelector('.el-table__header-wrapper .el-checkbox');if(!c)return'notfound';const r=c.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (hdr !== 'notfound' && typeof hdr === 'string') {
    try { const {x,y}=JSON.parse(hdr); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); return true; } catch {}
  }
  const data = await safe(`(() => {
    const cbs = document.querySelectorAll('tr.el-table__row .el-checkbox');
    return JSON.stringify(Array.from(cbs).map(c => { const r=c.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; }));
  })()`);
  if (!data || data === '[]' || typeof data !== 'string') return 0;
  try {
    const positions = JSON.parse(data);
    for (const {x,y} of positions) {
      await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      await sleep(80);
    }
    return positions.length;
  } catch { return 0; }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk 界面截图（自动起服务 + 双模式）');
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // 测试前必做：备份并清空共享根（保护用户手动添加的真实共享目录）→ 杀旧后端 → 自动启动新后端
  backupConfig();
  clearConfigRoots();
  if (!(await startServer())) {
    console.error('后端未能启动，终止截图');
    process.exit(1);
  }

  // 关闭 Chrome（结束清理）
  async function closeBrowser() {
    try { await cdpRaw('Browser.close'); } catch {}
  }

  try {
    // CDP 就绪
    await waitCDP();
    await cdpRaw('Page.enable');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(2000);
    const title = await safe('document.title');
    if (typeof title !== 'string' || title.includes('ERR')) throw new Error('CDP not ready: ' + JSON.stringify(title));
    console.log('  ✔ Chrome CDP 连接正常\n');

    // ── 确保根目录存在 ──
    const rootsRes = await req('GET', '/api/roots');
    const roots = rootsRes?.data?.data?.roots || [];
    if (!roots.some(x => x.path.includes('testdira'))) {
      await req('POST', '/api/roots', { json: { path: DIR_A } });
      await sleep(800);
    }
    if (!roots.some(x => x.path.includes('testdirb'))) {
      await req('POST', '/api/roots', { json: { path: path.join(__dirname, 'testdir', 'testdirb') } });
      await sleep(800);
    }

    // ═══════════════════════════════════════
    // Phase A: 网页端模式（?shell=0）— 下载类界面
    // ═══════════════════════════════════════
    console.log('🟢 模式 → WEB (网页端，下载/批量下载类界面)\n');

    // 刷新页面加载虚拟根
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(3000);

    // ── 1. 手机扫码 ──
    await cdpClick('.header-right [title="扫码访问"]');
    await sleep(1800);
    await shot('qr-code.png');
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1200);

    // ── 2. 文件浏览主界面（网页端：行按钮=下载） ──
    await safe(clickFolder('testdira'));
    await sleep(2000);
    await safe(clickFolder('testa'));
    await sleep(2000);
    await shot('file-browser.png');

    // ── 3. 面包屑导航 ──
    await safe(clickFolder('subdir'));
    await sleep(2000);
    await shot('breadcrumb.png');
    // 点面包屑 "testa" 回到 testa/
    await cdpClickText('.el-breadcrumb__item a', 'testa');
    await sleep(2000);

    // ── 4. 多选批量操作（网页端：批量栏含「批量下载」） ──
    await cdpSelectAll();
    await sleep(1000);
    await shot('batch-select.png');
    await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
    await sleep(800);

    // ── 5. 全局拖拽覆盖层（真实目录拖入文件 = 上传） ──
    await safe(`(()=>{window.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true}));return'ok'})()`);
    await sleep(900);
    await shot('drag-overlay.png');
    await safe(`(()=>{window.dispatchEvent(new DragEvent('dragleave',{clientX:-1,clientY:-1}));return'ok'})()`);
    await sleep(600);

    // ── 6. 上传冲突弹窗 ──
    await safe(dropUpload('crawl_up.txt', '第一次上传内容'));
    await sleep(4000); // 等上传完成 + 成功提示消失
    await safe(dropUpload('crawl_up.txt', '同名冲突内容'));
    await sleep(3000); // 等冲突弹窗出现
    await shot('upload-conflict.png');
    await cdpClickText('.el-dialog .el-button:not(.el-button--primary)', '取消上传');
    await sleep(1500);

    // ── 7. 删除确认弹窗 ──
    await safe(`(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){const b=r.querySelector('td:last-child button:last-child');if(b){b.click();return'ok';}}return'notfound';})()`);
    await sleep(1500);
    await shot('delete-confirm.png');
    await cdpClickText('.el-message-box__btns .el-button', '取消');
    await sleep(1200);

    // ── 8. 日志查看器 ──
    await cdpClick('.header-right [title="服务器日志"]');
    await sleep(1800);
    await shot('log-viewer.png');
    await cdpClick('.el-dialog__headerbtn');
    await sleep(1200);

    // ═══════════════════════════════════════
    // Phase B: 桌面应用模式（注入 __TAURI_INTERNALS__）— 打开类界面
    // ═══════════════════════════════════════
    console.log('\n🔵 模式 → DESKTOP (注入 __TAURI_INTERNALS__，打开/开机自启类界面)');
    await cdpRaw('Page.addScriptToEvaluateOnNewDocument', { source: "window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {}; if(!window.__TAURI_INTERNALS__.convertFileSrc) window.__TAURI_INTERNALS__.convertFileSrc = function(p){ return 'data:text/plain;base64,' + btoa('landisk-shell-upload'); }; if(!window.__TAURI_INTERNALS__.invoke) window.__TAURI_INTERNALS__.invoke = function(cmd){ return Promise.resolve(false); };" });

    // ── 9. 虚拟根目录（桌面应用：行按钮=打开[资源管理器]+移除） ──
    await nav(`${BASE}/?path=/`);
    await sleep(3000);
    await shot('virtual-root.png');

    // ── 10. 设置弹窗（桌面应用：含开机自启行） ──
    await cdpClick('.header-right [title="设置"]');
    await sleep(1800);
    await shot('settings.png');
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    // ═══════════════════════════════════════
    // Phase C: 移动端（切手机视口）— 卡片列表
    // ═══════════════════════════════════════
    console.log('\n📱 模式 → MOBILE (窗口切 390x844，卡片列表)');
    await resizeWindow(390, 844);
    await sleep(800);

    // ── 11. 移动端卡片列表（testa 目录） ──
    await nav(`${BASE}/?path=/testdira/testa&shell=0`);
    await sleep(3000);
    await shot('mobile-list.png');

    // 切回桌面尺寸
    await resizeWindow(1024, 730);
    await sleep(500);

  } catch (e) {
    console.error('  ✗ 截图过程出错:', e.message);
    process.exit(1);
  } finally {
    verifyClean();
    await stopServer();
    restoreConfig();
    await closeBrowser();
  }

  console.log(`\n✅ 完成，共 ${seq} 张截图 → ${path.relative(__dirname, OUT)}/`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
