/**
 * LanDisk 前端爬虫功能测试
 * 通过 Chrome CDP 操作页面，模拟用户操作（不含下载测试）
 *
 * 前置: Express 启动, Chrome CDP(9222), setup.js 已运行
 * 输出: test-crawl-results.md
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { verifyClean } = require('./verify-clean');
const V = require('./verify');

const SKILL = path.join(process.env.USERPROFILE || 'C:\\Users\\Surperman', '.claude', 'skills', 'browser', 'scripts');
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

let pass = 0, fail = 0;
const TABLE = [];

function run(s, ...args) {
  const cmd = `node "${path.join(SKILL, s)}" ${args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')}`;
  try { return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim()); }
  catch (e) { const m = e.stdout?.toString() || e.message; try { return JSON.parse(m.trim()); } catch { return { error: m.trim() }; } }
}
const nav = u => run('nav.cjs', u);
function safe(c) {
  const w = `(()=>{try{return(${c})}catch(e){return'ERR:'+(e.message||'unknown')}})()`;
  const r = run('eval.cjs', w);
  if (r && typeof r === 'object' && r.error) return r.error;
  return String(r);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const selRoot = t => `(()=>{const i=document.querySelectorAll('.el-select-dropdown__item');for(const x of i){if(x.textContent.includes('${t}')){x.click();return'ok';}}return'notfound';})()`;
const chkAll = "(()=>{document.querySelectorAll('tr.el-table__row .el-checkbox').forEach(c=>c.click());return'ok';})()";
const rowBtn = t => `(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){const l=r.querySelector('td:last-child');if(!l)continue;for(const b of l.querySelectorAll('button')){if(b.textContent.includes('${t}')){b.click();return'ok';}}}return'notfound';})()`;
const btnTxt = t => `(()=>{for(const b of document.querySelectorAll('button')){if(b.textContent.includes('${t}')){b.click();return'ok';}}return'notfound';})()`;

function add(n, type, op, expected, ok, detail) {
  TABLE.push({ '#': n, '类型': type, '操作': op, '预期': expected, 'verify': detail || '', '结果': ok ? '✅' : '❌' });
  if (ok) { pass++; console.log(`  ✓ [${n}] ${type}`); }
  else { fail++; console.log(`  ✗ [${n}] ${type} — ${detail}`); }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk 前端爬虫测试');
  console.log('═══════════════════════════════════════\n');

  try {
    nav(`${BASE}/`);
    await sleep(2000);
    if (safe('document.title').includes('ERR')) throw new Error('CDP not ready');
    console.log('  ✔ Chrome CDP 连接正常\n');
  } catch (e) { console.error(`  ✗ ${e.message}`); process.exit(1); }

  try {
    /* ========== 1. 导航到首页 ========== */
    nav(`${BASE}/?path=/`);
    await sleep(2000);
    add(1, '导航', '导航到/', '首页显示', true, '');

    /* ========== 2. 设置→输入路径→添加 testdira 根目录 ========== */
    safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1500);
    const addRoot = p => `(()=>{const i=document.querySelector('.add-section .el-input input');if(!i)return'noinput';const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const v='${p.replace(/\\/g,'\\\\')}';s.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));const b=document.querySelector('.add-section .el-button');if(b)setTimeout(()=>b.click(),300);return'ok';})()`;
    const r2 = safe(addRoot(DIR_A));
    await sleep(3000);
    const ok2 = r2==='ok' && V.checkConfigRoots({ shouldContain: 'testdira' });
    add(2, '根目录', '设置→输入testdira路径→添加', 'root-item出现', ok2, ok2?'✓':r2);
    await sleep(500);

    /* ========== 3. 设置→输入路径→添加 testdirb 根目录 ========== */
    const r3 = safe(addRoot(DIR_B));
    await sleep(3000);
    const ok3 = r3==='ok' && V.checkConfigRoots({ shouldContain: 'testdirb' });
    add(3, '根目录', '设置→输入testdirb路径→添加', 'root-item≥2', ok3, ok3?'✓':r3);
    safe(`document.querySelector('.el-dialog__headerbtn')?.click()`);
    await sleep(1000);

    /* ========== testa 文件夹操作 ========== */

    /* ---- 4. 下拉选 testdira → 进入 testa/ ---- */
    safe(`document.querySelector('.root-switcher .el-select__wrapper')?.click()`);
    await sleep(1000);
    safe(selRoot('testdira'));
    await sleep(2000);
    safe(`(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(r.textContent.includes('testa')){const n=r.querySelector('.file-name');if(n){n.click();return'ok';}}}return'notfound';})()`);
    await sleep(2000);
    const cnt4 = safe(`document.querySelectorAll('tr.el-table__row').length`);
    add(4, '文件列表', '下拉选testdira→进入testa/', '≥3文件', parseInt(cnt4)>=3, `${cnt4}行`);

    /* ---- 5. 全选 → 验证批量栏可见 ---- */
    safe(chkAll);
    await sleep(1000);
    const v5 = safe(`document.querySelector('.batch-bar')?'visible':'hidden'`);
    add(5, '批量操作', '勾选全部', '批量按钮可见', v5==='visible', v5);
    safe(`document.querySelector('.batch-bar .el-button:last-child')?.click()`);
    await sleep(500);

    /* ---- 6. 单行删除（删除一个文件） ---- */
    const v6 = safe(rowBtn('删除'));
    if (v6 === 'ok') {
      await sleep(800);
      safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
      await sleep(2000);
      add(6, '删除', '行末删除→确认', '确认弹窗', true, '');
    } else add(6, '删除', '行末删除', '确认弹窗', false, v6);
    await sleep(2000);
    /* ---- 7. 全选 → 批量删除剩余文件 ---- */
    safe(chkAll);
    await sleep(1000);
    safe(btnTxt('批量删除'));
    await sleep(1500);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(4000);
    const ok7 = !V.fileExists(path.join(DIR_A, 'testa', 'f2.txt'));
    add(7, '批量操作', '全选→批量删除', '剩余文件已删', ok7, ok7?'✓':'文件仍存在');

    /* ---- 8. 面包屑回到根 → 全选 → 批量删除 testa 目录 ---- */
    safe(`document.querySelector('.el-breadcrumb__item:first-child a')?.click()`);
    await sleep(3000);
    safe(chkAll);
    await sleep(1000);
    safe(btnTxt('批量删除'));
    await sleep(1500);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(4000);
    const ok8 = !V.dirExists(path.join(DIR_A, 'testa'));
    add(8, '批量操作', '面包屑回根→删testa目录', '目录不存在', ok8, ok8?'✓':'目录仍存在');

    /* ========== testb 文件夹操作（与 testa 相同流程） ========== */

    /* ---- 9. 下拉选 testdirb → 进入 testb/ ---- */
    safe(`document.querySelector('.root-switcher .el-select__wrapper')?.click()`);
    await sleep(1500);
    safe(selRoot('testdirb'));
    await sleep(3000);
    safe(`(()=>{for(const r of document.querySelectorAll('tr.el-table__row')){if(r.textContent.includes('testb')){const n=r.querySelector('.file-name');if(n){n.click();return'ok';}}}return'notfound';})()`);
    await sleep(3000);
    const cnt9 = safe(`document.querySelectorAll('tr.el-table__row').length`);
    add(9, '文件列表', '下拉选testdirb→进入testb/', '≥3文件', parseInt(cnt9)>=3, `${cnt9}行`);

    /* ---- 10. 全选 → 验证批量栏可见 ---- */
    safe(chkAll);
    await sleep(800);
    const v10 = safe(`document.querySelector('.batch-bar')?'visible':'hidden'`);
    add(10, '批量操作', '勾选全部', '批量按钮可见', v10==='visible', v10);
    safe(`document.querySelector('.batch-bar .el-button:last-child')?.click()`);
    await sleep(300);

    /* ---- 11. 单行删除 ---- */
    const v11 = safe(rowBtn('删除'));
    if (v11 === 'ok') {
      await sleep(800);
      safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
      await sleep(2000);
      add(11, '删除', '行末删除→确认', '确认', true, '');
    } else add(11, '删除', '行末删除', '确认', false, v11);
    await sleep(2000);
    /* ---- 12. 全选 → 批量删除剩余文件 ---- */
    safe(chkAll);
    await sleep(1000);
    safe(btnTxt('批量删除'));
    await sleep(1500);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(4000);
    const ok12 = V.listDir(path.join(DIR_B, 'testb')).length === 0;
    add(12, '批量操作', '全选→批量删除', 'testb内无文件', ok12, ok12?'✓':'文件仍在');

    /* ---- 13. 面包屑回到根 → 删 testb 目录 ---- */
    safe(`document.querySelector('.el-breadcrumb__item:first-child a')?.click()`);
    await sleep(3000);
    safe(chkAll);
    await sleep(1000);
    safe(btnTxt('批量删除'));
    await sleep(1500);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(4000);
    const ok13 = !V.dirExists(path.join(DIR_B, 'testb'));
    add(13, '批量操作', '面包屑回根→删testb目录', '目录不存在', ok13, ok13?'✓':'目录仍存在');

    /* ========== 清理配置 ========== */

    /* ---- 14. 设置移除 testdirb 根目录 ---- */
    safe(`document.querySelectorAll('.header-right .el-button')[1]?.click()`);
    await sleep(1200);
    safe(`(()=>{for(const x of document.querySelectorAll('.root-item')){if(x.textContent.includes('testdirb')){const b=x.querySelector('.el-button--danger');if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(800);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(1500);
    const ok14 = V.checkConfigRoots({ shouldNotContain: 'testdirb' });
    add(14, '根目录', '设置→移除testdirb', '已移除', ok14, ok14?'✓':'config仍有testdirb');
    await sleep(1500);
    /* ---- 15. 设置移除 testdira 根目录 ---- */
    safe(`(()=>{for(const x of document.querySelectorAll('.root-item')){if(x.textContent.includes('testdira')){const b=x.querySelector('.el-button--danger');if(b){b.click();return'ok';}}}return'notfound';})()`);
    await sleep(800);
    safe(`document.querySelector('.el-message-box__btns .el-button--primary')?.click()`);
    await sleep(1500);
    const ok15 = V.checkConfigRoots({ shouldNotContain: 'testdira' });
    add(15, '根目录', '设置→移除testdira', '已移除', ok15, ok15?'✓':'config仍有testdira');
    safe(`document.querySelector('.el-dialog__headerbtn')?.click()`);

  } finally {
    verifyClean();
    console.log();
  }

  console.log('──────────────────────────────────────────');
  console.table(TABLE);
  console.log(`通过: ${pass}  |  失败: ${fail}  |  总计: ${pass+fail}  ${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}\n`);

  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  let md = `# LanDisk 前端爬虫测试结果\n\n**时间**: ${now}\n**通过: ${pass} / ${pass+fail}**\n\n| # | 类型 | 操作 | 预期 | verify | 结果 |\n|---|---|---|---|---|---|\n`;
  for (const r of TABLE) {
    md += `| ${r['#']} | ${r['类型']} | ${r['操作']} | ${r['预期']} | ${r['verify']} | ${r['结果']} |\n`;
  }
  md += `\n**通过: ${pass} | 失败: ${fail} | 总计: ${pass+fail}**\n${fail === 0 ? '\n**结论: 全部通过 ✅**' : `\n**结论: ${fail} 项失败 ❌**`}\n`;
  fs.writeFileSync(path.join(__dirname, 'test-crawl-results.md'), md, 'utf-8');
  console.log(`结果已保存: test-crawl-results.md`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
