/**
 * LanDisk API 功能测试（23 项）
 * 用法: node test/test-api.js
 *
 * 前置: Express 已启动 (node server.js), setup.js 已运行
 * 流程: 添加根目录 → 23项测试 → 移除根目录 → verifyClean
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { verifyClean } = require('./verify-clean');
const V = require('./verify');

const BASE = 'http://localhost:22580';
const DIR_A = path.join(__dirname, 'testdir', 'testdira');
const DIR_B = path.join(__dirname, 'testdir', 'testdirb');
const TMP   = path.join(__dirname, 'testdir', 'tmp');

const TABLE = [];
let pass = 0, fail = 0;

// ─── HTTP 请求 ─────────────────────────────

async function req(method, urlPath, opts = {}) {
  const url = `${BASE}${urlPath}`;
  const opt = { method, headers: {}, ...opts };
  if (opts.json) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(opts.json);
  }
  try {
    const res = await fetch(url, opt);
    const status = res.status;
    const text = await res.text();
    try { return { status, data: JSON.parse(text), text }; }
    catch { return { status, data: text, text }; }
  } catch (e) {
    return { status: 0, data: { error: e.message }, text: e.message };
  }
}

/** curl 上传（text fields before file field） */
function curlUpload(localPath, filename, targetPath, rootIdx, replace) {
  const p = localPath.replace(/\\/g, '/');
  const fn = filename ? `;filename=${filename}` : '';
  const r = replace || '';
  const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=${targetPath}" -F "root=${rootIdx}" -F "replace=${r}" -F "files=@${p}${fn}"`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim());
  } catch (e) {
    const m = e.stdout?.toString() || e.message;
    try { return JSON.parse(m.trim()); } catch { return { error: m }; }
  }
}

// ─── 记录 ─────────────────────────────

function add(n, type, op, expected, vResult, ok, detail) {
  TABLE.push({ '#': n, '类型': type, '操作': op, '预期': expected, 'verify': vResult, '结果': ok ? '✅' : '❌' });
  if (ok) { pass++; console.log(`  ✓ [${n}] ${type}`); }
  else { fail++; console.log(`  ✗ [${n}] ${type} — ${detail || ''}`); }
}

function result(n, type, op, expected, verifyFn) {
  let vOk = true, vDetail = '';
  try { const r = verifyFn(); vOk = r === true || r === undefined; vDetail = r === true ? '✓' : (r || '✓'); } catch(e) { vOk = false; vDetail = e.message; }
  add(n, type, op, expected, vDetail, vOk, vDetail);
}

// ─── 主流程 ─────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk API 功能测试 (23项)');
  console.log('═══════════════════════════════════════\n');

  // 健康检查
  const health = await req('GET', '/api/roots');
  if (health.status !== 200) { console.error('服务未启动'); process.exit(1); }

  let idxA, idxB, cleanReport = '';
  try {
    // ── 解析根索引 ──
    async function resolveRoot(p) {
      const r = await req('GET', '/api/roots');
      const list = r.data?.roots || [];
      const exist = list.findIndex(x => x.path === p);
      if (exist >= 0) return exist;
      const a = await req('POST', '/api/roots', { json: { path: p } });
      if (a.status !== 200) throw new Error(`添加失败 ${p}: ${a.data?.error}`);
      return a.data.roots.findIndex(x => x.path === p);
    }
    idxA = await resolveRoot(DIR_A);
    idxB = await resolveRoot(DIR_B);
    console.log(`  ✔ testdira→root[${idxA}], testdirb→root[${idxB}]\n`);

    // ── 1-2 文件列表 ──
    const r1 = await req('GET', `/api/files?path=/testa&root=${idxA}`);
    result(1, '文件列表', `GET /api/files?path=/testa&root=${idxA}`, '200,≥3条', () => r1.status===200 && r1.data?.entries?.length>=3 ? true : `HTTP ${r1.status} entries=${r1.data?.entries?.length}`);

    const r2 = await req('GET', `/api/files?path=/testb&root=${idxB}`);
    result(2, '文件列表', `GET /api/files?path=/testb&root=${idxB}`, '200,≥3条', () => r2.status===200 && r2.data?.entries?.length>=3 ? true : `HTTP ${r2.status}`);

    // ── 3 缺 root ──
    const r3 = await req('GET', '/api/files?path=/');
    result(3, '缺 root', 'GET /api/files (无root)', '400', () => r3.status===400 || '不是400');

    // ── 4 上传 new.txt ──
    const up4 = curlUpload(path.join(TMP, 'up_normal.txt'), 'new.txt', '/testa', idxA, '');
    const ok4 = up4 && !up4.error;
    result(4, '上传', `POST new.txt→/testa root=${idxA}`, '200', () => {
      if (!ok4) return `上传失败: ${JSON.stringify(up4)}`;
      return V.fileIs(path.join(DIR_A, 'testa', 'new.txt'), 'normal upload content - unique marker NORMAL_DATA') || '文件内容不匹配';
    });

    // ── 5 阻断 exe ──
    const up5 = curlUpload(path.join(TMP, 'up_exe.exe'), 'up_exe.exe', '/testa', idxA, '');
    result(5, '阻断', `POST exe→/testa root=${idxA}`, '200阻断', () => {
      if (up5?.error) return `上传错误: ${up5.error}`;
      return !V.fileExists(path.join(DIR_A, 'testa', 'up_exe.exe')) || 'exe文件仍存在';
    });

    // ── 6 冲突检测 ──
    const r6 = await req('POST', '/api/upload/check', { json: { targetPath: '/testa', names: ['new.txt'], root: idxA } });
    result(6, '冲突检测', `POST check new.txt root=${idxA}`, 'conflicts含new.txt', () => r6.data?.conflicts?.includes('new.txt') || '未检测到冲突');

    // ── 7 替换+对比 ──
    const up7 = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', '/testa', idxA, 'new.txt');
    const ok7 = up7 && !up7.error;
    result(7, '替换+对比', '替换new.txt', '替换后内容一致', () => {
      if (!ok7) return `替换失败: ${JSON.stringify(up7)}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_A, 'testa', 'new.txt')) || '替换后内容不一致';
    });

    // ── 8 保留两份 ──
    const up8 = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', '/testa', idxA, '');
    result(8, '保留两份', '同名上传(无replace)', '出现new(1).txt', () => {
      return V.fileExists(path.join(DIR_A, 'testa', 'new (1).txt')) || 'new (1).txt不存在';
    });

    // ── 9 取消 ──
    const r9 = await req('POST', '/api/upload/check', { json: { targetPath: '/testa', names: ['no_such_file.txt'], root: idxA } });
    result(9, '取消', '检测不存在文件', 'conflicts空', () => r9.data?.conflicts?.length === 0 || '有冲突');

    // ── 10 缺root(冲突检测) ──
    const r10 = await req('POST', '/api/upload/check', { json: { targetPath: '/testa', names: ['new.txt'] } });
    result(10, '缺 root', 'POST upload/check (无root)', '400', () => r10.status === 400 || '不是400');

    // ── 11 打开文件 ──
    const r11 = await req('POST', '/api/files/open', { json: { path: '/testa/t.xyz', root: idxA } });
    result(11, '打开文件', `POST open /testa/t.xyz root=${idxA}`, '200', () => r11.status === 200 || `HTTP ${r11.status}`);

    // ── 12 缺root(打开) ──
    const r12 = await req('POST', '/api/files/open', { json: { path: '/testa/t.xyz' } });
    result(12, '缺 root', 'POST open (无root)', '400', () => r12.status === 400 || '不是400');

    // ── 13 下载 testa ──
    const dl13 = await fetch(`${BASE}/api/download?path=/testa/f1.txt&root=${idxA}`);
    result(13, '下载', `GET download /testa/f1.txt root=${idxA}`, '200', () => dl13.status === 200 || `HTTP ${dl13.status}`);

    // ── 14 下载 testb ──
    const dl14 = await fetch(`${BASE}/api/download?path=/testb/f1.txt&root=${idxB}`);
    result(14, '下载', `GET download /testb/f1.txt root=${idxB}`, '200', () => dl14.status === 200 || `HTTP ${dl14.status}`);

    // ── 15 缺root(下载) ──
    const dl15 = await fetch(`${BASE}/api/download?path=/testa/f1.txt`);
    result(15, '缺 root', 'GET download (无root)', '400', () => dl15.status === 400 || '不是400');

    // ── 16 test_b 替换 ──
    const up16 = curlUpload(path.join(TMP, 'up_conflict.txt'), 'f1.txt', '/testb', idxB, 'f1.txt');
    result(16, 'test_b替换', '替换testb/f1.txt', '替换后内容一致', () => {
      if (up16?.error) return `替换失败: ${up16.error}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_B, 'testb', 'f1.txt')) || '内容不一致';
    });

    // ── 17 单文件删除 ──
    const r17 = await req('DELETE', `/api/delete?path=/testa/f2.txt&root=${idxA}`);
    result(17, '删除', `DELETE /testa/f2.txt root=${idxA}`, '200 dest=trash', () => {
      if (r17.status !== 200) return `HTTP ${r17.status}`;
      if (r17.data?.dest !== 'trash') return `dest=${r17.data?.dest}`;
      return !V.fileExists(path.join(DIR_A, 'testa', 'f2.txt')) || 'f2.txt仍存在';
    });

    // ── 18 缺root(删除) ──
    const r18 = await req('DELETE', '/api/delete?path=/testa/f3.txt');
    result(18, '缺 root', 'DELETE (无root)', '400', () => r18.status === 400 || '不是400');

    // ── 19 日志 ──
    const r19 = await req('POST', '/api/logs', { json: { level: 'info', type: 10, data: { op: 2, dir: 'test' } } });
    result(19, '日志', 'POST logs type=10', '200', () => r19.status === 200 || `HTTP ${r19.status}`);

    // ── 20 删 testa 目录 ──
    const r20 = await req('DELETE', `/api/delete?path=/testa&root=${idxA}`);
    result(20, '删目录', `DELETE /testa root=${idxA}`, '200 目录已删', () => {
      if (r20.status !== 200) return `HTTP ${r20.status}`;
      if (r20.data?.dest !== 'trash') return `dest=${r20.data?.dest}`;
      return !V.dirExists(path.join(DIR_A, 'testa')) || 'testa/仍存在';
    });

    // ── 21 移除 testdirb 根 ──
    const r21 = await req('DELETE', '/api/roots', { json: { path: DIR_B } });
    result(21, '根目录', 'DELETE roots path=testdirb', '200 config无testdirb', () => {
      if (r21.status !== 200) return `HTTP ${r21.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdirb' }) || 'config仍有testdirb';
    });

    // ── 22 移除 testdira 根 ──
    const r22 = await req('DELETE', '/api/roots', { json: { path: DIR_A } });
    result(22, '根目录', 'DELETE roots path=testdira', '200 config无testdira', () => {
      if (r22.status !== 200) return `HTTP ${r22.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdira' }) || 'config仍有testdira';
    });

    // ── 23 旧索引拦截 ──
    const r23 = await req('GET', `/api/files?path=/testa&root=${idxA}`);
    result(23, '缺 root', `GET /api/files root=旧${idxA}`, '400', () => r23.status === 400 || '不是400');

  } finally {
    verifyClean();
    console.log();
  }

  // ════════════════ 输出 ════════════════
  console.log('──────────────────────────────────────────');
  console.table(TABLE);
  console.log(`通过: ${pass}  |  失败: ${fail}  |  总计: ${pass+fail}  ${fail === 0 ? '✓ 全部通过' : '✗ 有失败项'}\n`);

  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  let md = `# LanDisk API 测试结果\n\n**时间**: ${now}\n**通过: ${pass} / ${pass+fail}**\n\n| # | 类型 | 操作 | 预期 | verify | 结果 |\n|---|---|---|---|---|---|\n`;
  for (const r of TABLE) {
    md += `| ${r['#']} | ${r['类型']} | ${r['操作']} | ${r['预期']} | ${r['verify']} | ${r['结果']} |\n`;
  }
  md += `\n**通过: ${pass} | 失败: ${fail} | 总计: ${pass+fail}**\n${fail === 0 ? '\n**结论: 全部通过 ✅**' : `\n**结论: ${fail} 项失败 ❌**`}\n`;
  fs.writeFileSync(path.join(__dirname, 'test-api-results.md'), md, 'utf-8');
  console.log(`结果已保存: test-api-results.md`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
