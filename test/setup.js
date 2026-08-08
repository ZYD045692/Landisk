/**
 * 测试环境准备 — testdir/{testdira/testa, testdirb/testb, tmp}
 * 用法: node test/setup.js
 */
const fs = require('fs');
const path = require('path');

const D = (...p) => path.join(__dirname, 'testdir', ...p);

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(f, c) { fs.writeFileSync(f, c); }

console.log('═══════════════════════════════');
console.log('  测试环境准备');
console.log('═══════════════════════════════\n');

// 清理重建
if (fs.existsSync(D())) fs.rmSync(D(), { recursive: true, force: true });

mkdir(D('testdira', 'testa'));
mkdir(D('testdira', 'testa', 'subdir'));
write(D('testdira', 'testa', 'f1.txt'), 'test_a - file 1 content');
write(D('testdira', 'testa', 'f2.txt'), 'test_a - file 2 content');
write(D('testdira', 'testa', 'f3.txt'), 'test_a - file 3 content');
write(D('testdira', 'testa', 't.txt'),  'test_a - txt for open test');
write(D('testdira', 'testa', 'subdir', 'note.txt'), 'note in subdir');
// 分页测试数据：testa 里凑 8+ 个文件，pageSize=5 时才有第 2 页
write(D('testdira', 'testa', 'f4.txt'), 'test_a - file 4 content');
write(D('testdira', 'testa', 'f5.txt'), 'test_a - file 5 content');
write(D('testdira', 'testa', 'f6.txt'), 'test_a - file 6 content');
mkdir(D('testdira', 'empty'));
write(D('testdira', 'empty', '.hidden.txt'), 'hidden file for show-hidden toggle test');
console.log('  ✔ testdir/testdira/testa/ (f1.txt f2.txt f3.txt t.txt subdir/)');
console.log('  ✔ testdir/testdira/empty/ (empty dir + .hidden.txt)\n');

mkdir(D('testdirb', 'testb'));
write(D('testdirb', 'testb', 'f1.txt'), 'test_b - file 1 content');
write(D('testdirb', 'testb', 'f2.txt'), 'test_b - file 2 content');
write(D('testdirb', 'testb', 'f3.txt'), 'test_b - file 3 content');
write(D('testdirb', 'testb', 't.txt'),  'test_b - txt for open test');
console.log('  ✔ testdir/testdirb/testb/ (f1.txt f2.txt f3.txt t.txt)\n');

// 创建超过 1 MB 的大文件（用于触发"文件过大"日志）
const largeBuf = Buffer.alloc(2 * 1024 * 1024, 'X');

mkdir(D('tmp'));
write(D('tmp', 'up_normal.txt'),    'normal upload content - unique marker NORMAL_DATA');
write(D('tmp', 'up_exe.exe'),       '');
write(D('tmp', 'up_conflict.txt'),  'conflict replacement content - unique marker CONFLICT_DATA');
write(D('tmp', 'up_large.bin'),     largeBuf);
console.log('  ✔ testdir/tmp/ (up_normal.txt up_exe.exe up_conflict.txt up_large.bin)\n');

// 普通文件（非目录，用于"路径不是目录"测试）
write(D('not_a_dir.txt'), 'this is a file, not a directory');
console.log('  ✔ testdir/not_a_dir.txt\n');

// 拖入添加共享的目标目录（爬虫用 defineProperty 伪造 File.path 拖入）
mkdir(D('testdirc'));
write(D('testdirc', 'note.txt'), 'drag-add target dir');
console.log('  ✔ testdir/testdirc/ (拖入添加目标)\n');

// 拖入重名目标：目录名 = testdira（与已有根名冲突），但不在任何共享根内
mkdir(D('renamedir', 'testdira'));
write(D('renamedir', 'testdira', 'note.txt'), 'rename-conflict target dir');
console.log('  ✔ testdir/renamedir/testdira/ (拖入重名目标)\n');

console.log('  环境准备完成');
console.log('═══════════════════════════════');
