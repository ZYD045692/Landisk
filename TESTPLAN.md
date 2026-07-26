# LanDisk 测试计划
## 前置准备

1. 构建前端: `cd client && npm run build`
2. 启动 Express: `node server.js`
3. 启动 Chrome CDP: `chrome --remote-debugging-port=9222`
4. 确认 Express 和 Chrome 就绪

## 测试原则

1. **双维度验证**：每条操作先看 API 返回码，再用 verify.js 在文件系统确认结果
2. **try/finally 包裹**：每个测试脚本全部逻辑在 try 内，finally 跑 verifyClean
3. **verifyClean 直接删整个 testdir/**：每个操作已由 verify.js 即时验证，清洁时不再统计剩余文件明细，直接删除整个目录完事

## 目录结构

```
test/
  testdir/
    testdira/            ← 共享根 A
      testa/             ← 操作目录，API 可删整个目录
        f1.txt           → 下载测试（内容: "test_a - file 1 content"）
        f2.txt           → 单文件删除测试（内容: "test_a - file 2 content"）
        f3.txt           → 批量操作（内容: "test_a - file 3 content"）
        t.xyz            → 打开文件测试
    testdirb/            ← 共享根 B
      testb/
        f1.txt f2.txt f3.txt t.xyz（test_b 前缀）
    tmp/                 ← 上传临时文件
      up_normal.txt      → "normal upload content - unique marker NORMAL_DATA"
      up_exe.exe         → 空文件，阻断测试
      up_conflict.txt    → "conflict replacement content - unique marker CONFLICT_DATA"
```

## 测试结果格式

测试报告 Markdown 表头：

```
| # | 类型 | 操作 | 预期 | verify | 结果 |
```

报告中的列：`# | 类型 | 操作 | 预期 | verify | 结果`

- verify 列记录文件系统验证结果
- 结果列在最后，填 ✅ 或 ❌

## 脚本

| 脚本 | 职责 |
|---|---|
| test/verify.js | 工具函数：dirExists, fileExists, allExist, filesMatch, fileIs, readFile, listDir, checkConfigRoots |
| test/setup.js | 创建 testdir/{testdira/testa, testdirb/testb, tmp} 及文件 |
| test/verify-clean.js | 删除整个 testdir/ + 若 config 有残留则报错（在 finally 中调用） |
| test/test-api.js | API 功能测试，用 verify.js 断言 |
| test/test-crawl.js | 爬虫功能测试（15 项） |

## API 功能测试项（23 项）

每项测试：执行 API 操作 → 检查返回码 → 用 verify.js 文件系统验证。
路径由测试脚本拼接绝对路径：`DIR_A = testdir/testdira`, `DIR_B = testdir/testdirb`, `TMP_DIR = testdir/tmp`。

**依赖说明**：第 4 项创建 new.txt → 第 6/7/8 项基于它操作。第 17 项删 f2.txt 独立于 20 项删整个 testa/。第 21-23 项先移除 testdirb（索引大）再移除 testdira（索引小），避免数组缩引影响索引定位。

| # | 类型 | 操作 | 预期 | verify |
|---|---|---|---|---|
| 1 | 文件列表 | GET /api/files?path=/testa&root=IDX_A | 200，≥3 条 | dirExists(testdir/testdira/testa/) |
| 2 | 文件列表 | GET /api/files?path=/testb&root=IDX_B | 200，≥3 条 | dirExists(testdir/testdirb/testb/) |
| 3 | 缺 root | GET /api/files (无 root) | 400 | — |
| 4 | 上传 | POST up_normal.txt → /testa new.txt | 200 | fileIs(new.txt, "normal upload content - unique marker NORMAL_DATA") |
| 5 | 阻断 | POST up_exe.exe → /testa | 200 阻断 | !fileExists(testdir/testdira/testa/up_exe.exe) |
| 6 | 冲突检测 | POST /api/upload/check new.txt | 200, conflicts 含 new.txt | — |
| 7 | 替换+对比 | POST up_conflict.txt 替换 /testa/new.txt | 200 | filesMatch(tmp/up_conflict.txt, testdira/testa/new.txt) |
| 8 | 保留两份 | POST 同名 new.txt (无 replace) → /testa | 200 | fileExists(testdir/testdira/testa/new (1).txt) |
| 9 | 取消 | POST /api/upload/check 不存在文件 | 200, conflicts 空 | — |
| 10 | 缺 root | POST /api/upload/check (无 root) | 400 | — |
| 11 | 打开文件 | POST /api/files/open /testa/t.xyz | 200 | — |
| 12 | 缺 root | POST /api/files/open (无 root) | 400 | — |
| 13 | 下载 | GET /api/download /testa/f1.txt | 200 | — |
| 14 | 下载 | GET /api/download /testb/f1.txt | 200 | — |
| 15 | 缺 root | GET /api/download (无 root) | 400 | — |
| 16 | test_b 替换 | POST up_conflict.txt 替换 /testb/f1.txt | 200 | filesMatch(tmp/up_conflict.txt, testdirb/testb/f1.txt) |
| 17 | 单文件删除 | DELETE /testa/f2.txt | 200 dest=trash | !fileExists(testdir/testdira/testa/f2.txt) |
| 18 | 缺 root | DELETE /api/delete (无 root) | 400 | — |
| 19 | 日志 | POST /api/logs type=10 op=2 | 200 | — |
| 20 | 删 testa 目录 | DELETE /testa root=IDX_A | 200 | !dirExists(testdir/testdira/testa/) |
| 21 | 移除 testdirb 根 | DELETE /api/roots path=testdir/testdirb | 200 | checkConfigRoots() 不含 testdirb |
| 22 | 移除 testdira 根 | DELETE /api/roots path=testdir/testdira | 200 | checkConfigRoots() 不含 testdira |
| 23 | 移除后拦截 | GET /api/files root=旧IDX_A | 400 | — |

## 爬虫功能测试项

通过 CDP 操作页面，不截图。纯 UI 操作，无 API 调用。每项后 verify 列用 verify.js 函数文件系统验证。

| # | 类型 | 操作 | 预期 | verify |
|---|---|---|---|---|
| 1 | 导航 | 导航到 / | 首页显示 | — |
| 2 | 根目录 | 设置→输入路径→添加 testdira | root-item 出现 | checkConfigRoots() 含 testdira |
| 3 | 根目录 | 设置→输入路径→添加 testdirb | root-item ≥ 2 | checkConfigRoots() 含 testdirb |
| 4 | 文件列表 | 下拉选 testdira → 进入 testa/ | 列表 ≥ 3 文件 | dirExists(testdir/testdira/testa/) |
| 5 | 批量操作 | 勾选全部 | 批量按钮可见 | — |
| 6 | 删除 | 行末删除→确认 | 确认弹窗 | — |
| 7 | 批量操作 | 全选→批量删除剩余文件 | 文件已删 | !fileExists(testdir/testdira/testa/f2.txt) |
| 8 | 批量操作 | 面包屑回根→全选→批量删 testa 目录 | 目录已删 | !dirExists(testdir/testdira/testa/) |
| 9 | 文件列表 | 下拉选 testdirb → 进入 testb/ | 列表 ≥ 3 文件 | dirExists(testdir/testdirb/testb/) |
| 10 | 批量操作 | 勾选全部 | 批量按钮可见 | — |
| 11 | 删除 | 行末删除→确认 | 确认弹窗 | — |
| 12 | 批量操作 | 全选→批量删除剩余文件 | 文件已删 | listDir(testdir/testdirb/testb/) 为空 |
| 13 | 批量操作 | 面包屑回根→全选→批量删 testb 目录 | 目录已删 | !dirExists(testdir/testdirb/testb/) |
| 14 | 根目录 | 设置→移除 testdirb | root-item 消失 | checkConfigRoots() 不含 testdirb |
| 15 | 根目录 | 设置→移除 testdira | root-item 消失 | checkConfigRoots() 不含 testdira |

## 测试流程

```
node test/setup.js          # 创建目录和文件
node test/test-api.js       # API 测试（23项），结束后自动清洁
node test/setup.js          # 重新创建目录和文件
node test/test-crawl.js     # 爬虫测试（15项），结束后自动清洁
```
