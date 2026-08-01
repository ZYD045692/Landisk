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
write(D('testdira', 'testa', 't.xyz'),  'test_a - xyz for open test');
write(D('testdira', 'testa', 'subdir', 'note.txt'), 'note in subdir');
mkdir(D('testdira', 'empty'));
console.log('  ✔ testdir/testdira/testa/ (f1.txt f2.txt f3.txt t.xyz subdir/)');
console.log('  ✔ testdir/testdira/empty/ (empty dir)\n');

mkdir(D('testdirb', 'testb'));
write(D('testdirb', 'testb', 'f1.txt'), 'test_b - file 1 content');
write(D('testdirb', 'testb', 'f2.txt'), 'test_b - file 2 content');
write(D('testdirb', 'testb', 'f3.txt'), 'test_b - file 3 content');
write(D('testdirb', 'testb', 't.xyz'),  'test_b - xyz for open test');
console.log('  ✔ testdir/testdirb/testb/ (f1.txt f2.txt f3.txt t.xyz)\n');

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

console.log('  环境准备完成');
console.log('═══════════════════════════════');
