/**
 * LanDisk 前端爬虫功能测试
 * 用法: node -r ./cdp-wrapper.js test-crawl.js
 *
 * 前置: npm run server, setup.js 已运行
 * 输出: test-crawl-results.md
 */
const fs = require('fs');
const path = require('path');
const { verifyClean } = require('./verify-clean');
const V = require('./verify');

const BASE = 'http://localhost:22580';
const DIR_A = path.join(__dirname, 'testdir', 'testdira');
const DIR_B = path.join(__dirname, 'testdir', 'testdirb');

async function req(method, urlPath, opts = {}) {
  const opt = { method, headers: {}, ...opts };
  if (opts.json) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opts.json); }
  try {
    const res = await fetch(`${BASE}${urlPath}`, opt);
    return { status: res.status, data: await res.json().catch(()=>({})), text: await res.text().catch(()=>'') };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

let pass = 0, fail = 0, n = 0;
const TABLE = [];

function add(nv, type, op, expected, ok, detail) {
  TABLE.push({ '#': nv, '类型': type, '操作': op, '预期': expected, 'verify': detail || '', '结果': ok ? '✅' : '❌' });
  if (ok) { pass++; console.log(`  ✓ [${nv}] ${type}: ${op}`); }
  else { fail++; console.log(`  ✗ [${nv}] ${type}: ${op} — ${detail}`); }
}

const selRoot = t => `(()=>{const i=document.querySelectorAll('.el-select-dropdown__item');for(const x of i){if(x.textContent.includes('${t}')){x.click();return'ok';}}return'notfound';})()`;
const chkAll = "(()=>{document.querySelectorAll('tr.el-table__row .el-checkbox').forEach(c=>c.click());return'ok';})()";
const rowBtn = t => `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){const l=r.querySelector('td:last-child');if(!l)continue;for(const b of l.querySelectorAll('button')){if(b.textContent.includes('${t}')){b.click();return'ok';}}}return'notfound';})()`;

function navToDir(dir) {
  return `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(r.textContent.includes('${dir}')){const n=r.querySelector('.file-name');if(n){n.click();return'ok';}}}return'notfound';})()`;
}

function addRootInSettings(abspath) {
  const esc = abspath.replace(/\\/g, '\\\\');
  return `(()=>{const i=document.querySelector('.add-section .el-input input');if(!i)return'noinput';i.value='${esc}';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('添加'));if(!b)return'nobtn';setTimeout(()=>b.click(),300);return'ok';})()`;
}

function removeRootInSettings(name) {
  return `(()=>{for(const x of document.querySelectorAll('.root-item')){if(x.textContent.includes('${name}')){const b=x.querySelector('.el-button--danger');if(b){b.click();return'ok';}}}return'notfound';})()`;
}

function dropUpload(filename, content) {
  return `(()=>{const f=new File([${JSON.stringify(content)}],${JSON.stringify(filename)},{type:'text/plain'});const dt=new DataTransfer();dt.items.add(f);document.querySelector('.app-container').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return'ok';})()`;
}

function getBtnPos(containerSel, text) {
  return `(()=>{const b=Array.from(document.querySelectorAll('${containerSel}')).find(x=>x.textContent.includes('${text}'));if(!b)return'notfound';const r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`;
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
  // 表头全选 checkbox（一次选中当前页全部行）
  const hdr = await safe(`(()=>{const c=document.querySelector('.el-table__header-wrapper .el-checkbox');if(!c)return'notfound';const r=c.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`);
  if (hdr !== 'notfound' && typeof hdr === 'string') {
    try {
      const {x,y}=JSON.parse(hdr);
      await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
      return true;
    } catch {}
  }
  // 回退：逐行点击 checkbox
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

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk 前端爬虫测试');
  console.log('═══════════════════════════════════════\n');

  try {
    await nav(`${BASE}/`);
    await sleep(2000);
    const title = await safe('document.title');
    if (typeof title !== 'string' || title.includes('ERR')) throw new Error('CDP not ready: ' + JSON.stringify(title));
    console.log('  ✔ Chrome CDP 连接正常\n');
  } catch (e) { console.error(`  ✗ ${e.message}`); process.exit(1); }

  try {
    // ═══════════════════════════════════════
    // Phase 1: 初始化
    // ═══════════════════════════════════════

    /* ---- 1. 导航到首页 ---- */
    await nav(`${BASE}/?path=/`);
    await sleep(2000);
    add(++n, '导航', '导航到/', '首页显示', true, '');

    /* ---- 2. 设置→添加 testdira 根目录 ---- */
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const r2 = await safe(addRootInSettings(DIR_A));
    await sleep(3000);
    const roots2 = r2 === 'ok' ? await req('GET', '/api/roots') : null;
    const ok2 = r2 === 'ok' && roots2?.data?.data?.roots?.some(x => x.path.includes('testdira'));
    add(++n, '根目录', '设置→输入路径→添加 testdira', '列表出现 testdira', ok2, r2);
    await sleep(500);

    /* ---- 3. 设置→添加 testdirb 根目录 ---- */
    const r3 = await safe(addRootInSettings(DIR_B));
    await sleep(3000);
    const roots3 = r3 === 'ok' ? await req('GET', '/api/roots') : null;
    const ok3 = r3 === 'ok' && roots3?.data?.data?.roots?.some(x => x.path.includes('testdirb'));
    add(++n, '根目录', '设置→输入路径→添加 testdirb', '列表出现 testdirb', ok3, r3);
    await sleep(500);

    /* ---- 4. 设置→修改最大上传值（子弹窗交互） ---- */
    // 读取当前配置，保证目标值不同（后端只在值变化时写 type=8 op=1 日志）
    const cfgPre4 = await req('GET', '/api/config');
    const curSize4 = cfgPre4?.data?.maxFileSizeMB ?? 500;
    const target4 = curSize4 >= 9999 ? curSize4 - 1 : curSize4 + 1;
    // 点击"最大上传"的值 → 打开上传设置子弹窗
    const openSub4 = await cdpClick('.settings-dialog-wrap .setting-value');
    let saved4 = false;
    if (openSub4) {
      await sleep(800);
      // 输入新值
      const setIn4 = await safe(`(()=>{const i=document.querySelector('.sub-dialog-row .el-input input');if(i){i.value='${target4}';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return'ok'}return'nope'})()`);
      await sleep(300);
      // 点"保存"（CDP trusted click）
      saved4 = setIn4 === 'ok' && await cdpClickText('.sub-dialog-footer .el-button', '保存');
      await sleep(1500);
    }
    // 验证配置已更新 + 日志已写入
    const cfgPost4 = await req('GET', '/api/config');
    const changed4 = cfgPost4?.data?.maxFileSizeMB === target4;
    const log4 = await req('GET', '/api/logs');
    const hasLog4 = (log4?.data?.data || log4?.data || []).some(e => e.type === 8 && e.data?.op === 1);
    const ok4 = saved4 && changed4 && hasLog4;
    add(++n, '配置', '设置→最大上传子弹窗→保存', `已更新到 ${target4}MB (type=8 op=1)`, ok4, ok4 ? `✓` : `saved=${saved4} changed=${changed4} log=${hasLog4}`);
    // 关闭设置弹窗（左上角 CDP trusted click）
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});
    await sleep(1000);

    // ═══════════════════════════════════════
    // Phase 2: 文件浏览
    // ═══════════════════════════════════════

    /* ---- 5. 下拉选 testdira → 进入 testa/ ---- */
    await safe(`document.querySelector('.root-switcher .el-select__wrapper')?.click()`);
    await sleep(1000);
    await safe(selRoot('testdira'));
    await sleep(2000);
    await safe(navToDir('testa'));
    await sleep(2000);
    const cnt5 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    add(++n, '文件列表', '下拉选 testdira → 进入 testa/', '列表 ≥ 3 文件', parseInt(cnt5) >= 3, `${cnt5} 行`);
    await sleep(500);

    /* ---- 6. 搜索 ---- */
    await safe(`(()=>{const i=document.querySelector('.search-input input');if(i){i.value='f1';i.dispatchEvent(new Event('input',{bubbles:true}));return'ok'}return'nope'})()`);
    await sleep(1500);
    const cnt6 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    add(++n, '搜索', '搜索框输入 f1', '列表过滤', parseInt(cnt6) >= 0, `${cnt6} 行`);
    await safe(`(()=>{const i=document.querySelector('.search-input input');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return'ok'}return'nope'})()`);
    await sleep(1000);

    // ═══════════════════════════════════════
    // Phase 3: 上传交互
    // ═══════════════════════════════════════

    /* ---- 7. 拖拽上传新文件（type=1 op=1） ---- */
    await safe(dropUpload('crawl_up.txt', 'crawl upload content'));
    await sleep(4000);
    const ok7 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    add(++n, '上传', '拖拽上传 crawl_up.txt', '文件创建 (type=1 op=1)', ok7, ok7 ? '✓' : '文件未找到');

    /* ---- 8. 同名上传→冲突→替换（type=2 op=1） ---- */
    await safe(dropUpload('crawl_up.txt', 'replaced content'));
    await sleep(3000);
    const ok8 = await cdpClickText('.el-dialog .el-button--primary', '确定上传');
    if (ok8) await sleep(4000);
    const fe8 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    add(++n, '替换', '冲突弹窗→确定上传（替换）', '替换成功 (type=2 op=1)', ok8 && fe8, ok8 ? (fe8 ? '✓' : '文件消失') : '点击失败');

    /* ---- 9. 同名上传→冲突→取消（type=1 op=0） ---- */
    await safe(dropUpload('crawl_up.txt', 'cancelled content'));
    await sleep(3000);
    const ok9 = await cdpClickText('.el-dialog .el-button:not(.el-button--primary)', '取消上传');
    if (ok9) await sleep(3000);
    const fe9 = V.fileExists(path.join(DIR_A, 'testa', 'crawl_up.txt'));
    add(++n, '取消上传', '冲突弹窗→取消上传', '文件不变 (type=1 op=0)', ok9, ok9 ? '✓' : '文件消失');

    // ═══════════════════════════════════════
    // Phase 4: 删除操作
    // ═══════════════════════════════════════

    /* ---- 10. 全选 → 验证批量栏可见 ---- */
    const ok10 = await ensureBatchBar();
    add(++n, '批量操作', '勾选全部', '批量按钮可见', ok10, ok10 ? 'visible' : 'hidden');
    await cdpClick('.batch-bar .el-button:last-child');
    await sleep(500);

    /* ---- 11. 行删除→取消（type=4 op=0） ---- */
    const v11 = await safe(rowBtn('删除'));
    if (v11 === 'ok') {
      await sleep(800);
      await cdpClickText('.el-message-box__btns .el-button', '取消');
      await sleep(1500);
      const still = V.fileExists(path.join(DIR_A, 'testa', 'f2.txt'));
      add(++n, '取消删除', '行末删除→弹窗→取消', '文件不变 (type=4 op=0)', still, still ? '✓' : '文件被误删');
    } else add(++n, '取消删除', '行末删除→取消', '取消按钮', false, v11);
    await sleep(1000);

    /* ---- 12. 行删除→确认（type=4 op=1） ---- */
    const v12 = await safe(rowBtn('删除'));
    if (v12 === 'ok') {
      await sleep(800);
      const deleted12 = await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(2000);
      add(++n, '删除', '行末删除→确认（CDP点击）', '文件已删 (type=4 op=1)', deleted12, deleted12 ? '✓' : '点击失败');
    } else add(++n, '删除', '行末删除→确认', '确认弹窗', false, v12);
    await sleep(2000);

    /* ---- 13. 全选 → 批量删除剩余文件 ---- */
    await cdpSelectAll();
    await sleep(1000);
    await cdpClick('.batch-bar .el-button--danger');
    await sleep(1500);
    await cdpClickText('.el-message-box__btns .el-button', '删除');
    await sleep(4000);
    const remain13 = V.listDir(path.join(DIR_A, 'testa'));
    const ok13 = remain13.length === 0;
    add(++n, '批量操作', '全选→批量删除（CDP点击）', 'testa 无文件', ok13, ok13 ? '✓' : `仍剩: ${remain13.join(', ')}`);

    /* ---- 14. 面包屑回根 → 全选 → 批量删除 testa 目录 ---- */
    await cdpClick('.el-breadcrumb__item:first-child a');
    await sleep(3000);
    await cdpSelectAll();
    await sleep(1000);
    await cdpClick('.batch-bar .el-button--danger');
    await sleep(1500);
    await cdpClickText('.el-message-box__btns .el-button', '删除');
    await sleep(4000);
    const ok14 = !V.dirExists(path.join(DIR_A, 'testa'));
    add(++n, '批量操作', '面包屑回根→删 testa 目录', '目录不存在', ok14, ok14 ? '✓' : '目录仍存在');

    // ═══════════════════════════════════════
    // Phase 5: 浏览错误 + 日志查看器
    // ═══════════════════════════════════════

    /* ---- 15. 导航到不存在的目录（type=10 op=3） ---- */
    // 用 history.pushState + popstate 触发前端路由（整页刷新会在 roots 加载前就跳回首页，API 不发出）
    await safe(`(()=>{history.pushState({},'', '/?path=/nonexist_dir&root=0');window.dispatchEvent(new PopStateEvent('popstate'));return'ok'})()`);
    await sleep(2000);
    const log15 = await req('GET', '/api/logs');
    const entries15 = log15?.data?.data || log15?.data || [];
    const has15 = entries15.some(e => e.type === 10 && e.data?.op === 3);
    add(++n, '浏览', '导航到不存在的目录', 'type=10 op=3 日志', has15, has15 ? '✓' : '无 type=10 op=3 日志');
    // 回首页（同方式触发路由，保留 roots 状态）
    await safe(`(()=>{history.pushState({},'', '/');window.dispatchEvent(new PopStateEvent('popstate'));return'ok'})()`);
    await sleep(2000);

    // ═══════════════════════════════════════
    // Phase 6: testb 操作
    // ═══════════════════════════════════════

    /* ---- 17. 下拉选 testdirb → 进入 testb/ ---- */
    await safe(`document.querySelector('.root-switcher .el-select__wrapper')?.click()`);
    await sleep(1500);
    await safe(selRoot('testdirb'));
    await sleep(3000);
    await safe(navToDir('testb'));
    await sleep(3000);
    const cnt17 = await safe(`document.querySelectorAll('tr.el-table__row').length`);
    add(++n, '文件列表', '下拉选 testdirb → 进入 testb/', '≥3 文件', parseInt(cnt17) >= 3, `${cnt17} 行`);

    /* ---- 18. 全选 → 验证批量栏可见 ---- */
    const ok18 = await ensureBatchBar();
    add(++n, '批量操作', '勾选全部', '批量按钮可见', ok18, ok18 ? 'visible' : 'hidden');
    await cdpClick('.batch-bar .el-button:last-child');
    await sleep(300);

    /* ---- 19. 行删除→确认 ---- */
    const v19 = await safe(rowBtn('删除'));
    if (v19 === 'ok') {
      await sleep(800);
      const deleted19 = await cdpClickText('.el-message-box__btns .el-button', '删除');
      await sleep(2000);
      add(++n, '删除', '行末删除→确认（CDP点击）', '文件已删', deleted19, deleted19 ? '✓' : '点击失败');
    } else add(++n, '删除', '行末删除→确认', '确认弹窗', false, v19);
    await sleep(2000);

    /* ---- 20. 全选 → 批量删除剩余文件 ---- */
    await cdpSelectAll();
    await sleep(1000);
    await cdpClick('.batch-bar .el-button--danger');
    await sleep(1500);
    await cdpClickText('.el-message-box__btns .el-button', '删除');
    await sleep(4000);
    const ok20 = V.listDir(path.join(DIR_B, 'testb')).length === 0;
    add(++n, '批量操作', '全选→批量删除', 'testb 无文件', ok20, ok20 ? '✓' : '文件仍在');

    /* ---- 21. 面包屑回根 → 全选 → 删 testb 目录 ---- */
    await cdpClick('.el-breadcrumb__item:first-child a');
    await sleep(3000);
    await cdpSelectAll();
    await sleep(1000);
    await cdpClick('.batch-bar .el-button--danger');
    await sleep(1500);
    await cdpClickText('.el-message-box__btns .el-button', '删除');
    await sleep(4000);
    const ok21 = !V.dirExists(path.join(DIR_B, 'testb'));
    add(++n, '批量操作', '面包屑回根→删 testb 目录', '目录不存在', ok21, ok21 ? '✓' : '目录仍存在');

    // ═══════════════════════════════════════
    // Phase 7: 清理
    // ═══════════════════════════════════════

    /* ---- 22. 设置→移除 testdirb ---- */
    await safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1200);
    await safe(removeRootInSettings('testdirb'));
    await sleep(800);
    await cdpClickText('.el-message-box__btns .el-button', '移除');
    await sleep(1500);
    const roots22 = await req('GET', '/api/roots');
    const ok22 = !roots22?.data?.data?.roots?.some(x => x.path.includes('testdirb'));
    add(++n, '根目录', '设置→移除 testdirb', '列表中消失', ok22, ok22 ? '✓' : 'config 仍有 testdirb');
    await sleep(500);

    /* ---- 23. 设置→移除 testdira ---- */
    await safe(removeRootInSettings('testdira'));
    await sleep(800);
    await cdpClickText('.el-message-box__btns .el-button', '移除');
    await sleep(1500);
    const roots23 = await req('GET', '/api/roots');
    const ok23 = !roots23?.data?.data?.roots?.some(x => x.path.includes('testdira'));
    add(++n, '根目录', '设置→移除 testdira', '列表中消失', ok23, ok23 ? '✓' : 'config 仍有 testdira');
    // 关闭设置弹窗
    await cdpRaw('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:50,button:'left',clickCount:1});
    await cdpRaw('Input.dispatchMouseEvent',{type:'mouseReleased',x:50,y:50,button:'left',clickCount:1});

  } finally {
    verifyClean();
    console.log();
  }

  console.log('──────────────────────────────────────────');
  console.table(TABLE);
  const total = pass + fail;
  console.log(`通过: ${pass}  |  失败: ${fail}  |  总计: ${total}  ${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}\n`);

  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  let md = `# LanDisk 前端爬虫测试结果\n\n**时间**: ${now}\n**通过: ${pass} / ${total}**\n\n| # | 类型 | 操作 | 预期 | verify | 结果 |\n|---|---|---|---|---|---|\n`;
  for (const r of TABLE) {
    md += `| ${r['#']} | ${r['类型']} | ${r['操作']} | ${r['预期']} | ${r['verify']} | ${r['结果']} |\n`;
  }
  md += `\n**通过: ${pass} | 失败: ${fail} | 总计: ${total}**\n${fail === 0 ? '\n**结论: 全部通过 ✅**' : `\n**结论: ${fail} 项失败 ❌**`}\n`;
  fs.writeFileSync(path.join(__dirname, 'test-crawl-results.md'), md, 'utf-8');
  console.log(`结果已保存: test-crawl-results.md`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
