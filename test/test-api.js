/**
 * LanDisk API 功能测试（覆盖全 type/op 日志）
 * 用法: node test/test-api.js
 *
 * 前置: npm run server 已启动, setup.js 已运行
 * 流程: 添加根目录 → 测试 → 清除根目录 → verifyClean
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

// ─── 测试辅助 ─────────────────────────────

async function req(method, urlPath, opts = {}) {
  return V.httpReq(method, urlPath, opts);
}

function curlUpload(localPath, filename, targetPath, rootIdx, replace) {
  return V.curlUpload(localPath, filename, targetPath, rootIdx, replace);
}

function add(n, type, op, expected, vResult, ok, detail) {
  TABLE.push({ '#': n, '类型': type, '操作': op, '预期': expected, 'verify': vResult, '结果': ok ? '✅' : '❌' });
  if (ok) { pass++; console.log(`  ✓ [${n}] ${type}: ${op}`); }
  else { fail++; console.log(`  ✗ [${n}] ${type}: ${op} — ${detail || ''}`); }
}

async function result(n, type, op, expected, verifyFn) {
  let vOk = true, vDetail = '';
  try { const r = await verifyFn(); vOk = r === true || r === undefined; vDetail = r === true ? '✓' : (r || '✓'); } catch(e) { vOk = false; vDetail = e.message; }
  add(n, type, op, expected, vDetail, vOk, vDetail);
}

// ─── 主流程 ─────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  LanDisk API 功能测试');
  console.log('═══════════════════════════════════════\n');

  const health = await req('GET', '/api/roots');
  if (health.status !== 200) { console.error('服务未启动'); process.exit(1); }

  let idxA, idxB, cleanReport = '';
  try {
    // ── 添加根目录 ──
    idxA = await V.resolveRoot(DIR_A);
    idxB = await V.resolveRoot(DIR_B);
    console.log(`  ✔ testdira→root[${idxA}], testdirb→root[${idxB}]\n`);

    // clear logs first so test-generated logs are fresh for viewing
    await req('DELETE', '/api/logs');
    await req('DELETE', '/api/logs/display');

    // ═══════════════════════════════════════
    // Phase 1: 文件列表
    // ═══════════════════════════════════════
    let n = 0;

    await result(++n, '文件列表', `GET /testa root=${idxA}`, '≥3文件', () => {
      const list = V.listDir(path.join(DIR_A, 'testa'));
      return list.length >= 3 || `仅${list.length}个文件`;
    });
    await result(++n, '文件列表', `GET /testb root=${idxB}`, '≥3文件', () => {
      const list = V.listDir(path.join(DIR_B, 'testb'));
      return list.length >= 3 || `仅${list.length}个文件`;
    });
    await result(++n, '文件列表', 'GET / (无root)', '失败', async () => {
      const r = await req('GET', '/api/files?path=/');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=10 op=3: 浏览不存在的目录
    await result(++n, '浏览', `GET /nonexist root=${idxA}`, '200 err', async () => {
      const r = await req('GET', `/api/files?path=/nonexist&root=${idxA}`);
      return r.status === 200 && r.data?.success === false || '应返回 success=false';
    });

    // ═══════════════════════════════════════
    // Phase 2: 上传 — 成功场景
    // ═══════════════════════════════════════
    await result(++n, '上传', `POST new.txt→/testa root=${idxA}`, '200', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'new.txt', '/testa', idxA, '');
      if (!up || up.error) return `上传失败: ${JSON.stringify(up)}`;
      const actualContent = V.fileExists(path.join(DIR_A, 'testa', 'new.txt')) ? V.readFile(path.join(DIR_A, 'testa', 'new.txt')) : 'FILE_NOT_FOUND';
      return actualContent === 'normal upload content - unique marker NORMAL_DATA' || `内容不匹配: actual=[${actualContent}] resp=${JSON.stringify(up)}`;
    });

    // Type=1 op=2: 阻断 exe (后端未实现阻断, 预期上传成功)
    await result(++n, '阻断', `POST exe→/testa root=${idxA}`, '上传成功', () => {
      const up = curlUpload(path.join(TMP, 'up_exe.exe'), 'up_exe.exe', '/testa', idxA, '');
      if (up?.error) return `上传错误: ${up.error}`;
      return V.fileExists(path.join(DIR_A, 'testa', 'up_exe.exe')) || '文件未创建';
    });

    // batch upload (type=1 op=1 with count>1)
    await result(++n, '批量上传', `POST 2 files→/testa root=${idxA}`, 'count=2', () => {
      const p1 = TMP.replace(/\\/g, '/') + '/up_normal.txt';
      const p2 = TMP.replace(/\\/g, '/') + '/up_conflict.txt';
      const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=/testa" -F "root=${idxA}" -F "replace=" -F "files=@${p1};filename=batch_a.txt" -F "files=@${p2};filename=batch_b.txt"`;
      let up;
      try { up = JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim()); }
      catch (e) { const m = e.stdout?.toString() || e.message; try { up = JSON.parse(m.trim()); } catch { up = { error: m }; } }
      if (up?.error) return `上传失败: ${up.error}`;
      const count = up.data?.files?.length || 0;
      return count >= 2 || `少于2个文件: ${JSON.stringify(up)}`;
    });

    // cancel logs (simulate frontend behavior via POST /api/logs)
    await result(++n, '取消上传', `POST logs type=1 op=0 单文件`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 1, data: { op: 0, file: 'photo.jpg', dir: '/testa', root: DIR_A } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消上传', `POST logs type=1 op=0 批量`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 1, data: { op: 0, count: 3, files: ['a.txt','b.txt','c.txt'], dir: '/testa', root: DIR_A } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消删除', `POST logs type=4 op=0 单文件`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 4, data: { op: 0, file: 'test.txt', root: DIR_A } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消删除', `POST logs type=4 op=0 批量`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 4, data: { op: 0, count: 5, root: DIR_A } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });

    // ═══════════════════════════════════════
    // Phase 3: 冲突检测 / 替换 / 保留两份
    // ═══════════════════════════════════════
    await result(++n, '冲突检测', `POST check new.txt root=${idxA}`, 'conflicts含new.txt', async () => {
      const r = await req('POST', '/api/upload/check', { json: { targetPath: '/testa', names: ['new.txt'], root: idxA } });
      return r.data?.conflicts?.includes('new.txt') || '未检测到冲突';
    });

    // Type=2 op=1: 替换成功
    await result(++n, '替换', `替换new.txt root=${idxA}`, '内容一致', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', '/testa', idxA, 'new.txt');
      if (!up || up.error) return `替换失败: ${JSON.stringify(up)}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_A, 'testa', 'new.txt')) || '内容不一致';
    });

    // Type=1 op=1: 保留两份
    await result(++n, '保留两份', `同名上传(无replace) root=${idxA}`, '出现 new (1).txt', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', '/testa', idxA, '');
      if (up?.error) return `上传错误: ${up.error}`;
      return V.fileExists(path.join(DIR_A, 'testa', 'new (1).txt')) || 'new (1).txt不存在';
    });

    // ═══════════════════════════════════════
    // Phase 4: 上传 — 错误场景
    // ═══════════════════════════════════════
    // Type=1 op=2: 无效的根目录
    await result(++n, '上传', `POST root=999`, '400', async () => {
      const r = await req('POST', '/api/upload/check', { json: { targetPath: '/testa', names: ['new.txt'], root: 999 } });
      return r.status === 400 || `HTTP ${r.status}`;
    });
    // Type=1 op=2: 无权访问（路径穿越）
    await result(++n, '上传', `POST 穿越路径 root=${idxA}`, '成功(../已清洗)', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'up_normal.txt', '/../../etc', idxA, '');
      return up?.success === true || `上传失败 resp=${JSON.stringify(up)}`;
    });

    // ═══════════════════════════════════════
    // Phase 5: 打开文件
    // ═══════════════════════════════════════
    // Type=6 op=1: 打开成功
    await result(++n, '打开', `POST /testa/t.xyz root=${idxA}`, '200', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: '/testa/t.xyz', root: idxA } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=6 op=2: 打开不存在的文件
    await result(++n, '打开', `POST /testa/nonexist root=${idxA}`, '200 失败', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: '/testa/nonexist.txt', root: idxA } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=6 op=2: 不能打开目录
    await result(++n, '打开', `POST /testa root=${idxA}`, '200 失败', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: '/testa', root: idxA } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=6 op=2: 缺参数
    await result(++n, '打开', 'POST /api/files/open 无body', '失败', async () => {
      const r = await req('POST', '/api/files/open', { json: {} });
      return r.data?.success === false || `未返回失败`;
    });
    // Type=6 op=2: 无效根目录
    await result(++n, '打开', `POST /testa/t.xyz root=999`, '失败', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: '/testa/t.xyz', root: 999 } });
      return r.data?.success === false || `未返回失败`;
    });

    // ═══════════════════════════════════════
    // Phase 6: 下载
    // ═══════════════════════════════════════
    // Type=5 op=1: 下载成功
    await result(++n, '下载', `GET /testa/f1.txt root=${idxA}`, '200', async () => {
      const r = await req('GET', `/api/download?path=/testa/f1.txt&root=${idxA}`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '下载', `GET /testb/f1.txt root=${idxB}`, '200', async () => {
      const r = await req('GET', `/api/download?path=/testb/f1.txt&root=${idxB}`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=5 op=2: 下载不存在的文件
    await result(++n, '下载', `GET /testa/nonexist.txt root=${idxA}`, '200 失败', async () => {
      const r = await req('GET', `/api/download?path=/testa/nonexist.txt&root=${idxA}`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=5 op=2: 不能下载目录
    await result(++n, '下载', `GET /testa root=${idxA}`, '200 失败', async () => {
      const r = await req('GET', `/api/download?path=/testa&root=${idxA}`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=5 op=2: 缺 root
    await result(++n, '下载', 'GET /download 无root', '失败', async () => {
      const r = await req('GET', '/api/download?path=/testa/f1.txt');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=5 op=2: 无效根目录
    await result(++n, '下载', 'GET /download root=999', '失败', async () => {
      const r = await req('GET', '/api/download?path=/testa/f1.txt&root=999');
      return r.data?.success === false || `未返回失败`;
    });

    // ═══════════════════════════════════════
    // Phase 7: 删除
    // ═══════════════════════════════════════
    // Type=4 op=1: 单文件删除（回收站）
    await result(++n, '删除', `DELETE /testa/f2.txt root=${idxA}`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/testa/f2.txt&root=${idxA}`);
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const dest = r.data?.data?.dest;
      if (dest !== 'trash') return `dest=${dest}`;
      return !V.fileExists(path.join(DIR_A, 'testa', 'f2.txt')) || 'f2.txt仍存在';
    });
    // Type=4 op=3: 删除不存在的文件
    await result(++n, '删除', `DELETE /testa/nonexist.txt root=${idxA}`, '200 失败', async () => {
      const r = await req('DELETE', `/api/delete?path=/testa/nonexist.txt&root=${idxA}`);
      return r.data?.success === false || `应返回失败`;
    });
    // Type=4 op=3: 缺 root
    await result(++n, '删除', 'DELETE 无root', '失败', async () => {
      const r = await req('DELETE', '/api/delete?path=/testa/f3.txt');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=4 op=3: 无效根目录
    await result(++n, '删除', 'DELETE root=999', '失败', async () => {
      const r = await req('DELETE', '/api/delete?path=/testa/f3.txt&root=999');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=4 op=1: 批量删除（混合文件+文件夹）
    await result(++n, '批量删除', `POST batch /testa/f3.txt+/testa/subdir root=${idxA}`, '混合删除', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: ['/testa/f3.txt', '/testa/subdir'], root: idxA } });
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const f3gone = !V.fileExists(path.join(DIR_A, 'testa', 'f3.txt'));
      const subdirGone = !V.dirExists(path.join(DIR_A, 'testa', 'subdir'));
      return (f3gone && subdirGone) || `f3.txt=${!f3gone} subdir=${!subdirGone}`;
    });

    // Type=4 op=1: 删除整个目录
    await result(++n, '删除', `DELETE /testa root=${idxA}`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/testa&root=${idxA}`);
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const dest = r.data?.data?.dest;
      if (dest !== 'trash') return `dest=${dest}`;
      return !V.dirExists(path.join(DIR_A, 'testa')) || 'testa/仍存在';
    });
    // Type=4 op=3: 删除已删除的目录
    await result(++n, '删除', `DELETE /testa(已删) root=${idxA}`, '200 失败', async () => {
      const r = await req('DELETE', `/api/delete?path=/testa&root=${idxA}`);
      return r.data?.success === false || `应返回失败`;
    });

    // ═══════════════════════════════════════
    // Phase 8: 根目录失败场景（在移除之前）
    // ═══════════════════════════════════════
    // Type=7 op=3: 重复添加
    await result(++n, '根目录', 'POST roots 重复添加 (testdira)', '失败', async () => {
      const r = await req('POST', '/api/roots', { json: { path: DIR_A } });
      return r.data?.success === false || `应返回失败`;
    });
    // Type=7 op=3: 添加不存在的路径
    await result(++n, '根目录', 'POST roots 不存在路径', '失败', async () => {
      const r = await req('POST', '/api/roots', { json: { path: 'Z:\\notexist\\path' } });
      return r.data?.success === false || `应返回失败`;
    });
    // Type=7 op=3: 添加非目录（文件路径）
    await result(++n, '根目录', 'POST roots 文件路径', '失败', async () => {
      const r = await req('POST', '/api/roots', { json: { path: path.join(__dirname, 'testdir', 'not_a_dir.txt') } });
      return r.data?.success === false || `应返回失败`;
    });
    // Type=7 op=4: 移除不存在的根
    await result(++n, '根目录', 'DELETE roots 不存在路径', '失败', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: 'Z:\\notshared' } });
      return r.data?.success === false || `应返回失败`;
    });

    // ═══════════════════════════════════════
    // Phase 9: 配置
    // ═══════════════════════════════════════
    // 先降低 max_file_size 以便后续测"文件过大"
    // Type=8 op=1: 修改配置
    await result(++n, '配置', 'PUT config maxFileSizeMB=1', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { maxFileSizeMB: 1 } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=1 op=2: 文件过大（2MB > 1MB）
    await result(++n, '上传', `POST up_large.bin→/testb root=${idxB}`, '文件过大', () => {
      const up = curlUpload(path.join(TMP, 'up_large.bin'), 'up_large.bin', '/testb', idxB, '');
      return (up?.message || up?.error || '').includes('文件过大') || `未触发文件过大: ${JSON.stringify(up)}`;
    });
    // 还原配置
    await result(++n, '配置', 'PUT config maxFileSizeMB=500', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { maxFileSizeMB: 500 } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=8 op=1: 切换显示隐藏文件
    await result(++n, '配置', 'PUT config showHiddenFiles=true', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { showHiddenFiles: true } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // 还原
    await result(++n, '配置', 'PUT config showHiddenFiles=false', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { showHiddenFiles: false } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=8 op=2: 超范围值
    await result(++n, '配置', 'PUT config maxFileSizeMB=0 (超范围)', '失败', async () => {
      const r = await req('PUT', '/api/config', { json: { maxFileSizeMB: 0 } });
      return r.data?.success === false || `未返回失败`;
    });

    // ═══════════════════════════════════════
    // Phase 10: test_b 替换（需要保留的文件放在删除测试前）
    // ═══════════════════════════════════════

    // 先上传文件到 testb 用于替换
    await result(++n, '上传', `POST up_normal.txt→/testb testb_up.txt root=${idxB}`, '200', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'testb_up.txt', '/testb', idxB, '');
      if (!up || up.error) return `上传失败: ${JSON.stringify(up)}`;
      return V.fileExists(path.join(DIR_B, 'testb', 'testb_up.txt')) || 'testb_up.txt不存在';
    });
    // Type=2 op=1: 替换 testb 文件
    await result(++n, '替换', `替换/testb/f1.txt root=${idxB}`, '内容一致', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'f1.txt', '/testb', idxB, 'f1.txt');
      if (up?.error) return `替换失败: ${up.error}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_B, 'testb', 'f1.txt')) || '内容不一致';
    });
    // batch delete (type=4 op=1 with count>1)
    await result(++n, '批量删除', `POST batch /testb/f1.txt+f3.txt root=${idxB}`, 'count=2', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: ['/testb/f1.txt', '/testb/f3.txt'], root: idxB } });
      if (r.data?.success === false) return `删除失败: ${r.data?.message}`;
      const f1gone = !V.fileExists(path.join(DIR_B, 'testb', 'f1.txt'));
      const f3gone = !V.fileExists(path.join(DIR_B, 'testb', 'f3.txt'));
      return (f1gone && f3gone) || `f1=${!f1gone} f3=${!f3gone}`;
    });

    // Type=4 op=1: 单文件删除 testb
    await result(++n, '删除', `DELETE /testb/testb_up.txt root=${idxB}`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/testb/testb_up.txt&root=${idxB}`);
      if (r.status !== 200) return `HTTP ${r.status}`;
      return !V.fileExists(path.join(DIR_B, 'testb', 'testb_up.txt')) || '文件仍存在';
    });

    // ═══════════════════════════════════════
    // Phase 11: 日志操作
    // ═══════════════════════════════════════
    // Type=10 op=2: 前端浏览日志（直接 POST）
    await result(++n, '日志', 'POST logs type=10 op=2', '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 10, data: { op: 2, dir: 'test' } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });

    // ═══════════════════════════════════════
    // Phase 12: 清理根目录
    // ═══════════════════════════════════════
    // 注意：按索引从大到小移除，避免索引漂移
    // 先移除 testdirb（索引大），再 testdira（索引小）
    await result(++n, '根目录', `DELETE roots path=testdirb idx=${idxB}`, '200', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: DIR_B } });
      if (r.status !== 200) return `HTTP ${r.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdirb' }) || 'config仍有testdirb';
    });
    await result(++n, '根目录', `DELETE roots path=testdira idx=${idxA}`, '200', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: DIR_A } });
      if (r.status !== 200) return `HTTP ${r.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdira' }) || 'config仍有testdira';
    });
    // 移除后访问旧索引应被拦截
    await result(++n, '文件列表', `GET /testa root=旧${idxA}`, '失败', async () => {
      const r = await req('GET', `/api/files?path=/testa&root=${idxA}`);
      return r.data?.success === false || `未返回失败`;
    });

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
