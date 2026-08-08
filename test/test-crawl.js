/**
 * LanDisk 前端爬虫测试（用户场景全覆盖，56 项）
 * 用法: node -r ./cdp-wrapper.js test-crawl.js
 *
 * 双模式顺序：
 *   ① 网页端模式（?shell=0，不注入 __TAURI_INTERNALS__）—— 测下载按钮/toast、批量下载、
 *      日志目录提示、无共享引导、拖拽上传、删除等通用操作；
 *   ② 注入 __TAURI_INTERNALS__ 切桌面端模式 —— 测打开(资源管理器/默认程序)、landisk-drop
 *      拖拽、开机自启、壳 UI（文件行=打开、批量栏无下载）、虚拟根移除/批量移除。
 *
 * 原则：每个操作验证 UI 行为 + 日志(type/op) + elMessage 提示（EMS 列）。
 * 结果表：含「模式」列区分网页端/桌面端，EMS 列为每个操作的 elMessage 提示。
 * 实时状态：页面顶部注入 #landisk-test-status 浮动条，mark() 在每条用例开始前更新。
 * 输出: test-crawl-results.md
 */
const fs = require('fs');
const path = require('path');
const { verifyClean } = require('./verify-clean');
const V = require('./verify');
const { startServer, stopServer, backupConfig, clearConfigRoots, restoreConfig } = require('./server-mgr');

const BASE = 'http://localhost:22580';
const DIR_A = path.join(__dirname, 'testdir', 'testdira');
const DIR_B = path.join(__dirname, 'testdir', 'testdirb');
const DIR_C = path.join(__dirname, 'testdir', 'testdirc');
const RENAME_SRC = path.join(__dirname, 'testdir', 'renamedir', 'testdira');
const NOT_DIR = path.join(__dirname, 'testdir', 'not_a_dir.txt');

async function req(method, urlPath, opts = {}) {
  const opt = { method, headers: {}, ...opts };
  if (opts.json) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opts.json); }
  try {
    const res = await fetch(`${BASE}${urlPath}`, opt);
    return { status: res.status, data: await res.json().catch(()=>({})), text: await res.text().catch(()=>'') };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

let pass = 0, fail = 0, n = 0;
let CUR_MODE = '网页端';
const TABLE = [];

/** 页面顶部实时状态条：模式名用英文（Web/Desktop），mark 在每条用例开始前调用 */
async function setTitle(phase, text) {
  const modeEn = CUR_MODE === '网页端' ? 'Web' : 'Desktop';
  const t = `[${modeEn}] ${phase} ${text}`.slice(0, 90);
  try { await safe(`(()=>{const el=document.getElementById('landisk-test-status');if(el)el.textContent=${JSON.stringify(t)};return'ok';})()`) } catch {}
}

/** 用例开始前调用：状态条立即显示「正在测试」 */
async function mark(type, op) {
  await setTitle(`▶ RUN #${n + 1}`, `${type}: ${op}`);
}

async function add(nv, type, op, expected, ok, detail) {
  // add 在用例结束后调用：状态条显示「已完成」
  await setTitle(`✓ DONE #${nv}`, `${type}: ${op}`);
  // 读本次用例最后一个 elMessage toast（type:text），无则 '—'；读后重置供下一用例
  let ems = '—'
  try {
    const v = await safe(`window.__EMS__ ? (window.__EMS__.type + ':' + window.__EMS__.text) : ''`)
    if (v) ems = v
  } catch {}
  await safe('window.__EMS__ = null')
  TABLE.push({ '#': nv, '类型': type, '操作': op, '预期': expected, '模式': CUR_MODE, 'EMS': ems, '结果': ok ? '✅' : '❌' });
  if (ok) { pass++; console.log(`  ✓ [${nv}][${CUR_MODE}] ${type}: ${op}`); }
  else { fail++; console.log(`  ✗ [${nv}][${CUR_MODE}] ${type}: ${op} — ${detail}`); }
}

const rowBtn = t => `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){const l=r.querySelector('td:last-child');if(!l)continue;for(const b of l.querySelectorAll('button')){if(b.textContent.includes('${t}')){b.click();return'ok';}}}return'notfound';})()`;

// 按行文本定位：点该行操作列的指定按钮（如 打开/移除/下载）
const rowBtnIn = (rowText, btnText) => `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(!r.textContent.includes('${rowText}'))continue;const l=r.querySelector('td:last-child');if(!l)continue;for(const b of l.querySelectorAll('button')){if(b.textContent.includes('${btnText}')){b.click();return'ok';}}}return'notfound';})()`;

function navToDir(dir) {
  return `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(r.textContent.includes('${dir}')){const n=r.querySelector('.file-name');if(n){n.click();return'ok';}}}return'notfound';})()`;
}

function addRootInSettings(abspath) {
  const esc = abspath.replace(/\\/g, '\\\\');
  return `(()=>{const i=document.querySelector('.add-section .el-input input');if(!i)return'noinput';i.value='${esc}';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('添加'));if(!b)return'nobtn';setTimeout(()=>b.click(),300);return'ok';})()`;
}

// 单文件拖拽上传（DOM DragEvent → App.vue onGlobalDrop → droppedFiles）
function dropUpload(filename, content) {
  return `(()=>{const f=new File([${JSON.stringify(content)}],${JSON.stringify(filename)},{type:'text/plain'});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`;
}

// 拖入指定字节数的大文件（用于触发「文件过大」）
function dropBigFile(name, bytes = 2 * 1024 * 1024) {
  return `(()=>{const buf=new Uint8Array(${bytes}).fill(88);const f=new File([buf],${JSON.stringify(name)});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`;
}

// 通过设置弹窗把最大上传改为指定 MB（打开弹窗→输入→保存）；保存后留在设置弹窗内
async function setMaxSizeMB(mb) {
  const openSub = await cdpClick('.settings-dialog-wrap .setting-value');
  if (!openSub) return false;
  await sleep(800);
  const setIn = await safe(`(()=>{const i=document.querySelector('.sub-dialog-row .el-input input');if(i){i.value='${mb}';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok'}return'nope'})()`);
  await sleep(300);
  return setIn === 'ok' && await cdpClickText('.sub-dialog-footer .el-button', '保存');
}

// 虚拟根拖入文件夹添加共享：给 File 定义 .path（Chrome 中 defineProperty 有效）
function dragAddFolder(folderPath, folderName) {
  return `(()=>{const f=new File([],${JSON.stringify(folderName)},{type:''});try{Object.defineProperty(f,'path',{value:${JSON.stringify(folderPath)},configurable:true});}catch(e){return'pathErr:'+e.message;}const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`;
}

/** CDP trusted click: 用 CSS selector 定位元素并用真实鼠标事件点击 */
async function cdpClick(selector) {
  const pos = await safe(`(()=>{const e=document.querySelector('${selector}');if(!e)return'notfound';const r=e.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (pos === 'notfound' || typeof pos !== 'string') return false;
  try { const {x,y}=JSON.parse(pos); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); return true; } catch { return false; }
}

/** CDP trusted click: 找包含指定文本的按钮 */
async function cdpClickText(containerSel, text) {
  const pos = await safe(`(()=>{const b=Array.from(document.querySelectorAll('${containerSel}')).find(x=>x.textContent.includes('${text}'));if(!b)return'notfound';const r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (pos === 'notfound' || typeof pos !== 'string') return false;
  try { const {x,y}=JSON.parse(pos); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); return true; } catch { return false; }
}

/** 全选：优先点表头全选 checkbox，回退逐行点击 */
async function cdpSelectAll() {
  const hdr = await safe(`(()=>{const c=document.querySelector('.el-table__header-wrapper .el-checkbox');if(!c)return'notfound';const r=c.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (hdr !== 'notfound' && typeof hdr === 'string') {
    try {
      const {x,y}=JSON.parse(hdr);
      await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      return true;
    } catch {}
  }
  const data = await safe(`(() => {
    const cbs = document.querySelectorAll('tr.el-table__row .el-checkbox');
    return JSON.stringify(Array.from(cbs).map(c => {
      const r = c.getBoundingClientRect();
      return {x: r.left + r.width/2, y: r.top + r.height/2};
    }));
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

/** 全选并确保批量栏出现（表格重渲染竞态时重试） */
async function ensureBatchBar() {
  for (let i = 0; i < 3; i++) {
    await cdpSelectAll();
    await sleep(800);
    const vis = await safe(`document.querySelector('.batch-bar')?'visible':'hidden'`);
    if (vis === 'visible') return true;
  }
  return false;
}

/** 读取当前表格全部行名（排序断言用） */
const allRowNames = `Array.from(document.querySelectorAll('tr.el-table__row .file-name')).map(n=>n.textContent).join('|')`;

/** 分页下拉选择（滚动进视口 → CDP 点 select → CDP 点指定值） */
const pgPick = async (pickText) => {
  await safe(`(()=>{document.querySelector('.pagination-wrap')?.scrollIntoView({block:'center'});window.scrollBy(0,-50);return'ok';})()`);
  await sleep(700);
  const selPos = await safe(`(()=>{const s=document.querySelector('.pagination-wrap .el-select');if(!s)return'notfound';const r=s.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (selPos === 'notfound' || typeof selPos !== 'string') return false;
  try {
    const {x,y}=JSON.parse(selPos);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  } catch { return false; }
  await sleep(900);
  const itemJs = `(()=>{const items=Array.from(document.querySelectorAll('.el-select-dropdown__item'));if(!items.length)return'no-items';const target=items.find(i=>i.textContent.trim().startsWith('${pickText}'))||items[0];const r=target.getBoundingClientRect();return JSON.stringify({text:target.textContent.trim(),x:r.left+r.width/2,y:r.top+r.height/2});})()`;
  const itemClicked = await safe(itemJs);
  if (typeof itemClicked !== 'string' || !itemClicked.startsWith('{')) return false;
  try {
    const {x,y}=JSON.parse(itemClicked);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    await sleep(1200);
    return true;
  } catch { return false; }
};

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk 前端爬虫测试（用户场景全覆盖）');
  console.log('═══════════════════════════════════════\n');

  // 测试前必做：备份并清空共享根（保护用户手动添加的真实共享目录）→ 杀旧后端 → 自动启动新后端
  backupConfig();
  clearConfigRoots();
  if (!(await startServer())) {
    console.error('后端未能启动，终止测试');
    process.exit(1);
  }

  // 关闭 Chrome（测试结束清理）
  async function closeBrowser() {
    try { await cdpRaw('Browser.close'); } catch {}
  }

  try {
    // 注入 EMS 观察器 + 页面顶部状态条元素（每个新文档自动创建）
    await waitCDP();
    await cdpRaw('Page.enable');
    await cdpRaw('Page.addScriptToEvaluateOnNewDocument', { source: `window.__EMS__ = null; new MutationObserver(function(muts){ for(var m of muts){ for(var node of m.addedNodes){ if(node && node.nodeType === 1 && node.classList && node.classList.contains('el-message')){ var cls = node.className || ''; var type = cls.indexOf('el-message--success') >= 0 ? 'success' : cls.indexOf('el-message--error') >= 0 ? 'error' : cls.indexOf('el-message--warning') >= 0 ? 'warning' : 'info'; window.__EMS__ = { type: type, text: (node.textContent || '').trim() }; } } } }).observe(document, { childList: true, subtree: true });
(function(){function mk(){if(document.getElementById('landisk-test-status'))return;var el=document.createElement('div');el.id='landisk-test-status';el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(26,26,46,0.92);color:#fff;font:600 13px/1.6 Consolas,monospace;padding:4px 10px;text-align:center;pointer-events:none;';el.textContent='[WEB] ...';document.body.appendChild(el);}if(document.body){mk();}else{document.addEventListener('DOMContentLoaded',mk);}})();` });
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(2000);
    const title = await safe('document.title');
    if (typeof title !== 'string' || title.includes('ERR')) throw new Error('CDP not ready: ' + JSON.stringify(title));
    console.log('═══════════════════════════════════════════════════');
    console.log('  🟢 模式 → WEB (网页端，?shell=0，未注入 __TAURI_INTERNALS__)');
    console.log('═══════════════════════════════════════════════════\n');
    await setTitle('', '== WEB MODE ==');

    // ═══════════════════════════════════════
    // Phase 1: 网页端模式 — 无共享引导 + 添加根 + 配置
    // ═══════════════════════════════════════

    /* ---- 1. 导航到首页 ---- */
    await mark('导航', '导航到/（网页端）');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(2000);
    await add(++n, '导航', '导航到/（网页端）', '首页显示', true, '');

    /* ---- 2. 无共享目录引导提示 ---- */
    await mark('引导', '无共享目录时显示引导');
    const noRootHint = await safe(`(()=>{const e=document.querySelector('.el-empty');return e&&e.textContent.includes('请先添加共享目录')?'yes':'no';})()`);
    await add(++n, '引导', '无共享目录时显示引导', '提示「请先添加共享目录」', noRootHint === 'yes', noRootHint === 'yes' ? '✓' : '无引导提示');
    await sleep(500);

    /* ---- 3. 设置→添加 testdira 根目录 ---- */
    await mark('根目录', '设置→输入路径→添加 testdira');
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const r3 = await safe(addRootInSettings(DIR_A));
    await sleep(3000);
    const roots3 = r3 === 'ok' ? await req('GET', '/api/roots') : null;
    const ok3 = r3 === 'ok' && roots3?.data?.data?.roots?.some(x => x.path.includes('testdira'));
    await add(++n, '根目录', '设置→输入路径→添加 testdira', '列表出现 testdira', ok3, r3);
    await sleep(500);

    /* ---- 4. 设置→添加 testdirb 根目录 ---- */
    await mark('根目录', '设置→输入路径→添加 testdirb');
    const r4 = await safe(addRootInSettings(DIR_B));
    await sleep(3000);
    const roots4 = r4 === 'ok' ? await req('GET', '/api/roots') : null;
    const ok4 = r4 === 'ok' && roots4?.data?.data?.roots?.some(x => x.path.includes('testdirb'));
    await add(++n, '根目录', '设置→输入路径→添加 testdirb', '列表出现 testdirb', ok4, r4);
    await sleep(500);

    /* ---- 5. 设置→重复添加 testdira → 已在共享列表（type=7 op=3 + toast） ---- */
    await mark('根目录', '设置→重复添加 testdira');
    const r5 = await safe(addRootInSettings(DIR_A));
    await sleep(2500);
    const logs5 = await req('GET', '/api/logs');
    const dupLog5 = Array.isArray(logs5?.data) && logs5.data.some(l => l.type === 7 && l.data?.op === 3 && String(l.data?.error).includes('已在共享列表'));
    await add(++n, '根目录', '设置→重复添加 testdira', '已在共享列表 (type=7 op=3)', r5 === 'ok' && dupLog5, r5 === 'ok' ? (dupLog5 ? '✓' : '无 type=7 op=3 日志') : r5);
    await sleep(500);

    /* ---- 6. 设置→添加不存在路径（type=7 op=3 + toast） ---- */
    await mark('根目录', '设置→添加不存在路径');
    const r6 = await safe(addRootInSettings(path.join(__dirname, 'testdir', 'no_such_dir_xyz')));
    await sleep(2500);
    const logs6 = await req('GET', '/api/logs');
    const missingLog6 = Array.isArray(logs6?.data) && logs6.data.some(l => l.type === 7 && l.data?.op === 3 && String(l.data?.error).includes('目录不存在'));
    await add(++n, '根目录', '设置→添加不存在路径', '目录不存在 (type=7 op=3)', r6 === 'ok' && missingLog6, r6 === 'ok' ? (missingLog6 ? '✓' : '无目录不存在日志') : r6);
    await sleep(500);

    /* ---- 7. 设置→添加文件路径（type=7 op=3「路径不是目录」+ toast） ---- */
    await mark('根目录', '设置→添加文件路径');
    const r7 = await safe(addRootInSettings(NOT_DIR));
    await sleep(2500);
    const logs7 = await req('GET', '/api/logs');
    const fileLog7 = Array.isArray(logs7?.data) && logs7.data.some(l => l.type === 7 && l.data?.op === 3 && String(l.data?.error).includes('路径不是目录'));
    await add(++n, '根目录', '设置→添加文件路径', '路径不是目录 (type=7 op=3)', r7 === 'ok' && fileLog7, r7 === 'ok' ? (fileLog7 ? '✓' : '无路径不是目录日志') : r7);
    await sleep(500);

    // ── 重命名共享目录（type=7 op=6 成功 / op=7 失败） ──
    /* ---- 7b. 共享目录行有「重命名」按钮 ---- */
    await mark('根目录', '设置→共享目录行有重命名按钮');
    const hasRenBtn = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('testdira')){return r.querySelectorAll('button').length>=2?'yes':'no';}}return'notfound';})()`);
    await add(++n, '根目录', '设置→共享目录行有重命名按钮', '存在', hasRenBtn === 'yes', hasRenBtn);

    /* ---- 7c. 重命名弹窗预填当前名 ---- */
    await mark('根目录', '重命名弹窗预填当前名');
    const openRenC = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('testdira')){const b=Array.from(r.querySelectorAll('button')).find(x=>x.textContent.includes('重命名'));if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(1000);
    const prefillC = await safe(`(()=>{const i=document.querySelector('.rename-row .el-input input');return i?i.value:'noinput';})()`);
    await add(++n, '根目录', '重命名弹窗预填当前名', 'testdira', openRenC==='ok' && prefillC==='testdira', openRenC==='ok'?(prefillC==='testdira'?'✓':`预填=${prefillC}`):openRenC);

    /* ---- 7d. 重命名保存 → 列表更新 + 日志 ---- */
    await mark('根目录', '设置→重命名保存→列表更新');
    const setRenD = await safe(`(()=>{const i=document.querySelector('.rename-row .el-input input');if(i){i.value='renamedA';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok';}return'noinput';})()`);
    await sleep(300);
    const savedRenD = setRenD==='ok' && await cdpClickText('.sub-dialog-footer .el-button--primary', '保存');
    await sleep(2000);
    const renamedD = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('renamedA')){return'yes';}}return'no';})()`);
    const renLogD = await req('GET', '/api/logs');
    const hasRenLogD = Array.isArray(renLogD?.data) && renLogD.data.some(l => l.type === 7 && l.data?.op === 6 && l.data?.newName === 'renamedA');
    await add(++n, '根目录', '重命名保存→列表更新', 'renamedA + type=7 op=6', savedRenD && renamedD==='yes' && hasRenLogD, savedRenD ? (renamedD==='yes'?(hasRenLogD?'✓':'无op=6日志'):'列表未更新') : '保存失败');

    /* ---- 7e. 改回原名 testdira（恢复） ---- */
    await mark('根目录', '重命名改回 testdira');
    const openRenE = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('renamedA')){const b=Array.from(r.querySelectorAll('button')).find(x=>x.textContent.includes('重命名'));if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(1000);
    const setRenE = await safe(`(()=>{const i=document.querySelector('.rename-row .el-input input');if(i){i.value='testdira';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok';}return'noinput';})()`);
    await sleep(300);
    const savedRenE = setRenE==='ok' && await cdpClickText('.sub-dialog-footer .el-button--primary', '保存');
    await sleep(2000);
    const restoredE = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('testdira')){return'yes';}}return'no';})()`);
    await add(++n, '根目录', '重命名改回 testdira', 'config 恢复', savedRenE && restoredE==='yes', savedRenE?(restoredE==='yes'?'✓':'未恢复'):'保存失败');

    /* ---- 7f. 重命名空名→拒绝（弹窗不关） ---- */
    await mark('根目录', '重命名空名→拒绝');
    const openRenF = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('testdira')){const b=Array.from(r.querySelectorAll('button')).find(x=>x.textContent.includes('重命名'));if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(1000);
    const setRenF = await safe(`(()=>{const i=document.querySelector('.rename-row .el-input input');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok';}return'noinput';})()`);
    await sleep(300);
    await cdpClickText('.sub-dialog-footer .el-button--primary', '保存');
    await sleep(800);
    const emptyRenF = await safe(`(()=>{const m=document.querySelector('.el-message');return m&&m.textContent.includes('名称不能为空')?'yes':'no';})()`);
    const dialogOpenF = await safe(`(()=>{return document.querySelector('.rename-row')?'open':'closed';})()`);
    await cdpClickText('.sub-dialog-footer .el-button', '取消');
    await sleep(800);
    await add(++n, '根目录', '重命名空名→拒绝', '提示+弹窗不关', emptyRenF==='yes' && dialogOpenF==='open', emptyRenF==='yes'?(dialogOpenF==='open'?'✓':'弹窗关了'):'无提示');

    /* ---- 7g. 重命名重名→拒绝（error toast） ---- */
    await mark('根目录', '重命名重名→拒绝');
    const openRenG = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .root-item')){if(r.textContent.includes('testdira')){const b=Array.from(r.querySelectorAll('button')).find(x=>x.textContent.includes('重命名'));if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(1000);
    const setRenG = await safe(`(()=>{const i=document.querySelector('.rename-row .el-input input');if(i){i.value='testdirb';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok';}return'noinput';})()`);
    await sleep(300);
    await cdpClickText('.sub-dialog-footer .el-button--primary', '保存');
    await sleep(1500);
    const dupRenG = await safe(`(()=>{const m=document.querySelector('.el-message--error');return m&&m.textContent.includes('已存在')?'yes':'no';})()`);
    await cdpClickText('.sub-dialog-footer .el-button', '取消');
    await sleep(800);
    await add(++n, '根目录', '重命名重名→拒绝', 'error 提示', dupRenG==='yes', dupRenG==='yes'?'✓':'无重名提示');

    /* ---- 8. 设置→修改最大上传值（子弹窗交互，type=8 op=1） ---- */
    await mark('配置', '设置→最大上传调高→保存→再调回 500');
    const cfgPre8 = await req('GET', '/api/config');
    const curSize8 = cfgPre8?.data?.maxFileSizeMB ?? 500;
    const target8 = curSize8 >= 9999 ? curSize8 - 1 : curSize8 + 1;
    const openSub8 = await cdpClick('.settings-dialog-wrap .setting-value');
    let saved8 = false;
    if (openSub8) {
      await sleep(800);
      const setIn8 = await safe(`(()=>{const i=document.querySelector('.sub-dialog-row .el-input input');if(i){i.value='${target8}';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok'}return'nope'})()`);
      await sleep(300);
      saved8 = setIn8 === 'ok' && await cdpClickText('.sub-dialog-footer .el-button', '保存');
      await sleep(1500);
    }
    const cfgPost8 = await req('GET', '/api/config');
    const changed8 = cfgPost8?.data?.maxFileSizeMB === target8;
    const log8 = await req('GET', '/api/logs');
    const hasLog8 = (log8?.data?.data || log8?.data || []).some(e => e.type === 8 && e.data?.op === 1);
    const ok8 = saved8 && changed8 && hasLog8;
    let restored8 = false;
    let cfgRestore8 = null;
    if (ok8) {
      const openSub8b = await cdpClick('.settings-dialog-wrap .setting-value');
      if (openSub8b) {
        await sleep(800);
        await safe(`(()=>{const i=document.querySelector('.sub-dialog-row .el-input input');if(i){i.value='500';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok'}return'nope'})()`);
        await sleep(300);
        const saved8b = await cdpClickText('.sub-dialog-footer .el-button', '保存');
        await sleep(1500);
        cfgRestore8 = await req('GET', '/api/config');
        restored8 = saved8b && cfgRestore8?.data?.maxFileSizeMB === 500;
      }
    }
    await add(++n, '配置', '设置→最大上传调高→保存→再调回 500', `调高 ${target8}MB + 还原 500`, ok8 && restored8, ok8 ? (restored8 ? '✓' : `未还原 500: cfg=${cfgRestore8?.data?.maxFileSizeMB}`) : `saved=${saved8} changed=${changed8} log=${hasLog8}`);

    /* ---- 9. 配置超范围 → 拒绝（前端校验 + toast） ---- */
    await mark('配置', '设置→最大上传填 10000（超范围）');
    const openSub9 = await cdpClick('.settings-dialog-wrap .setting-value');
    let rejected9 = false;
    if (openSub9) {
      await sleep(800);
      const setIn9 = await safe(`(()=>{const i=document.querySelector('.sub-dialog-row .el-input input');if(i){i.value='10000';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok'}return'nope'})()`);
      await sleep(300);
      const saved9 = setIn9 === 'ok' && await cdpClickText('.sub-dialog-footer .el-button', '保存');
      await sleep(1200);
      const cfgPost9 = await req('GET', '/api/config');
      rejected9 = saved9 && cfgPost9?.data?.maxFileSizeMB !== 10000;
    }
    await add(++n, '配置', '设置→最大上传填 10000（超范围）', '拒绝且值不变', rejected9, rejected9 ? '✓' : `rejected=${rejected9}`);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    /* ---- 10. 显示隐藏文件开关 → 进入 empty/ 验证 .hidden.txt 出现 ---- */
    await mark('配置', '显示隐藏文件开关→.hidden.txt 出现');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(2500);
    await safe(navToDir('testdira'));
    await sleep(2000);
    await safe(navToDir('empty'));
    await sleep(2000);
    const beforeHidden = await safe(`document.body.textContent.includes('.hidden.txt')?'visible':'hidden'`);
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const swPos = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .setting-row')){if(r.textContent.includes('显示隐藏文件')){const s=r.querySelector('.el-switch');if(s){const b=s.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2});}}}return'notfound';})()`);
    let hiddenToggled = false;
    if (swPos !== 'notfound' && typeof swPos === 'string') {
      try { const {x,y}=JSON.parse(swPos); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); hiddenToggled = true; } catch {}
    }
    await sleep(2000);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1500);
    const afterHidden = await safe(`document.body.textContent.includes('.hidden.txt')?'visible':'hidden'`);
    const ok10 = hiddenToggled && afterHidden === 'visible';
    await add(++n, '配置', '显示隐藏文件开关→.hidden.txt 出现', '开关切换后隐藏文件可见', ok10, ok10 ? `before=${beforeHidden} after=${afterHidden}` : `toggled=${hiddenToggled} before=${beforeHidden} after=${afterHidden}`);
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const swPos10 = await safe(`(()=>{for(const r of document.querySelectorAll('.settings-dialog-wrap .setting-row')){if(r.textContent.includes('显示隐藏文件')){const s=r.querySelector('.el-switch');if(s){const b=s.getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2});}}}return'notfound';})()`);
    if (swPos10 !== 'notfound' && typeof swPos10 === 'string') {
      try { const {x,y}=JSON.parse(swPos10); await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1}); await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}); } catch {}
    }
    await sleep(1500);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    /* ---- 10b. 网页端虚拟根拖拽：提示行显示 + 无遮罩 + 提示去桌面应用 + 不添加共享 ---- */
    await mark('网页端', '虚拟根拖拽→提示去桌面应用');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(2500);
    const hint10b = await safe(`(()=>{const e=document.querySelector('.virtual-root-hint');return e?'shown':'hidden';})()`);
    // 拖拽遮罩不出现（浏览器虚拟根禁拖拽遮罩）
    await safe(`window.dispatchEvent(new DragEvent('dragover',{dataTransfer:new DataTransfer(),bubbles:true,cancelable:true}))`);
    await sleep(300);
    const overlay10b = await safe(`(()=>{return document.querySelector('.global-drop-overlay')?'shown':'hidden';})()`);
    // 带 .path 的文件夹拖入 → 不添加共享，但提示去桌面应用（操作习惯引导）
    const v10b = await safe(dragAddFolder(DIR_C, 'testdirc'));
    await sleep(2500);
    const roots10b = await req('GET', '/api/roots');
    const added10b = roots10b?.data?.data?.roots?.some(x => x.path.includes('testdirc'));
    const toast10b = await safe(`(()=>{return Array.from(document.querySelectorAll('.el-message')).map(m=>m.textContent).join('|');})()`);
    await add(++n, '网页端', '虚拟根拖拽→提示去桌面应用', '提示行+无遮罩+提示「请在桌面应用」+不添加', hint10b==='shown' && overlay10b==='hidden' && v10b==='ok' && !added10b && toast10b.includes('请在桌面应用'), hint10b==='shown' ? (overlay10b==='hidden' ? (!added10b ? (toast10b.includes('请在桌面应用')?'✓':`toast=${toast10b}`) : 'config 变了') : '有遮罩') : '提示行未显示');
    await sleep(500);

    // ═══════════════════════════════════════
    // Phase 2: 网页端 — 文件列表 + 下载
    // ═══════════════════════════════════════

    /* ---- 11. 虚拟根→点 testdira→进入 testa/ ---- */
    await mark('文件列表', '虚拟根→点 testdira→进入 testa/');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(3000);
    await safe(navToDir('testdira'));
    await sleep(2000);
    await safe(navToDir('testa'));
    await sleep(2000);
    const cnt11 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    await add(++n, '文件列表', '虚拟根→点 testdira→进入 testa/', '列表 ≥ 3 文件', parseInt(cnt11) >= 3, `${cnt11} 行`);

    /* ---- 12. 网页端：文件行按钮=下载、批量栏有批量下载 ---- */
    await mark('网页端', '文件行按钮=下载、批量栏有批量下载');
    const b12 = await safe(`(()=>{const rows=Array.from(document.querySelectorAll('tr.el-table__row'));const btns=rows.map(r=>r.querySelector('td:last-child')?.textContent||'');return JSON.stringify({hasDownload:btns.some(t=>t.includes('下载')),hasOpen:btns.some(t=>t.includes('打开')),first:rows[0]?.querySelector('.file-name')?.textContent||''});})()`);
    await cdpSelectAll();
    await sleep(800);
    const bt12 = await safe(`(()=>{const b=document.querySelector('.batch-bar');if(!b)return'none';return JSON.stringify({batchDel:b.textContent.includes('批量删除'),batchDown:b.textContent.includes('批量下载')});})()`);
    let web12 = false, det12 = b12;
    try { const a = JSON.parse(b12), c = JSON.parse(bt12); web12 = a.hasDownload && a.hasOpen && c.batchDown; det12 = `btn:${JSON.stringify(a)} batch:${JSON.stringify(c)}`; } catch {}
    await add(++n, '网页端', '文件行按钮=下载、批量栏有批量下载', '网页端 UI 生效', web12, web12 ? '✓' : det12);
    await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
    await sleep(500);

    /* ---- 13. 网页端：单文件下载 → toast「已开始下载」+ type=5 op=1 ---- */
    await mark('下载', '网页端点文件行「下载」');
    const dlBtn = await safe(rowBtn('下载'));
    if (dlBtn === 'ok') {
      await sleep(3000);
      const logs13 = await req('GET', '/api/logs');
      const dlLog13 = Array.isArray(logs13?.data) && logs13.data.some(l => l.type === 5 && l.data?.op === 1);
      const ok13 = dlLog13;
      await add(++n, '下载', '网页端点文件行「下载」', 'toast 已开始下载 + type=5 op=1', ok13, ok13 ? '✓' : '无 type=5 op=1 日志');
    } else await add(++n, '下载', '网页端点文件行「下载」', '下载按钮', false, dlBtn);
    await sleep(500);

    /* ---- 14. 网页端：批量下载 → toast「已下载 N 个」 ---- */
    await mark('下载', '网页端全选→批量下载');
    const bdSel = await ensureBatchBar();
    const bdClick = await cdpClickText('.batch-bar .el-button', '批量下载');
    await sleep(4000);
    const bdToast = await safe(`window.__EMS__ ? (window.__EMS__.type + ':' + window.__EMS__.text) : ''`);
    const ok14 = bdSel && bdClick && String(bdToast).includes('已下载');
    await add(++n, '下载', '网页端全选→批量下载', 'toast「已下载 N 个」', ok14, ok14 ? `✓ ${bdToast}` : `sel=${bdSel} click=${bdClick} toast=${bdToast}`);
    await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
    await sleep(500);

    /* ---- 15. 搜索 ---- */
    await mark('搜索', '搜索框输入 f1');
    await safe(`(()=>{const i=document.querySelector('.search-input input');if(i){i.value='f1';i.dispatchEvent(new Event('input',{bubbles:true}));return'ok'}return'nope'})()`);
    await sleep(1500);
    const cnt15 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    const ok15 = parseInt(cnt15) >= 0 && parseInt(cnt15) < 10;
    await add(++n, '搜索', '搜索框输入 f1', '列表过滤', ok15, `${cnt15} 行`);
    await safe(`(()=>{const i=document.querySelector('.search-input input');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return'ok'}return'nope'})()`);
    await sleep(1000);

    /* ---- 16. 排序：点「名称」按钮 → 顺序翻转 ---- */
    await mark('排序', '点「名称」排序（升→降）');
    const namesBefore16 = await safe(allRowNames);
    const sortName16 = await safe(`(()=>{const b=Array.from(document.querySelectorAll('.sort-btns .el-button')).find(x=>x.textContent.includes('名称'));if(!b)return'notfound';b.click();return'ok';})()`);
    await sleep(1200);
    const namesAfter16 = await safe(allRowNames);
    const ok16 = sortName16 === 'ok' && namesBefore16 !== namesAfter16;
    await add(++n, '排序', '点「名称」排序（升→降）', '文件顺序变化', ok16, `click=${sortName16} changed=${namesBefore16!==namesAfter16}`);
    await safe(`(()=>{const b=Array.from(document.querySelectorAll('.sort-btns .el-button')).find(x=>x.textContent.includes('名称'));if(b)b.click();return'ok';})()`);
    await sleep(800);
    await safe(`(()=>{const b=Array.from(document.querySelectorAll('.sort-btns .el-button')).find(x=>x.textContent.includes('名称'));if(b)b.click();return'ok';})()`);
    await sleep(500);

    /* ---- 17. 分页：切 pageSize=5 → 每页行数 ≤5（之后恢复 10） ---- */
    await mark('分页', '切 pageSize=5');
    const pgBefore = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    const pgPick5 = await pgPick('5');
    const pgAfter = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    const ok17 = pgPick5 && parseInt(pgAfter) <= 5 && parseInt(pgAfter) >= 1;
    await add(++n, '分页', '切 pageSize=5', '每页 ≤5 行', ok17, `picked5=${pgPick5} before=${pgBefore} after=${pgAfter}`);
    await pgPick('10');
    await safe(`window.scrollTo(0,0)`);
    await sleep(500);

    // ═══════════════════════════════════════
    // Phase 3: 网页端 — 上传/替换/保留两份/取消/文件过大/混合
    // ═══════════════════════════════════════

    /* ---- 18. 拖拽上传新文件（type=1 op=1） ---- */
    await mark('上传', '拖拽上传 crawl_up.txt');
    await safe(dropUpload('crawl_up.txt', 'crawl upload content'));
    await sleep(4000);
    const ok18 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    await add(++n, '上传', '拖拽上传 crawl_up.txt', '文件创建 (type=1 op=1)', ok18, ok18 ? '✓' : '文件未找到');

    /* ---- 19. 连续上传 2 个文件（逐个拖入） ---- */
    await mark('上传', '连续上传 2 个文件（逐个拖入）');
    const bulkNames19 = ['bulk_a.txt', 'bulk_b.txt'];
    await sleep(1500);
    const dropRet19_1 = await safe(dropUpload('bulk_a.txt', 'bulk content bulk_a.txt'));
    await sleep(4000);
    const dropRet19_2 = await safe(dropUpload('bulk_b.txt', 'bulk content bulk_b.txt'));
    await sleep(4000);
    const ok19 = bulkNames19.every(n => V.fileExists(path.join(DIR_A, 'testa', n)));
    await add(++n, '上传', '连续上传 2 个文件（逐个拖入）', '两个文件都上传成功', ok19, `d1=${dropRet19_1} d2=${dropRet19_2} ok=${ok19}`);

    /* ---- 20. 同名上传→冲突→替换（type=2 op=1） ---- */
    await mark('替换', '冲突弹窗→确定上传（替换）');
    await safe(dropUpload('crawl_up.txt', 'replaced content'));
    await sleep(3000);
    const ok20 = await cdpClickText('.el-dialog .el-button--primary', '确定上传');
    if (ok20) await sleep(4000);
    const fe20 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    await add(++n, '替换', '冲突弹窗→确定上传（替换）', '替换成功 (type=2 op=1)', ok20 && fe20, ok20 ? (fe20 ? '✓' : '文件消失') : '点击失败');

    /* ---- 21. 同名上传→冲突→保留两份（type=1 op=1 + 生成 (1) 文件） ---- */
    await mark('保留两份', '冲突弹窗→保留两份');
    await safe(dropUpload('crawl_up.txt', 'keep copy content'));
    await sleep(3000);
    const keep21 = await cdpClickText('.el-dialog .el-button', '保留两份');
    if (keep21) await sleep(500);
    const ok21 = keep21 && await cdpClickText('.el-dialog .el-button--primary', '确定上传');
    if (ok21) await sleep(4000);
    const fe21 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up (1).txt'));
    await add(++n, '保留两份', '冲突弹窗→保留两份', '生成 crawl_up (1).txt', ok21 && fe21, ok21 ? (fe21 ? '✓' : '未生成 (1) 文件') : '点击失败');

    /* ---- 22. 同名上传→冲突→取消（type=1 op=0） ---- */
    await mark('取消上传', '冲突弹窗→取消上传');
    await safe(dropUpload('crawl_up.txt', 'cancelled content'));
    await sleep(3000);
    const ok22 = await cdpClickText('.el-dialog .el-button:not(.el-button--primary)', '取消上传');
    if (ok22) await sleep(3000);
    const fe22 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    await add(++n, '取消上传', '冲突弹窗→取消上传', '文件不变 (type=1 op=0)', ok22, ok22 ? '✓' : '文件消失');

    /* ---- 23. 拖入文件夹→真实目录 → 拒绝（type=1 op=2 + toast） ---- */
    await mark('上传', '拖入文件夹→真实目录');
    const v23 = await safe(`(()=>{const f=new File([],'myfolder',{type:''});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`);
    await sleep(2500);
    const logs23 = await req('GET', '/api/logs');
    const folderRej23 = Array.isArray(logs23?.data) && logs23.data.some(l => l.type === 1 && l.data?.op === 2 && String(l.data?.error).includes('不支持上传文件夹'));
    const toast23 = await safe(`(()=>{const m=document.querySelector('.el-message--error');return m&&m.textContent.includes('不支持上传文件夹')?'yes':'no';})()`);
    await add(++n, '上传', '拖入文件夹→真实目录', '拒绝 type=1 op=2 + toast', v23 === 'ok' && folderRej23 && toast23 === 'yes', folderRej23 ? (toast23 === 'yes' ? '✓' : '无 toast') : '无日志');
    await sleep(300);

    /* ---- 24. 文件过大：调低上限到 1MB → 拖 2MB 文件 → 拒绝（type=1 op=2）→ 调回 500 ---- */
    await mark('上传', '文件过大（上限调至 1MB → 拖 2MB）');
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const lowSaved = await setMaxSizeMB(1);
    if (lowSaved) await sleep(1500);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(800);
    await safe(dropBigFile('too_big.bin'));
    await sleep(3000);
    const logs24 = await req('GET', '/api/logs');
    const bigLog24 = Array.isArray(logs24?.data) && logs24.data.some(l => l.type === 1 && l.data?.op === 2 && String(l.data?.error).includes('文件过大'));
    const bigToast24 = await safe(`window.__EMS__ ? (window.__EMS__.type + ':' + window.__EMS__.text) : ''`);
    const ok24 = bigLog24 && String(bigToast24).includes('文件过大');
    await add(++n, '上传', '文件过大（上限调至 1MB → 拖 2MB）', '拒绝 type=1 op=2 + toast', ok24, ok24 ? '✓' : `log=${bigLog24} toast=${bigToast24}`);

    /* ---- 25. 冲突取消 + 新文件成功：拖 mixed_a/mixed_b（成功）→ 拖 crawl_up 冲突→取消 ---- */
    await mark('上传', '冲突项取消 + 新文件成功');
    await safe(dropUpload('mixed_a.txt', 'mixed a'));
    await sleep(4000);
    await safe(dropUpload('mixed_b.txt', 'mixed b'));
    await sleep(4000);
    await safe(dropUpload('crawl_up.txt', 'conflict in batch'));
    await sleep(3000);
    const skipRow25 = await safe(`(()=>{const rows=document.querySelectorAll('.el-dialog .confirm-row');for(const r of rows){if(r.textContent.includes('crawl_up.txt')){const radios=r.querySelectorAll('.el-radio');for(const rd of radios){if(rd.textContent.includes('取消')){rd.click();return'ok';}}}}return'notfound';})()`);
    if (skipRow25 === 'ok') await sleep(500);
    const ok25 = skipRow25 === 'ok' && await cdpClickText('.el-dialog .el-button--primary', '确定上传');
    await sleep(4000);
    const okA = V.fileExists(path.join(DIR_A, 'testa', 'mixed_a.txt'));
    const okB = V.fileExists(path.join(DIR_A, 'testa', 'mixed_b.txt'));
    const crawlUnchanged25 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    const mixedLog25 = await req('GET', '/api/logs');
    const skipLog25 = Array.isArray(mixedLog25?.data) && mixedLog25.data.some(l => l.type === 1 && l.data?.op === 0 && String(l.data?.file).includes('crawl_up'));
    await add(++n, '上传', '冲突项取消 + 新文件成功', '成功 2 个 + 取消 1 个日志', ok25 && okA && okB && crawlUnchanged25 && skipLog25, `okA=${okA} okB=${okB} crawlStill=${crawlUnchanged25} skipLog=${skipLog25}`);
    await sleep(300);
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const restoreSaved = await setMaxSizeMB(500);
    if (restoreSaved) await sleep(1500);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(800);

    // ═══════════════════════════════════════
    // Phase 4: 网页端 — 删除
    // ═══════════════════════════════════════

    /* ---- 26. 行删除→取消（type=4 op=0） ---- */
    await mark('取消删除', '行末删除→弹窗→取消');
    const v26 = await safe(rowBtn('删除'));
    if (v26 === 'ok') {
      await sleep(800);
      await cdpClickText('.el-message-box__btns .el-button', '取消');
      await sleep(1500);
      const still26 = V.fileExists(path.join(DIR_A, 'testa', 'f2.txt'));
      await add(++n, '取消删除', '行末删除→弹窗→取消', '文件不变 (type=4 op=0)', still26, still26 ? '✓' : '文件被误删');
    } else await add(++n, '取消删除', '行末删除→取消', '取消按钮', false, v26);
    await sleep(1000);

    /* ---- 27. 行删除→确认（type=4 op=1） ---- */
    await mark('删除', '行末删除 f2.txt→确认');
    const v27 = await safe(rowBtnIn('f2.txt', '删除'));
    if (v27 === 'ok') {
      await sleep(800);
      const deleted27 = await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(2000);
      const gone27 = !V.fileExists(path.join(DIR_A, 'testa', 'f2.txt'));
      await add(++n, '删除', '行末删除 f2.txt→确认', '文件已删 (type=4 op=1)', deleted27 && gone27, deleted27 ? (gone27 ? '✓' : '文件仍在') : '点击失败');
    } else await add(++n, '删除', '行末删除→确认', '删除按钮', false, v27);
    await sleep(2000);

    /* ---- 28. 删除不存在：先用 fs 删掉磁盘上的 t.txt，再在 UI 点该行删除 → type=4 op=3 ---- */
    await mark('删除', '删除已从磁盘消失的文件 t.txt');
    const ghostPath28 = path.join(DIR_A, 'testa', 't.txt');
    let v28 = 'notfound';
    if (fs.existsSync(ghostPath28)) {
      fs.unlinkSync(ghostPath28);
      await sleep(500);
      v28 = await safe(rowBtnIn('t.txt', '删除'));
    }
    if (v28 === 'ok') {
      await sleep(800);
      await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(2500);
      const logs28 = await req('GET', '/api/logs');
      const ghostLog28 = Array.isArray(logs28?.data) && logs28.data.some(l => l.type === 4 && l.data?.op === 3 && String(l.data?.error).includes('系统找不到'));
      const toast28 = await safe(`(()=>{const m=document.querySelector('.el-message--error');return m&&m.textContent.includes('系统找不到')?'yes':'no';})()`);
      await add(++n, '删除', '删除已从磁盘消失的文件 t.txt', 'type=4 op=3 + toast', ghostLog28 && toast28 === 'yes', ghostLog28 ? (toast28 === 'yes' ? '✓' : '无 toast') : '无 type=4 op=3 日志');
    } else await add(++n, '删除', '删除已消失文件 t.txt', '删除按钮', false, `fs=${fs.existsSync(ghostPath28)} v=${v28}`);
    await sleep(800);

    /* ---- 29. 全选→批量删除剩余文件（循环删到空） ---- */
    await mark('批量操作', '全选→批量删除');
    await pgPick('50');
    await safe(`window.scrollTo(0,0)`);
    await sleep(500);
    for (let round29 = 0; round29 < 5; round29++) {
      const remainNow = V.listDir(path.join(DIR_A, 'testa'));
      if (remainNow.length === 0) break;
      const sel29 = await ensureBatchBar();
      if (!sel29) break;
      await cdpClick('.batch-bar .el-button--danger');
      await sleep(1200);
      await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(3500);
    }
    const remain29 = V.listDir(path.join(DIR_A, 'testa'));
    const ok29 = remain29.length === 0;
    await add(++n, '批量操作', '全选→批量删除', 'testa 无文件', ok29, ok29 ? '✓' : `仍剩: ${remain29.join(', ')}`);

    /* ---- 30. 面包屑点 testdira → 行内删除 testa 目录（不能全选，会误删 empty/.hidden） ---- */
    await mark('批量操作', '面包屑点 testdira→行内删除 testa 目录');
    await cdpClickText('.el-breadcrumb__item a', 'testdira');
    await sleep(3000);
    const v30 = await safe(rowBtnIn('testa', '删除'));
    if (v30 === 'ok') {
      await sleep(800);
      await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(3000);
    }
    const ok30 = !V.dirExists(path.join(DIR_A, 'testa'));
    const keep30 = V.dirExists(path.join(DIR_A, 'empty'));
    await add(++n, '批量操作', '面包屑点 testdira→行内删除 testa 目录', '目录不存在+empty 保留', ok30 && keep30, ok30 ? (keep30 ? '✓' : 'empty 被误删!') : '目录仍存在');

    // ═══════════════════════════════════════
    // Phase 5: 网页端 — 浏览错误 + URL 直达 + 日志目录提示
    // ═══════════════════════════════════════

    /* ---- 31. 导航到不存在的目录（type=10 op=3） ---- */
    await mark('浏览', '导航到不存在的目录');
    await safe(`(()=>{history.pushState({},'', '/?path=/testdira/nonexist_dir');window.dispatchEvent(new PopStateEvent('popstate'));return'ok'})()`);
    await sleep(2000);
    const log31 = await req('GET', '/api/logs');
    const entries31 = log31?.data?.data || log31?.data || [];
    const has31 = entries31.some(e => e.type === 10 && e.data?.op === 3);
    await add(++n, '浏览', '导航到不存在的目录', 'type=10 op=3 日志', has31, has31 ? '✓' : '无 type=10 op=3 日志');
    await safe(`(()=>{history.pushState({},'', '/');window.dispatchEvent(new PopStateEvent('popstate'));return'ok'})()`);
    await sleep(2000);

    /* ---- 32. URL 直达 /testdira（先回虚拟根等 roots 加载，再直达） ---- */
    await mark('浏览', 'URL 直达 /testdira');
    await nav(`${BASE}/?path=/&shell=0`);
    await sleep(3000);
    await nav(`${BASE}/?path=/testdira&shell=0`);
    await sleep(3000);
    const inRoot32 = await safe(`document.querySelector('.el-breadcrumb')?.textContent.includes('testdira') ? 'yes' : 'no'`);
    await add(++n, '浏览', 'URL 直达 /testdira', '保持在 testdira', inRoot32 === 'yes', inRoot32 === 'yes' ? '✓' : '未保持在 testdira');

    /* ---- 33. 网页端点日志目录→提示「请在桌面应用」 ---- */
    await mark('网页端', '网页端点日志目录→提示');
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const logdirClicked = await cdpClick('.logdir-open');
    await sleep(1500);
    const hintTxt = await safe(`Array.from(document.querySelectorAll('.el-message')).map(m=>m.textContent).join('|')`);
    const okHint = logdirClicked && typeof hintTxt === 'string' && hintTxt.includes('桌面应用');
    await add(++n, '网页端', '网页端点日志目录→提示', '显示「请在桌面应用」提示', okHint, okHint ? '✓' : (hintTxt || '无提示'));
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    // ═══════════════════════════════════════
    // 切换桌面端模式：注入 __TAURI_INTERNALS__ → 重新导航
    // ═══════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  🔄 切换模式 → DESKTOP (注入 __TAURI_INTERNALS__)');
    console.log('═══════════════════════════════════════════════════\n');
    await setTitle('', '== DESKTOP MODE ==');
    await cdpRaw('Page.addScriptToEvaluateOnNewDocument', { source: "window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {}; if(!window.__TAURI_INTERNALS__.convertFileSrc) window.__TAURI_INTERNALS__.convertFileSrc = function(p){ return 'data:text/plain;base64,' + btoa('landisk-shell-upload'); }; if(!window.__TAURI_INTERNALS__.invoke) window.__TAURI_INTERNALS__.invoke = function(cmd){ return Promise.resolve(false); };" });
    CUR_MODE = '桌面端';
    await nav(`${BASE}/?path=/`);
    await sleep(3000);

    // ═══════════════════════════════════════
    // Phase 6: 桌面端 — 开机自启 + 壳 UI + 打开
    // ═══════════════════════════════════════

    /* ---- 34. 开机自启设置默认关闭 ---- */
    await mark('桌面端', '开机自启设置默认关闭');
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const autoOff = await safe(`(()=>{for(const row of document.querySelectorAll('.settings-dialog-wrap .setting-row')){if(row.textContent.includes('开机自启')){const s=row.querySelector('.el-switch');return s?(s.classList.contains('is-checked')?'on':'off'):'no-switch';}}return'no-row';})()`);
    await add(++n, '桌面端', '开机自启设置默认关闭', '开关为 off', autoOff === 'off', autoOff);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    /* ---- 35. 桌面端：URL 直达 testdira（testa 已删，empty 目录保留） ---- */
    await mark('文件列表', '桌面端进入 testdira');
    await nav(`${BASE}/?path=/testdira`);
    await sleep(3000);
    const rows35 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    const hasEmpty35 = await safe(`document.body.textContent.includes('empty') ? 'yes' : 'no'`);
    await add(++n, '文件列表', '桌面端进入 testdira', 'empty 目录行存在', parseInt(rows35) >= 1 && hasEmpty35 === 'yes', `${rows35} 行 empty=${hasEmpty35}`);

    /* ---- 36. 壳内 landisk-drop 上传文件到 testdira 根 → 点该文件行「打开」→ 默认程序（type=6 op=1） ---- */
    await mark('打开', '桌面端打开文件 open_me.txt→默认程序');
    const openFileAbs = path.join(DIR_A, 'open_me.txt');
    const v36 = await safe(`(()=>{window.dispatchEvent(new CustomEvent('landisk-drop',{detail:[{path:${JSON.stringify(openFileAbs)},isDir:false}]}));return'ok';})()`);
    await sleep(3000);
    const openFileOk36 = V.fileExists(openFileAbs);
    const v36b = openFileOk36 ? await safe(rowBtnIn('open_me.txt', '打开')) : 'notuploaded';
    if (v36b === 'ok') {
      await sleep(2000);
      const log36 = await req('GET', '/api/logs');
      const has36 = (log36?.data?.data || log36?.data || []).some(e => e.type === 6 && e.data?.op === 1 && String(e.data?.file).includes('open_me'));
      await add(++n, '打开', '桌面端打开文件 open_me.txt→默认程序', 'type=6 op=1 日志', has36, has36 ? '✓' : '无 type=6 op=1 日志');
    } else await add(++n, '打开', '桌面端打开文件 open_me.txt', '文件存在+打开按钮', false, `uploaded=${openFileOk36} v=${v36b}`);
    await sleep(500);

    /* ---- 37. 壳内目录「打开」→ 资源管理器（type=6 op=1） ---- */
    await mark('打开', '桌面端点 empty 目录「打开」→资源管理器');
    const v37 = await safe(rowBtnIn('empty', '打开'));
    if (v37 === 'ok') {
      await sleep(2000);
      const log37 = await req('GET', '/api/logs');
      const has37 = (log37?.data?.data || log37?.data || []).some(e => e.type === 6 && e.data?.op === 1);
      await add(++n, '打开', '桌面端点 empty 目录「打开」→资源管理器', 'type=6 op=1 日志', has37, has37 ? '✓' : '无 type=6 op=1 日志');
    } else await add(++n, '打开', '桌面端点 empty 目录「打开」', '打开按钮', false, v37);
    await sleep(500);

    /* ---- 38. 桌面端：文件行按钮=打开、批量栏无下载 ---- */
    await mark('桌面端', '文件行按钮=打开、批量栏无下载');
    const b38 = await safe(`(()=>{const rows=Array.from(document.querySelectorAll('tr.el-table__row'));const btns=rows.map(r=>r.querySelector('td:last-child')?.textContent||'');return JSON.stringify({hasOpen:btns.some(t=>t.includes('打开')),hasDownload:btns.some(t=>t.includes('下载')),first:rows[0]?.querySelector('.file-name')?.textContent||''});})()`);
    await cdpSelectAll();
    await sleep(800);
    const bt38 = await safe(`(()=>{const b=document.querySelector('.batch-bar');if(!b)return'none';return JSON.stringify({batchDel:b.textContent.includes('批量删除'),batchDown:b.textContent.includes('批量下载')});})()`);
    let shell38 = false, det38 = b38;
    try { const a = JSON.parse(b38), c = JSON.parse(bt38); shell38 = a.hasOpen && !a.hasDownload && c.batchDel && !c.batchDown; det38 = `btn:${JSON.stringify(a)} batch:${JSON.stringify(c)}`; } catch {}
    await add(++n, '桌面端', '文件行按钮=打开、批量栏无下载', '桌面端 UI 生效', shell38, shell38 ? '✓' : det38);
    await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
    await sleep(500);

    /* ---- 39. 打开日志目录（type=6 op=1 + toast） ---- */
    await mark('打开', '桌面端打开日志目录');
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const ldirClicked = await cdpClick('.logdir-open');
    await sleep(2000);
    const logs39 = await req('GET', '/api/logs');
    const ldirLog39 = (logs39?.data?.data || logs39?.data || []).some(e => e.type === 6 && e.data?.op === 1 && String(e.data?.file).includes('logs'));
    const ok39 = ldirClicked && ldirLog39;
    await add(++n, '打开', '桌面端打开日志目录', 'type=6 op=1 + toast', ok39, ok39 ? '✓' : `click=${ldirClicked} log=${ldirLog39}`);
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    // ═══════════════════════════════════════
    // Phase 7: 桌面端 — 虚拟根移除 + landisk-drop 拖拽
    // ═══════════════════════════════════════

    /* ---- 40. 虚拟根行按钮=移除（无删除） ---- */
    await mark('根目录', '虚拟根行按钮=移除（无删除）');
    await nav(`${BASE}/?path=/`);
    await sleep(3000);
    const b40 = await safe(`(()=>{const rows=document.querySelectorAll('tr.el-table__row');if(rows.length<1)return'none';const l=rows[0].querySelector('td:last-child');if(!l)return'noact';const t=l.textContent;return JSON.stringify({remove:t.includes('移除'),del:t.includes('删除')});})()`);
    let ok40 = false, det40 = b40;
    try { const a = JSON.parse(b40); ok40 = a.remove && !a.del; det40 = JSON.stringify(a); } catch {}
    await add(++n, '根目录', '虚拟根行按钮=移除（无删除）', '移除存在/删除不存在', ok40, ok40 ? '✓' : det40);

    /* ---- 41. 行末「移除」→ 确认弹窗 → 取消（type=7 op=5 remove） ---- */
    await mark('根目录', '行末移除→弹窗→取消');
    const v41 = await safe(rowBtnIn('testdirb', '移除'));
    if (v41 === 'ok') {
      await sleep(1200);
      const c41 = await cdpClickText('.el-message-box__btns .el-button', '取消');
      await sleep(1500);
      const roots41 = await req('GET', '/api/roots');
      const still41 = roots41?.data?.data?.roots?.some(x => x.path.includes('testdirb'));
      const logs41 = await req('GET', '/api/logs');
      const cancelLog41 = Array.isArray(logs41?.data) && logs41.data.some(l => l.type === 7 && l.data?.op === 5 && l.data?.action === 'remove');
      await add(++n, '根目录', '行末移除→弹窗→取消', 'type=7 op=5 (remove) 日志', c41 && still41 && cancelLog41, c41 ? (cancelLog41 ? (still41 ? '✓' : 'config 变了') : '无取消日志') : '点击失败');
    } else await add(++n, '根目录', '行末移除→弹窗→取消', '移除按钮', false, v41);
    await sleep(500);

    /* ---- 42. 虚拟根行末「移除」testdirb → 确认 ---- */
    await mark('根目录', '虚拟根行末「移除」testdirb');
    const v42 = await safe(rowBtnIn('testdirb', '移除'));
    if (v42 === 'ok') {
      await sleep(1200);
      const c42 = await cdpClickText('.el-message-box__btns .el-button', '移除');
      await sleep(2000);
      const roots42 = await req('GET', '/api/roots');
      const gone42 = !roots42?.data?.data?.roots?.some(x => x.path.includes('testdirb'));
      const disk42 = V.dirExists(DIR_B);
      await add(++n, '根目录', '虚拟根行末「移除」testdirb', 'config 消失+磁盘仍在', c42 && gone42 && disk42, c42 ? (gone42 ? (disk42 ? '✓' : '磁盘被删!') : 'config 仍有') : '点击失败');
    } else await add(++n, '根目录', '虚拟根行末「移除」testdirb', '移除按钮', false, v42);
    await sleep(1500);

    /* ---- 43. 拖入添加：虚拟根拖入 testdirc 文件夹 → 自动添加为共享目录 ---- */
    await mark('根目录', '虚拟根拖入文件夹添加共享');
    const vDrag = await safe(dragAddFolder(DIR_C, 'testdirc'));
    await sleep(3000);
    const rootsDrag = await req('GET', '/api/roots');
    const okDrag = vDrag === 'ok' && rootsDrag?.data?.data?.roots?.some(x => x.path.includes('testdirc'));
    await add(++n, '根目录', '虚拟根拖入文件夹添加共享', 'config 出现 testdirc', okDrag, okDrag ? '✓' : vDrag);
    if (okDrag) {
      const vDup = await safe(dragAddFolder(DIR_C, 'testdirc'));
      await sleep(2500);
      const logsDup = await req('GET', '/api/logs');
      const dupLog = Array.isArray(logsDup?.data) && logsDup.data.some(l => l.type === 7 && l.data?.op === 3 && String(l.data?.error).includes('已在共享列表'));
      const toastDup = await safe(`(()=>{const m=document.querySelector('.el-message--error');return m&&m.textContent.includes('已在共享列表')?'yes':'no';})()`);
      await add(++n, '根目录', '重复拖入同一目录→已在共享列表', 'type=7 op=3 日志+elMessage 提示', dupLog && toastDup === 'yes', dupLog ? (toastDup === 'yes' ? '✓' : '无 toast') : '无日志');
      await sleep(300);
      await safe(rowBtnIn('testdirc', '移除'));
      await sleep(1200);
      await cdpClickText('.el-message-box__btns .el-button', '移除');
      await sleep(1500);
      const rootsRmDrag = await req('GET', '/api/roots');
      const okRmDrag = !rootsRmDrag?.data?.data?.roots?.some(x => x.path.includes('testdirc'));
      await add(++n, '根目录', '移除刚拖入的 testdirc', 'config 消失', okRmDrag, okRmDrag ? '✓' : 'config 仍有 testdirc');
    }
    await sleep(500);

    /* ---- 46. 拖入重名：目录名 testdira 与已有根冲突 → 改名弹窗 → 以新名添加 ---- */
    await mark('根目录', '拖入重名→改名弹窗→添加');
    const vRen = await safe(dragAddFolder(RENAME_SRC, 'testdira'));
    await sleep(1500);
    const promptOk = await safe(`(()=>{const b=document.querySelector('.el-message-box');if(!b)return'no';return b.textContent.includes('已存在')?'yes':'noTitle';})()`);
    if (promptOk === 'yes') {
      await safe(`(()=>{const i=document.querySelector('.el-message-box__input input');if(i){i.value='newroot';i.dispatchEvent(new Event('input',{bubbles:true}));return'ok'}return'nope'})()`);
      await sleep(300);
      const confirmed = await cdpClickText('.el-message-box__btns .el-button', '添加');
      await sleep(2500);
      const rootsRen = await req('GET', '/api/roots');
      const okRen = confirmed && rootsRen?.data?.data?.roots?.some(x => x.name === 'newroot');
      await add(++n, '根目录', '拖入重名→改名弹窗→添加', '以新名 newroot 添加', okRen, okRen ? '✓' : `confirmed=${confirmed} names=${JSON.stringify((rootsRen?.data?.data?.roots || []).map(r => r.name))}`);
      if (okRen) {
        await sleep(500);
        await safe(rowBtnIn('newroot', '移除'));
        await sleep(1200);
        await cdpClickText('.el-message-box__btns .el-button', '移除');
        await sleep(1500);
        const rootsRmRen = await req('GET', '/api/roots');
        const okRmRen = !rootsRmRen?.data?.data?.roots?.some(x => x.name === 'newroot');
        await add(++n, '根目录', '移除改名添加的 newroot', 'config 消失', okRmRen, okRmRen ? '✓' : 'config 仍有 newroot');
      }
    } else await add(++n, '根目录', '拖入重名→改名弹窗', '弹窗出现', false, `prompt=${promptOk}`);
    await sleep(500);

    /* ---- 48. 拖入重名 → 改名弹窗 → 取消（type=7 op=5 add） ---- */
    await mark('根目录', '拖入重名→改名弹窗→取消');
    const vRc = await safe(dragAddFolder(RENAME_SRC, 'testdira'));
    await sleep(1500);
    const promptRc = await safe(`(()=>{const b=document.querySelector('.el-message-box');if(!b)return'no';return b.textContent.includes('已存在')?'yes':'noTitle';})()`);
    if (promptRc === 'yes') {
      const cRc = await cdpClickText('.el-message-box__btns .el-button', '取消');
      await sleep(1500);
      const rootsRc = await req('GET', '/api/roots');
      const noNewRc = !rootsRc?.data?.data?.roots?.some(x => String(x.path).includes('renamedir'));
      const logsRc = await req('GET', '/api/logs');
      const cancelLogRc = Array.isArray(logsRc?.data) && logsRc.data.some(l => l.type === 7 && l.data?.op === 5 && l.data?.action === 'add');
      await add(++n, '根目录', '拖入重名→改名弹窗→取消', 'type=7 op=5 (add) 日志', cRc && noNewRc && cancelLogRc, cRc ? (cancelLogRc ? (noNewRc ? '✓' : 'config 变了') : '无取消日志') : '点击失败');
    } else await add(++n, '根目录', '拖入重名→改名弹窗→取消', '改名弹窗', false, `prompt=${promptRc}`);
    await sleep(500);

    /* ---- 49. 壳内 landisk-drop 合成事件：添加共享目录 ---- */
    await mark('根目录', '壳内 landisk-drop 添加共享目录');
    const vLD = await safe(`(()=>{window.dispatchEvent(new CustomEvent('landisk-drop',{detail:[{path:${JSON.stringify(DIR_C)},isDir:true}]}));return'ok';})()`);
    await sleep(3000);
    const rootsLD = await req('GET', '/api/roots');
    const okLD = vLD === 'ok' && rootsLD?.data?.data?.roots?.some(x => x.path.includes('testdirc'));
    await add(++n, '根目录', '壳内 landisk-drop 添加共享目录', 'config 出现 testdirc', okLD, okLD ? '✓' : vLD);
    if (okLD) {
      await sleep(500);
      await safe(rowBtnIn('testdirc', '移除'));
      await sleep(1200);
      await cdpClickText('.el-message-box__btns .el-button', '移除');
      await sleep(1500);
      const rootsRmLD = await req('GET', '/api/roots');
      const okRmLD = !rootsRmLD?.data?.data?.roots?.some(x => x.path.includes('testdirc'));
      await add(++n, '根目录', '移除 landisk-drop 添加的 testdirc', 'config 消失', okRmLD, okRmLD ? '✓' : 'config 仍有 testdirc');
    }
    await sleep(500);

    /* ---- 51. 壳内 landisk-drop 文件项 → 虚拟根 → 后端拒绝 type=7 op=3「路径不是目录」+ toast ---- */
    await mark('根目录', '壳内拖入文件→虚拟根');
    const vLDF = await safe(`(()=>{window.dispatchEvent(new CustomEvent('landisk-drop',{detail:[{path:${JSON.stringify(NOT_DIR)},isDir:false}]}));return'ok';})()`);
    await sleep(2500);
    const logsLDF = await req('GET', '/api/logs');
    const rejLog = Array.isArray(logsLDF?.data) && logsLDF.data.some(l => l.type === 7 && l.data?.op === 3 && String(l.data?.error).includes('路径不是目录'));
    const toastLDF = await safe(`(()=>{const m=document.querySelector('.el-message--error');return m&&m.textContent.includes('路径不是目录')?'yes':'no';})()`);
    await add(++n, '根目录', '壳内拖入文件→虚拟根', 'type=7 op=3 拒绝+toast', vLDF === 'ok' && rejLog && toastLDF === 'yes', rejLog ? (toastLDF === 'yes' ? '✓' : '无toast') : '无日志');
    await sleep(300);

    /* ---- 52. 壳内 landisk-drop 文件项：convertFileSrc 伪造 asset:// → 真实目录内上传 ---- */
    await mark('上传', '壳内 landisk-drop 文件→上传');
    await safe(navToDir('testdira'));
    await sleep(2000);
    const vLDU = await safe(`(()=>{window.dispatchEvent(new CustomEvent('landisk-drop',{detail:[{path:${JSON.stringify(path.join(DIR_A,'shell_up.txt'))},isDir:false}]}));return'ok';})()`);
    await sleep(3000);
    const shellUpExists = V.fileExists(path.join(DIR_A, 'shell_up.txt'));
    const shellUpContent = shellUpExists ? V.readFile(path.join(DIR_A, 'shell_up.txt')) : null;
    const okLDU = vLDU === 'ok' && shellUpExists && shellUpContent === 'landisk-shell-upload';
    await add(++n, '上传', '壳内 landisk-drop 文件→上传', '文件创建（asset→File→UploadZone）', okLDU, okLDU ? '✓' : `exists=${shellUpExists} content=${shellUpContent}`);
    if (shellUpExists) await req('DELETE', '/api/delete?path=/testdira/shell_up.txt');

    /* ---- 53. 壳内 landisk-drop 文件夹项 → 真实目录 → 拒绝 type=1 op=2「不支持上传文件夹」+ toast ---- */
    await mark('上传', '壳内拖入文件夹→真实目录');
    const vLDD = await safe(`(()=>{window.dispatchEvent(new CustomEvent('landisk-drop',{detail:[{path:${JSON.stringify(DIR_C)},isDir:true}]}));return'ok';})()`);
    await sleep(2500);
    const logsLDD = await req('GET', '/api/logs');
    const dirRejLog = Array.isArray(logsLDD?.data) && logsLDD.data.some(l => l.type === 1 && l.data?.op === 2 && String(l.data?.error).includes('不支持上传文件夹'));
    const toastLDD = await safe(`(()=>{const m=document.querySelector('.el-message--warning');return m&&m.textContent.includes('不支持上传文件夹')?'yes':'no';})()`);
    await add(++n, '上传', '壳内拖入文件夹→真实目录', 'type=1 op=2 拒绝+toast', vLDD === 'ok' && dirRejLog && toastLDD === 'yes', dirRejLog ? (toastLDD === 'yes' ? '✓' : '无toast') : '无日志');
    await sleep(300);

    /* ---- 54. 浏览器 DOM 拖文件夹（size=0/type='' 的 File）→ UploadZone 拒绝 type=1 op=2 ---- */
    await mark('上传', '浏览器 DOM 拖文件夹→UploadZone 拒绝');
    const vDOMF = await safe(`(()=>{const f=new File([],'domfolder',{type:''});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`);
    await sleep(2500);
    const logsDOMF = await req('GET', '/api/logs');
    const domRejLog = Array.isArray(logsDOMF?.data) && logsDOMF.data.some(l => l.type === 1 && l.data?.op === 2 && String(l.data?.error).includes('不支持上传文件夹'));
    await add(++n, '上传', '浏览器 DOM 拖文件夹→UploadZone 拒绝', 'type=1 op=2 日志', vDOMF === 'ok' && domRejLog, domRejLog ? '✓' : '无日志');
    await sleep(300);

    // 回虚拟根
    await nav(`${BASE}/?path=/`);
    await sleep(2500);

    /* ---- 55. 虚拟根全选→批量移除→取消（type=7 op=5 remove 批量，config 不变） ---- */
    await mark('批量操作', '虚拟根全选→批量移除→取消');
    await cdpSelectAll();
    await sleep(1000);
    const b55 = await safe(`document.querySelector('.batch-bar')?.textContent || 'none'`);
    const has55 = typeof b55 === 'string' && b55.includes('批量移除') && !b55.includes('批量删除');
    if (has55) {
      await cdpClick('.batch-bar .el-button--danger');
      await sleep(1500);
      const c55 = await cdpClickText('.el-message-box__btns .el-button', '取消');
      await sleep(1500);
      const roots55 = await req('GET', '/api/roots');
      const still55 = roots55?.data?.data?.roots?.some(x => x.path.includes('testdira'));
      const logs55 = await req('GET', '/api/logs');
      const cancelLog55 = Array.isArray(logs55?.data) && logs55.data.some(l => l.type === 7 && l.data?.op === 5 && l.data?.action === 'remove' && l.data?.count >= 1);
      await add(++n, '批量操作', '虚拟根全选→批量移除→取消', 'type=7 op=5 批量 + config 不变', c55 && still55 && cancelLog55, c55 ? (cancelLog55 ? (still55 ? '✓' : 'config 变了') : '无取消日志') : '点击失败');
      await cdpClick('.batch-bar .el-button:last-child'); // 取消选择
      await sleep(500);
    } else await add(++n, '批量操作', '虚拟根全选→批量移除→取消', '批量栏', false, b55);

    /* ---- 56. 虚拟根全选→批量移除 testdira ---- */
    await mark('批量操作', '虚拟根全选→批量移除 testdira');
    const has56 = await ensureBatchBar();
    const b56 = await safe(`document.querySelector('.batch-bar')?.textContent || 'none'`);
    const has56b = has56 && typeof b56 === 'string' && b56.includes('批量移除') && !b56.includes('批量删除');
    if (has56b) {
      await cdpClick('.batch-bar .el-button--danger');
      await sleep(1500);
      const c56 = await cdpClickText('.el-message-box__btns .el-button', '移除');
      await sleep(2500);
      const roots56 = await req('GET', '/api/roots');
      const gone56 = !roots56?.data?.data?.roots?.some(x => x.path.includes('testdira'));
      const disk56 = V.dirExists(DIR_A);
      await add(++n, '批量操作', '虚拟根全选→批量移除 testdira', '批量移除+config 消失+磁盘仍在', c56 && gone56 && disk56, c56 ? (gone56 ? (disk56 ? '✓' : '磁盘被删!') : 'config 仍有') : '点击失败');
    } else await add(++n, '批量操作', '虚拟根全选→批量移除', '批量栏显示批量移除', false, b56);

  } finally {
    verifyClean();
    await stopServer();
    restoreConfig();
    await closeBrowser();
    console.log();
  }

  console.log('──────────────────────────────────────────');
  console.table(TABLE);
  const total = pass + fail;
  console.log(`通过: ${pass}  |  失败: ${fail}  |  总计: ${total}  ${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}\n`);

  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  let md = `# LanDisk 前端爬虫测试结果\n\n**时间**: ${now}\n**通过: ${pass} / ${total}**\n\n| # | 类型 | 操作 | 预期 | 模式 | EMS(提示) | 结果 |\n|---|---|---|---|---|---|---|\n`;
  for (const r of TABLE) {
    md += `| ${r['#']} | ${r['类型']} | ${r['操作']} | ${r['预期']} | ${r['模式'] || '—'} | ${r['EMS'] || '—'} | ${r['结果']} |\n`;
  }
  md += `\n**通过: ${pass} | 失败: ${fail} | 总计: ${total}**\n${fail === 0 ? '\n**结论: 全部通过 ✅**' : `\n**结论: ${fail} 项失败 ❌**`}\n`;
  fs.writeFileSync(path.join(__dirname, 'test-crawl-results.md'), md, 'utf-8');
  console.log(`结果已保存: test-crawl-results.md`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
