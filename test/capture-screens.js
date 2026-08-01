/**
 * LanDisk 截图脚本 — 用 CDP 打开页面，逐场景截图到 images/
 * 用法: node -r ./cdp-wrapper.js test/capture-screens.js
 * 前置: npm run server + setup.js 已运行
 * 输出: images/01..08-*.png
 */
const fs = require('fs');
const path = require('path');
const V = require('./verify');

const BASE = 'http://localhost:22580';
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
  console.log('  LanDisk 界面截图');
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  // CDP 就绪
  await nav(`${BASE}/`);
  await sleep(2500);
  const title = await safe('document.title');
  if (typeof title !== 'string' || title.includes('ERR')) { console.error('  ✗ CDP 不可用'); process.exit(1); }
  console.log('  ✔ Chrome CDP 连接正常\n');

  try {
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

    // 刷新页面加载根目录
    await nav(`${BASE}/?path=/&root=0`);
    await sleep(3000);

    // ════════════ 09 多根目录切换 ════════════
    await cdpClick('.root-switcher .el-select__wrapper');
    await sleep(1200);
    await shot('09-root-switch.png');
    // 选 testdira 关闭下拉
    await cdpClickText('.el-select-dropdown__item', 'testdira');
    await sleep(1200);

    // ════════════ 10 面包屑导航 ════════════
    await safe(clickFolder('testa'));
    await sleep(2000);
    await safe(clickFolder('subdir'));
    await sleep(2000);
    await shot('10-breadcrumb.png');
    // 点面包屑 "testa" 回到 testa/
    await cdpClickText('.el-breadcrumb__item a', 'testa');
    await sleep(2000);

    // ════════════ 01 文件浏览主界面 ════════════
    await shot('01-file-browser.png');

    // ════════════ 02 多选批量操作 ════════════
    await cdpSelectAll();
    await sleep(1000);
    await shot('02-batch-select.png');
    await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
    await sleep(800);

    // ════════════ 07 上传冲突弹窗 ════════════
    await safe(dropUpload('crawl_up.txt', '第一次上传内容'));
    await sleep(4000); // 等上传完成 + 成功提示消失
    await safe(dropUpload('crawl_up.txt', '同名冲突内容'));
    await sleep(3000); // 等冲突弹窗出现
    await shot('07-upload-conflict.png');
    await cdpClickText('.el-dialog .el-button:not(.el-button--primary)', '取消上传');
    await sleep(1500);

    // ════════════ 08 删除确认弹窗 ════════════
    await safe(`(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){const b=r.querySelector('td:last-child button:last-child');if(b){b.click();return'ok';}}return'notfound';})()`);
    await sleep(1500);
    await shot('08-delete-confirm.png');
    await cdpClickText('.el-message-box__btns .el-button', '取消');
    await sleep(1200);

    // ════════════ 03 设置弹窗 ════════════
    await cdpClick('.header-right [title="设置"]');
    await sleep(1800);
    await shot('03-settings.png');
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1200);

    // ════════════ 04 日志查看器 ════════════
    await cdpClick('.header-right [title="服务器日志"]');
    await sleep(1800);
    await shot('04-log-viewer.png');
    await cdpClick('.el-dialog__headerbtn');
    await sleep(1200);

    // ════════════ 05 手机扫码 ════════════
    await cdpClick('.header-right [title="扫码访问"]');
    await sleep(1800);
    await shot('05-qr-code.png');
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1200);

    // ════════════ 06 全局拖拽覆盖层 ════════════
    await safe(`(()=>{window.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true}));return'ok'})()`);
    await sleep(900);
    await shot('06-drag-overlay.png');
    await safe(`(()=>{window.dispatchEvent(new DragEvent('dragleave',{clientX:-1,clientY:-1}));return'ok'})()`);
    await sleep(600);

  } catch (e) {
    console.error('  ✗ 截图过程出错:', e.message);
    process.exit(1);
  }

  console.log(`\n✅ 完成，共 ${seq} 张截图 → ${path.relative(__dirname, OUT)}/`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
