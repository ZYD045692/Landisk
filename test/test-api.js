/**
 * LanDisk API 功能测试（覆盖全 type/op 日志，虚拟路径）
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
const { startServer, stopServer, backupConfig, clearConfigRoots, restoreConfig } = require('./server-mgr');

const BASE = 'http://localhost:22581';
const DIR_A = path.join(__dirname, 'testdir', 'testdira');
const DIR_B = path.join(__dirname, 'testdir', 'testdirb');
const TMP   = path.join(__dirname, 'testdir', 'tmp');

const TABLE = [];
let pass = 0, fail = 0;

// ─── 测试辅助 ─────────────────────────────

async function req(method, urlPath, opts = {}) {
  return V.httpReq(method, urlPath, opts);
}

function curlUpload(localPath, filename, targetPath, replace) {
  return V.curlUpload(localPath, filename, targetPath, replace);
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

  // 测试前必做：备份并清空共享根（保护用户手动添加的真实共享目录）→ 杀旧后端 → 自动启动新后端
  backupConfig();
  clearConfigRoots();
  if (!(await startServer())) {
    console.error('后端未能启动，终止测试');
    process.exit(1);
  }

  const health = await req('GET', '/api/roots');
  if (health.status !== 200) { console.error('服务未启动'); process.exit(1); }

  let nameA, nameB, n = 0;
  try {
    // 启动日志（type=9）：验证服务地址/编译时间（buildTs 注入），必须在清日志之前查
    await result(++n, '启动', '启动日志 type=9', '含服务地址+编译时间(buildTs)', async () => {
      const logs = await V.getLogs();
      const t9 = logs.filter(l => l && l.type === 9 && l.data);
      const hasUrl = t9.some(l => l.data.desc === '服务地址' && l.data.url && String(l.data.url).includes(':22581'));
      const hasTs = t9.some(l => l.data.desc === '编译时间' && l.data.buildTs && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(String(l.data.buildTs)));
      return (hasUrl && hasTs) || `服务地址=${hasUrl} 编译时间=${hasTs}`;
    });
    // server-info 回归：url/buildTs 在、local 字段已删除
    await result(++n, '服务信息', 'GET /api/server-info', 'url/buildTs 有，local 无', async () => {
      const r = await req('GET', '/api/server-info');
      const d = r.data || {};
      return (!!d.url && !!d.buildTs && d.local === undefined) || `url=${!!d.url} buildTs=${!!d.buildTs} local=${JSON.stringify(d.local)}`;
    });

    // ── 添加根目录（返回根名，虚拟路径第一段） ──
    nameA = await V.resolveRoot(DIR_A);
    nameB = await V.resolveRoot(DIR_B);
    console.log(`  ✔ testdira→root[${nameA}], testdirb→root[${nameB}]\n`);

    // 启动日志 type=9「共享目录 N 个」：仅在启动时有根目录才写，需重启服务验证
    await result(++n, '启动', '重启后 type=9 共享目录日志', '含 共享目录 count≥2', async () => {
      await stopServer();
      if (!(await startServer())) return '后端重启失败';
      const logs = await V.getLogs();
      const t9 = logs.filter(l => l && l.type === 9 && l.data);
      const hasDirs = t9.some(l => l.data.desc === '共享目录' && l.data.count >= 2);
      return hasDirs || '无 共享目录 日志';
    });

    // clear logs first so test-generated logs are fresh for viewing
    await req('DELETE', '/api/logs');
    await req('DELETE', '/api/logs/display');

    // ═══════════════════════════════════════
    // Phase 1: 文件列表
    // ═══════════════════════════════════════

    await result(++n, '文件列表', `GET /${nameA}/testa`, '≥3文件', () => {
      const list = V.listDir(path.join(DIR_A, 'testa'));
      return list.length >= 3 || `仅${list.length}个文件`;
    });
    await result(++n, '文件列表', `GET /${nameB}/testb`, '≥3文件', () => {
      const list = V.listDir(path.join(DIR_B, 'testb'));
      return list.length >= 3 || `仅${list.length}个文件`;
    });
    // 虚拟根：列出所有共享目录
    await result(++n, '文件列表', 'GET / (虚拟根)', '列出所有根', async () => {
      const r = await req('GET', '/api/files?path=/');
      const entries = r.data?.data?.entries || [];
      return entries.length >= 2 || `应≥2个根, 实际${entries.length}`;
    });
    // Type=10 op=3: 浏览不存在的目录
    await result(++n, '浏览', `GET /${nameA}/nonexist`, '200 err', async () => {
      const r = await req('GET', `/api/files?path=/${nameA}/nonexist`);
      return r.status === 200 && r.data?.success === false || '应返回 success=false';
    });
    // Type=10 op=3: 浏览无效根 → 记日志
    await result(++n, '浏览', 'GET /files 无效根', 'type=10 op=3 日志', async () => {
      const r = await req('GET', '/api/files?path=/nonexistentroot/testa');
      if (r.data?.success !== false) return `未拦截: ${JSON.stringify(r.data)}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 10, op: 3 }) || '无 type=10 op=3 日志';
    });
    // Type=10 op=3: 浏览穿越（绝对路径外逃 → 无权访问）→ 记日志
    await result(++n, '浏览', `GET /files 穿越 /${nameA}/C:/Windows/...`, 'type=10 op=3 日志', async () => {
      const r = await req('GET', `/api/files?path=/${nameA}/C:/Windows/system32`);
      if (r.data?.success !== false) return `未拦截: ${JSON.stringify(r.data)}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 10, op: 3 }) || '无 type=10 op=3 日志';
    });

    // ═══════════════════════════════════════
    // Phase 2: 日志操作（前置清空，便于查看后续各操作的日志格式）
    // ═══════════════════════════════════════
    await result(++n, '日志', 'DELETE /logs/display (清显示)', '200', async () => {
      const r = await req('DELETE', '/api/logs/display');
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '日志', 'DELETE /logs (清空全部)', '200', async () => {
      const r = await req('DELETE', '/api/logs');
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '日志', 'POST logs type=4 op=0 (前端删除取消)', '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 4, data: { op: 0, file: 'test.txt' } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });

    // ═══════════════════════════════════════
    // Phase 3: 上传 — 成功场景
    // ═══════════════════════════════════════
    await result(++n, '上传', `POST new.txt→/${nameA}/testa`, '200', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'new.txt', `/${nameA}/testa`, '');
      if (!up || up.error) return `上传失败: ${JSON.stringify(up)}`;
      const actualContent = V.fileExists(path.join(DIR_A, 'testa', 'new.txt')) ? V.readFile(path.join(DIR_A, 'testa', 'new.txt')) : 'FILE_NOT_FOUND';
      return actualContent === 'normal upload content - unique marker NORMAL_DATA' || `内容不匹配: actual=[${actualContent}] resp=${JSON.stringify(up)}`;
    });

    // Type=1 op=2: 阻断 exe (后端未实现阻断, 预期上传成功)
    await result(++n, '阻断', `POST exe→/${nameA}/testa`, '上传成功', () => {
      const up = curlUpload(path.join(TMP, 'up_exe.exe'), 'up_exe.exe', `/${nameA}/testa`, '');
      if (up?.error) return `上传错误: ${up.error}`;
      return V.fileExists(path.join(DIR_A, 'testa', 'up_exe.exe')) || '文件未创建';
    });

    // batch upload (type=1 op=1 with count>1)
    await result(++n, '批量上传', `POST 2 files→/${nameA}/testa`, 'count=2', () => {
      const p1 = TMP.replace(/\\/g, '/') + '/up_normal.txt';
      const p2 = TMP.replace(/\\/g, '/') + '/up_conflict.txt';
      const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=${nameA}/testa" -F "replace=" -F "files=@${p1};filename=batch_a.txt" -F "files=@${p2};filename=batch_b.txt"`;
      let up;
      try { up = JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim()); }
      catch (e) { const m = e.stdout?.toString() || e.message; try { up = JSON.parse(m.trim()); } catch { up = { error: m }; } }
      if (up?.error) return `上传失败: ${up.error}`;
      const count = up.data?.files?.length || 0;
      return count >= 2 || `少于2个文件: ${JSON.stringify(up)}`;
    });

    // cancel logs (simulate frontend behavior via POST /api/logs)
    await result(++n, '取消上传', `POST logs type=1 op=0 单文件`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 1, data: { op: 0, file: 'photo.jpg', dir: `/${nameA}/testa` } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消上传', `POST logs type=1 op=0 批量`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 1, data: { op: 0, count: 3, files: ['a.txt','b.txt','c.txt'], dir: `/${nameA}/testa` } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消删除', `POST logs type=4 op=0 单文件`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 4, data: { op: 0, file: 'test.txt' } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '取消删除', `POST logs type=4 op=0 批量`, '200', async () => {
      const r = await req('POST', '/api/logs', { json: { level: 'info', type: 4, data: { op: 0, count: 5 } } });
      return r.status === 200 || `HTTP ${r.status}`;
    });

    // ═══════════════════════════════════════
    // Phase 3: 冲突检测 / 替换 / 保留两份
    // ═══════════════════════════════════════
    await result(++n, '冲突检测', `POST check new.txt`, 'conflicts含new.txt', async () => {
      const r = await req('POST', '/api/upload/check', { json: { targetPath: `/${nameA}/testa`, names: ['new.txt'] } });
      return r.data?.conflicts?.includes('new.txt') || '未检测到冲突';
    });

    // Type=2 op=1: 替换成功
    await result(++n, '替换', `替换new.txt`, '内容一致', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', `/${nameA}/testa`, 'new.txt');
      if (!up || up.error) return `替换失败: ${JSON.stringify(up)}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_A, 'testa', 'new.txt')) || '内容不一致';
    });

    // Type=1 op=1: 保留两份
    await result(++n, '保留两份', `同名上传(无replace)`, '出现 new (1).txt', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'new.txt', `/${nameA}/testa`, '');
      if (up?.error) return `上传错误: ${up.error}`;
      return V.fileExists(path.join(DIR_A, 'testa', 'new (1).txt')) || 'new (1).txt不存在';
    });
    // Type=2 op=2: 替换失败（目标是一个目录 → 删除/写入都被拒 → type=2 op=2 日志）
    await result(++n, '替换', '替换目录名 ro_dir', 'type=2 op=2 日志', async () => {
      const roDir = path.join(DIR_A, 'testa', 'ro_dir');
      fs.mkdirSync(roDir, { recursive: true });
      try {
        const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'ro_dir', `/${nameA}/testa`, 'ro_dir');
        const logs = await V.getLogs();
        if (!V.logContains(logs, { type: 2, op: 2 })) return `无 type=2 op=2 日志: ${JSON.stringify(up)}`;
        return V.dirExists(roDir) ? true : 'ro_dir 被替换掉了（不应发生）';
      } finally {
        try { fs.rmSync(roDir, { recursive: true, force: true }); } catch {}
      }
    });

    // ═══════════════════════════════════════
    // Phase 4: 上传 — 错误场景
    // ═══════════════════════════════════════
    // Type=1 op=2: 无效的根目录名
    await result(++n, '上传', 'POST check 无效根名', '400', async () => {
      const r = await req('POST', '/api/upload/check', { json: { targetPath: '/nonexistentroot/testa', names: ['new.txt'] } });
      return r.status === 400 || `HTTP ${r.status}`;
    });
    // Type=1 op=2: 无权访问（路径穿越，../ 被清洗后落到根内）
    await result(++n, '上传', `POST 穿越路径`, '成功(../已清洗)', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'up_normal.txt', `/${nameA}/../../etc`, '');
      return up?.success === true || `上传失败 resp=${JSON.stringify(up)}`;
    });
    // Type=1 op=2: 上传没有选择文件
    await result(++n, '上传', 'POST /upload 无文件', '没有选择文件', async () => {
      const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=/${nameA}/testa"`;
      let up;
      try { up = JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim()); }
      catch (e) { const m = e.stdout?.toString() || e.message; try { up = JSON.parse(m.trim()); } catch { up = { error: m }; } }
      return up?.success === false && String(up?.message).includes('没有选择文件') || `未拦截: ${JSON.stringify(up)}`;
    });
    // Type=1 op=2: 上传到无效根目录名
    await result(++n, '上传', 'POST /upload 无效根名', '无效的根目录', async () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'up_normal.txt', '/nonexistentroot/testa', '');
      return up?.success === false && String(up?.message).includes('无效的根目录') || `未拦截: ${JSON.stringify(up)}`;
    });
    // Type=1 op=2: 上传穿越（绝对路径外逃到根外 → 无权访问）
    await result(++n, '上传', `POST 穿越外逃 /${nameA}/C:/Windows/...`, '无权访问', async () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'up_normal.txt', `/${nameA}/C:/Windows/system32/x.txt`, '');
      return up?.success === false && String(up?.message).includes('无权访问') || `未拦截: ${JSON.stringify(up)}`;
    });

    // ═══════════════════════════════════════
    // Phase 5: 打开文件
    // ═══════════════════════════════════════
    // Type=6 op=1: 打开成功
    await result(++n, '打开', `POST /${nameA}/testa/t.txt`, '200', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: `/${nameA}/testa/t.txt` } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=6 op=2: 打开不存在的文件
    await result(++n, '打开', `POST /${nameA}/testa/nonexist`, '200 失败', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: `/${nameA}/testa/nonexist.txt` } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=6 op=1: 打开目录（本机 → 资源管理器，会短暂弹出资源管理器窗口）
    await result(++n, '打开', `POST /${nameA}/testa (目录)`, '成功+日志', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: `/${nameA}/testa` } });
      if (r.data?.success !== true) return `打开目录失败: ${r.data?.message || r.text}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 6, op: 1 }) || '无 type=6 op=1 日志';
    });
    // Type=6 op=2: 缺参数
    await result(++n, '打开', 'POST /api/files/open 无body', '失败', async () => {
      const r = await req('POST', '/api/files/open', { json: {} });
      return r.data?.success === false || `未返回失败`;
    });
    // Type=6 op=2: 无效根目录名
    await result(++n, '打开', 'POST 无效根名', '失败', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: '/nonexistentroot/testa/t.txt' } });
      return r.data?.success === false || `未返回失败`;
    });
    // Type=6 op=2: 打开穿越（绝对路径外逃到根外 → 无权访问）
    await result(++n, '打开', `POST 穿越 /${nameA}/C:/Windows/...`, '无权访问', async () => {
      const r = await req('POST', '/api/files/open', { json: { path: `/${nameA}/C:/Windows/system32/drivers/etc/hosts` } });
      return r.data?.success === false && String(r.data?.message).includes('无权访问') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=6 op=1: 打开日志目录（本机 → 资源管理器，会短暂弹出窗口 + type=6 op=1 日志）
    await result(++n, '打开', 'POST /api/open/logdir', '成功+type=6 op=1', async () => {
      const r = await req('POST', '/api/open/logdir');
      if (r.data?.success !== true) return `失败: ${r.data?.message || r.status}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 6, op: 1 }) || '无 type=6 op=1 日志';
    });

    // ═══════════════════════════════════════
    // Phase 6: 下载
    // ═══════════════════════════════════════
    // Type=5 op=1: 下载成功
    await result(++n, '下载', `GET /${nameA}/testa/f1.txt`, '200', async () => {
      const r = await req('GET', `/api/download?path=/${nameA}/testa/f1.txt`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    await result(++n, '下载', `GET /${nameB}/testb/f1.txt`, '200', async () => {
      const r = await req('GET', `/api/download?path=/${nameB}/testb/f1.txt`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // 大文件下载内容完整（后端流式 ReaderStream 发送：字节一致 + Content-Length 正确）
    await result(++n, '下载', '上传 20MB→下载内容一致', '字节一致+Content-Length', async () => {
      const bigPath = path.join(TMP, 'dl_big.bin');
      fs.writeFileSync(bigPath, Buffer.alloc(20 * 1024 * 1024, 'Y'));
      const up = curlUpload(bigPath, 'dl_big.bin', `/${nameB}/testb`, '');
      if (!(up && up.success)) return `上传失败: ${JSON.stringify(up)}`;
      const res = await fetch(`${BASE}/api/download?path=/${nameB}/testb/dl_big.bin`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      const body = Buffer.from(await res.arrayBuffer());
      const src = fs.readFileSync(bigPath);
      const cl = res.headers.get('content-length');
      if (String(src.length) !== cl) return `Content-Length ${cl} vs 源 ${src.length}`;
      return body.equals(src) ? true : `内容不一致 body=${body.length} src=${src.length}`;
    });
    // Type=5 op=2: 下载不存在的文件
    await result(++n, '下载', `GET /${nameA}/testa/nonexist.txt`, '200 失败', async () => {
      const r = await req('GET', `/api/download?path=/${nameA}/testa/nonexist.txt`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=5 op=2: 不能下载目录
    await result(++n, '下载', `GET /${nameA}/testa`, '200 失败', async () => {
      const r = await req('GET', `/api/download?path=/${nameA}/testa`);
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=5 op=2: 无效根目录名
    await result(++n, '下载', 'GET 无效根名', '失败', async () => {
      const r = await req('GET', '/api/download?path=/nonexistentroot/testa/f1.txt');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=5 op=2: 下载无 path 参数
    await result(++n, '下载', 'GET /download 无path', '请求参数错误', async () => {
      const r = await req('GET', '/api/download');
      return r.data?.success === false && String(r.data?.message).includes('请求参数错误') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=5 op=2: 下载穿越（绝对路径外逃到根外 → 无权访问）
    await result(++n, '下载', `GET 穿越 /${nameA}/C:/Windows/...`, '无权访问', async () => {
      const r = await req('GET', `/api/download?path=/${nameA}/C:/Windows/system32/drivers/etc/hosts`);
      const blocked = r.data?.success === false && String(r.data?.message).includes('无权访问');
      if (!blocked) return `未拦截: ${JSON.stringify(r.data)}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 5, op: 2 }) || '无 type=5 op=2 日志';
    });
    // ═══════════════════════════════════════
    // Phase 6b: 预览（inline=1 + Range 支持 + type=13 日志）
    // ═══════════════════════════════════════
    const f1Path = path.join(DIR_A, 'testa', 'f1.txt');
    const f1Size = fs.statSync(f1Path).size;
    const f1Content = fs.readFileSync(f1Path, 'utf-8');

    // inline=1 初始请求 → 200 + inline disposition + Accept-Ranges + type=13 op=1
    await result(++n, '预览', `GET /${nameA}/testa/f1.txt?inline=1`, 'inline+type=13 op=1', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      const cd = res.headers.get('content-disposition') || '';
      if (!cd.includes('inline')) return `Content-Disposition=${cd}`;
      if (res.headers.get('accept-ranges') !== 'bytes') return '无 Accept-Ranges: bytes';
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 13, op: 1 }) || '无 type=13 op=1 日志';
    });

    // Range bytes=0-4 → 206 + Content-Range + body 长度 5
    await result(++n, '预览', 'Range: bytes=0-4', '206 + Content-Range', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: 'bytes=0-4' } });
      if (res.status !== 206) return `HTTP ${res.status}`;
      const cr = res.headers.get('content-range');
      if (cr !== `bytes 0-4/${f1Size}`) return `Content-Range=${cr}`;
      const body = Buffer.from(await res.arrayBuffer());
      return body.length === 5 || `body 长度 ${body.length}`;
    });

    // Range bytes=-5（后缀）→ 206 + body = 末尾 5 字节
    await result(++n, '预览', 'Range: bytes=-5 (后缀)', '206 + 末尾5字节', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: 'bytes=-5' } });
      if (res.status !== 206) return `HTTP ${res.status}`;
      const body = Buffer.from(await res.arrayBuffer());
      const expected = f1Content.slice(-5);
      return body.toString('utf-8') === expected ? true : `body=${body.toString('utf-8')} 期望=${expected}`;
    });

    // Range bytes=0- → 206 全长 + 内容一致
    await result(++n, '预览', 'Range: bytes=0-', '206 全长一致', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: 'bytes=0-' } });
      if (res.status !== 206) return `HTTP ${res.status}`;
      const body = Buffer.from(await res.arrayBuffer());
      const cl = res.headers.get('content-length');
      if (String(f1Size) !== cl) return `Content-Length ${cl} vs ${f1Size}`;
      return body.toString('utf-8') === f1Content ? true : '内容不一致';
    });

    // Range 越界 → 416 + Content-Range: bytes */size
    await result(++n, '预览', 'Range: bytes=size+100-', '416 + bytes */size', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: `bytes=${f1Size + 100}-` } });
      if (res.status !== 416) return `HTTP ${res.status}`;
      const cr = res.headers.get('content-range');
      return cr === `bytes */${f1Size}` ? true : `Content-Range=${cr}`;
    });

    // preview.md inline → Content-Type: text/markdown
    await result(++n, '预览', `GET /${nameA}/testa/preview.md?inline=1`, 'text/markdown', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/preview.md&inline=1`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      const ct = res.headers.get('content-type') || '';
      return ct.includes('text/markdown') ? true : `Content-Type=${ct}`;
    });

    // 防刷屏：非初始 Range 请求不新增 type=13 日志
    await result(++n, '预览', 'seek Range 不刷日志', 'type=13 计数不变', async () => {
      const count13 = () => V.getLogs().then(ls => ls.filter(l => l.type === 13).length);
      const before = await count13();
      await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: 'bytes=5-10' } });
      await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt&inline=1`, { headers: { Range: 'bytes=3-7' } });
      const after = await count13();
      return after === before || `type=13 日志 ${before} → ${after}`;
    });

    // 下载回归：无 inline → attachment + type=5 op=1（行为不变）
    await result(++n, '下载', `GET /${nameA}/testa/f1.txt 回归`, 'attachment + type=5 op=1', async () => {
      const res = await fetch(`${BASE}/api/download?path=/${nameA}/testa/f1.txt`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      const cd = res.headers.get('content-disposition') || '';
      if (!cd.includes('attachment')) return `Content-Disposition=${cd}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 5, op: 1 }) || '无 type=5 op=1 日志';
    });


    // ═══════════════════════════════════════
    // Phase 7: 删除
    // ═══════════════════════════════════════
    // Type=4 op=1: 单文件删除（回收站）
    await result(++n, '删除', `DELETE /${nameA}/testa/f2.txt`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/testa/f2.txt`);
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const dest = r.data?.data?.dest;
      if (dest !== 'trash') return `dest=${dest}`;
      return !V.fileExists(path.join(DIR_A, 'testa', 'f2.txt')) || 'f2.txt仍存在';
    });
    // Type=4 op=3: 删除不存在的文件
    await result(++n, '删除', `DELETE /${nameA}/testa/nonexist.txt`, '200 失败', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/testa/nonexist.txt`);
      return r.data?.success === false || `应返回失败`;
    });
    // Type=4 op=3: 无效根目录名
    await result(++n, '删除', 'DELETE 无效根名', '失败', async () => {
      const r = await req('DELETE', '/api/delete?path=/nonexistentroot/testa/f3.txt');
      return r.data?.success === false || `未返回失败`;
    });
    // Type=4 op=3: 删除无 path 参数
    await result(++n, '删除', 'DELETE /delete 无path', '请求参数错误', async () => {
      const r = await req('DELETE', '/api/delete');
      return r.data?.success === false && String(r.data?.message).includes('请求参数错误') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=4 op=3: 删除穿越（绝对路径外逃到根外 → 无权访问）
    await result(++n, '删除', `DELETE 穿越 /${nameA}/C:/Windows/...`, '无权访问', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/C:/Windows/system32/x.txt`);
      return r.data?.success === false && String(r.data?.message).includes('无权访问') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=4 op=1: 批量删除（混合文件+文件夹）
    await result(++n, '批量删除', `POST batch /${nameA}/testa/f3.txt+subdir`, '混合删除', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: [`/${nameA}/testa/f3.txt`, `/${nameA}/testa/subdir`] } });
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const f3gone = !V.fileExists(path.join(DIR_A, 'testa', 'f3.txt'));
      const subdirGone = !V.dirExists(path.join(DIR_A, 'testa', 'subdir'));
      return (f3gone && subdirGone) || `f3.txt=${!f3gone} subdir=${!subdirGone}`;
    });
    // Type=4 op=3: 批量删除空 paths → 记日志
    await result(++n, '删除', 'POST batch 空paths', 'type=4 op=3 日志', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: [] } });
      if (r.data?.success !== false) return `未拦截: ${JSON.stringify(r.data)}`;
      const logs = await V.getLogs();
      return V.logContains(logs, { type: 4, op: 3 }) || '无 type=4 op=3 日志';
    });

    // Type=4 op=1: 删除整个目录
    await result(++n, '删除', `DELETE /${nameA}/testa`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/testa`);
      if (r.data?.success === false) return `失败: ${r.data?.message}`;
      const dest = r.data?.data?.dest;
      if (dest !== 'trash') return `dest=${dest}`;
      return !V.dirExists(path.join(DIR_A, 'testa')) || 'testa/仍存在';
    });
    // Type=4 op=3: 删除已删除的目录
    await result(++n, '删除', `DELETE /${nameA}/testa(已删)`, '200 失败', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/testa`);
      return r.data?.success === false || `应返回失败`;
    });
    // Type=4 op=3: 防御——禁止删除共享根目录本身（应从共享列表移除）
    await result(++n, '删除', `DELETE /${nameA} (根本身)`, '失败+磁盘仍在', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}`);
      const blocked = r.data?.success === false && String(r.data?.message).includes('不能在根目录删除');
      if (!blocked) return `未拦截: ${JSON.stringify(r.data)}`;
      const dirStill = V.dirExists(DIR_A);
      const logs = await V.getLogs();
      return (dirStill && V.logContains(logs, { type: 4, op: 3 })) || `dirStill=${dirStill}`;
    });
    // Type=4 op=3: 批量删除含根本身 → 该项失败
    await result(++n, '删除', `POST batch 含 /${nameA}`, '根项失败', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: [`/${nameA}`, `/${nameA}/testa/nonexist.txt`] } });
      if (r.data?.success === false) return `整体失败: ${r.data?.message}`;
      const res = r.data?.data?.results || [];
      const rootItem = res.find(x => x.path === `/${nameA}`);
      const rootBlocked = rootItem && rootItem.success === false && String(rootItem.message).includes('不能在根目录删除');
      if (!rootBlocked) return `根项未拦截: ${JSON.stringify(res)}`;
      const dirStill = V.dirExists(DIR_A);
      const logs = await V.getLogs();
      return (dirStill && V.logContains(logs, { type: 4, op: 3 })) || `dirStill=${dirStill}`;
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
    // Type=7 op=3: 名称重复
    await result(++n, '根目录', 'POST roots 名称重复', '失败', async () => {
      const r = await req('POST', '/api/roots', { json: { path: path.join(__dirname, 'testdir', 'tmp'), name: nameA } });
      return r.data?.success === false || `应返回失败`;
    });
    // Type=7 op=3: 添加根无 path
    await result(++n, '根目录', 'POST roots 无path', '请提供目录路径', async () => {
      const r = await req('POST', '/api/roots', { json: {} });
      return r.data?.success === false && String(r.data?.message).includes('请提供') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=7 op=4: 移除不存在的根
    await result(++n, '根目录', 'DELETE roots 不存在路径', '失败', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: 'Z:\\notshared' } });
      return r.data?.success === false || `应返回失败`;
    });
    // Type=7 op=4: 移除根无 path
    await result(++n, '根目录', 'DELETE roots 无path', '请提供目录路径', async () => {
      const r = await req('DELETE', '/api/roots', { json: {} });
      return r.data?.success === false && String(r.data?.message).includes('请提供') || `未拦截: ${JSON.stringify(r.data)}`;
    });

    // ═══════════════════════════════════════
    // Phase 8b: 根目录重命名（type=7 op=6 成功 / op=7 失败）
    // ═══════════════════════════════════════
    // 双维度验证：重命名后读 config.json 实际文件确认持久化
    const readRootName = (dirPath) => {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dev-data', 'config.json'), 'utf-8'));
        const root = (cfg.roots || []).find(x => x.path.toLowerCase() === dirPath.toLowerCase());
        return root ? root.name : null;
      } catch { return null; }
    };
    await result(++n, '根目录', `PUT roots/rename ${nameB}→renamedB`, 'config.json name 更新', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B, newName: 'renamedB' } });
      if (!r.data?.success) return `重命名失败: ${r.data?.message}`;
      return readRootName(DIR_B) === 'renamedB' || `config 未更新: ${readRootName(DIR_B)}`;
    });
    // 重命名后：新名虚拟路径可用
    await result(++n, '根目录', 'GET /renamedB/testb (新名有效)', '200', async () => {
      const r = await req('GET', '/api/files?path=/renamedB/testb');
      return r.data?.success === true || `新名路径失效: ${JSON.stringify(r.data)}`;
    });
    // 重命名后：旧名虚拟路径失效
    await result(++n, '根目录', `GET /${nameB}/testb (旧名失效)`, '失败', async () => {
      const r = await req('GET', `/api/files?path=/${nameB}/testb`);
      return r.data?.success === false || '旧名路径仍有效';
    });
    // Type=7 op=7: 无 path
    await result(++n, '根目录', 'PUT rename 无path', '请提供', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { newName: 'x' } });
      return r.data?.success === false && String(r.data?.message).includes('请提供') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=7 op=7: 无 newName
    await result(++n, '根目录', 'PUT rename 无newName', '请提供', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B } });
      return r.data?.success === false && String(r.data?.message).includes('请提供') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=7 op=7: newName 为空
    await result(++n, '根目录', 'PUT rename newName为空', '名称不能为空', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B, newName: '  ' } });
      return r.data?.success === false || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=7 op=7: path 不在共享列表
    await result(++n, '根目录', 'PUT rename 不存在路径', '不在共享列表', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: 'Z:\\notexist', newName: 'x' } });
      return r.data?.success === false && String(r.data?.message).includes('不在共享列表') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // Type=7 op=7: 新名与已有根重名
    await result(++n, '根目录', `PUT rename 重名(与${nameA})`, '名称已存在', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B, newName: nameA } });
      return r.data?.success === false && String(r.data?.message).includes('已存在') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // 新名与自身同名：允许（等价不改名）
    await result(++n, '根目录', 'PUT rename 同名不改', '成功', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B, newName: 'renamedB' } });
      return r.data?.success === true || `同名重命名应成功: ${JSON.stringify(r.data)}`;
    });
    // 重命名回原名（恢复，供后续用例）
    await result(++n, '根目录', `PUT rename 改回${nameB}`, 'config.json 恢复', async () => {
      const r = await req('PUT', '/api/roots/rename', { json: { path: DIR_B, newName: nameB } });
      return (r.data?.success === true && readRootName(DIR_B) === nameB) || `恢复失败: ${JSON.stringify(r.data)} config=${readRootName(DIR_B)}`;
    });
    // 日志 type=7 op=6 重命名成功
    await result(++n, '根目录', `日志 type=7 op=6 ${nameB}→renamedB`, '存在', async () => {
      const logs = await V.getLogs();
      return logs.some(l => l.type === 7 && l.data?.op === 6 && l.data?.oldName === nameB && l.data?.newName === 'renamedB') || '无重命名成功日志';
    });

    // ═══════════════════════════════════════
    // Phase 9: 配置
    // ═══════════════════════════════════════
    await result(++n, '配置', 'GET /api/config', '含各字段', async () => {
      const r = await req('GET', '/api/config');
      const d = r.data || {};
      return (d.maxFileSizeMB !== undefined && d.showHiddenFiles !== undefined && d.logPath) ? true : `响应: ${JSON.stringify(d)}`;
    });
    await result(++n, '配置', 'PUT config maxFileSizeMB=1', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { maxFileSizeMB: 1 } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=1 op=2: 文件过大（2MB > 1MB）
    await result(++n, '上传', `POST up_large.bin→/${nameB}/testb`, '文件过大', () => {
      const up = curlUpload(path.join(TMP, 'up_large.bin'), 'up_large.bin', `/${nameB}/testb`, '');
      return (up?.message || up?.error || '').includes('文件过大') || `未触发文件过大: ${JSON.stringify(up)}`;
    });
    await result(++n, '配置', 'PUT config maxFileSizeMB=500', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { maxFileSizeMB: 500 } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
    // Type=8 op=1: 切换显示隐藏文件
    await result(++n, '配置', 'PUT config showHiddenFiles=true', '200', async () => {
      const r = await req('PUT', '/api/config', { json: { showHiddenFiles: true } });
      return r.status === 200 || `HTTP ${r.status}`;
    });
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
    // Phase 10: test_b 操作
    // ═══════════════════════════════════════
    await result(++n, '上传', `POST up_normal.txt→/${nameB}/testb testb_up.txt`, '200', () => {
      const up = curlUpload(path.join(TMP, 'up_normal.txt'), 'testb_up.txt', `/${nameB}/testb`, '');
      if (!up || up.error) return `上传失败: ${JSON.stringify(up)}`;
      return V.fileExists(path.join(DIR_B, 'testb', 'testb_up.txt')) || 'testb_up.txt不存在';
    });
    // Type=2 op=1: 替换 testb 文件
    await result(++n, '替换', `替换/${nameB}/testb/f1.txt`, '内容一致', () => {
      const up = curlUpload(path.join(TMP, 'up_conflict.txt'), 'f1.txt', `/${nameB}/testb`, 'f1.txt');
      if (up?.error) return `替换失败: ${up.error}`;
      return V.filesMatch(path.join(TMP, 'up_conflict.txt'), path.join(DIR_B, 'testb', 'f1.txt')) || '内容不一致';
    });
    // batch delete (type=4 op=1 with count>1)
    await result(++n, '批量删除', `POST batch /${nameB}/testb/f1.txt+f3.txt`, 'count=2', async () => {
      const r = await req('POST', '/api/delete/batch', { json: { paths: [`/${nameB}/testb/f1.txt`, `/${nameB}/testb/f3.txt`] } });
      if (r.data?.success === false) return `删除失败: ${r.data?.message}`;
      const f1gone = !V.fileExists(path.join(DIR_B, 'testb', 'f1.txt'));
      const f3gone = !V.fileExists(path.join(DIR_B, 'testb', 'f3.txt'));
      return (f1gone && f3gone) || `f1=${!f1gone} f3=${!f3gone}`;
    });

    // Type=4 op=1: 单文件删除 testb
    await result(++n, '删除', `DELETE /${nameB}/testb/testb_up.txt`, 'dest=trash', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameB}/testb/testb_up.txt`);
      if (r.status !== 200) return `HTTP ${r.status}`;
      return !V.fileExists(path.join(DIR_B, 'testb', 'testb_up.txt')) || '文件仍存在';
    });

    // ═══════════════════════════════════════
    // Phase 12: 清理根目录
    // ═══════════════════════════════════════
    await result(++n, '根目录', `DELETE roots path=testdirb`, 'success=true+config清', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: DIR_B } });
      if (r.data?.success !== true) return `删除失败: ${r.data?.message || r.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdirb' }) || 'config仍有testdirb';
    });
    await result(++n, '根目录', `DELETE roots path=testdira`, 'success=true+config清', async () => {
      const r = await req('DELETE', '/api/roots', { json: { path: DIR_A } });
      if (r.data?.success !== true) return `删除失败: ${r.data?.message || r.status}`;
      return V.checkConfigRoots({ shouldNotContain: 'testdira' }) || 'config仍有testdira';
    });
    // Type=1 op=2: 无共享目录时上传
    await result(++n, '上传', 'POST /upload 无共享目录', '请先添加共享目录', async () => {
      const p = TMP.replace(/\\/g, '/') + '/up_normal.txt';
      const cmd = `curl -s -X POST "${BASE}/api/upload" -F "targetPath=/${nameA}/testa" -F "files=@${p};filename=noroots.txt"`;
      let up;
      try { up = JSON.parse(require('child_process').execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim()); }
      catch (e) { const m = e.stdout?.toString() || e.message; try { up = JSON.parse(m.trim()); } catch { up = { error: m }; } }
      return up?.success === false && String(up?.message).includes('请先添加共享目录') || `未拦截: ${JSON.stringify(up)}`;
    });
    // Type=4 op=3: 无共享目录时删除
    await result(++n, '删除', 'DELETE /delete 无共享目录', '请先添加共享目录', async () => {
      const r = await req('DELETE', `/api/delete?path=/${nameA}/testa`);
      return r.data?.success === false && String(r.data?.message).includes('请先添加共享目录') || `未拦截: ${JSON.stringify(r.data)}`;
    });
    // 移除后访问已移除的根名应被拦截
    await result(++n, '文件列表', `GET /${nameA}/testa (根已移除)`, '失败', async () => {
      const r = await req('GET', `/api/files?path=/${nameA}/testa`);
      return r.data?.success === false || `未返回失败`;
    });

  } finally {
    verifyClean();
    await stopServer();
    restoreConfig();
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
