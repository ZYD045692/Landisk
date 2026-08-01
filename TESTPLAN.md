# LanDisk 测试计划
## 前置准备

1. 构建前端: `npm run build`
2. 启动后端: `npm run server`（Rust 后端，端口 22580 + 前端静态文件）
3. 启动 Chrome CDP: `chrome --remote-debugging-port=9222`
4. 确认后端和 Chrome 就绪

## 测试原则

1. **日志激活与全路径覆盖**：API 测试应尽可能触发所有可由后端 handler 写入的 type/op 日志，让各类日志都能在日志查看器中显示。爬虫测试模拟人操作前端的完整路径（添加根 → 导航 → 上传/删除 → 查看日志 → 清理），覆盖前端独有的日志写入（取消、浏览切换）和界面渲染正确性
2. **双维度验证**：每条操作先看 API 返回码，再用 verify.js 在文件系统确认结果
3. **try/finally 包裹**：每个测试脚本全部逻辑在 try 内，finally 跑 verifyClean
4. **verifyClean 直接删整个 testdir/**：每个操作已由 verify.js 即时验证，清洁时不再统计剩余文件明细，直接删除整个目录完事

## 目录结构

```
test/
  testdir/
    testdira/            ← 共享根 A
      testa/             ← 操作目录，API 可删整个目录
        f1.txt f2.txt f3.txt t.xyz
      empty/             ← 空目录
    testdirb/            ← 共享根 B
      testb/
        f1.txt f2.txt f3.txt t.xyz
    tmp/                 ← 上传临时文件
      up_normal.txt      → 普通上传
      up_exe.exe         → exe 上传测试（未实现阻断）
      up_conflict.txt    → 冲突替换
      up_large.bin       → 2 MB, 文件过大测试
    not_a_dir.txt        → 文件，用于"路径不是目录"测试
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
| test/verify.js | 工具函数：文件系统检查 + lockFile/httpReq/getLogs/logContains |
| test/setup.js | 创建 testdir/ 目录结构和测试文件（**每个测试运行前都必须先执行**） |
| test/verify-clean.js | 删除整个 testdir/ + 若 config 有残留则报错 |
| test/test-api.js | API 功能测试（52 项），覆盖全 type/op（**前置：setup.js**） |
| test/test-crawl.js | 爬虫功能测试（22 项），覆盖前端交互全景（**前置：setup.js**） |

## API 功能测试项（52 项）

每项测试：执行 API 操作 → 检查返回码 → 用 verify.js 文件系统验证。
路径由测试脚本拼接绝对路径：`DIR_A = testdir/testdira`, `DIR_B = testdir/testdirb`, `TMP_DIR = testdir/tmp`。

> 下表列出关键场景，完整 52 项以 `test/test-api.js` 为准。

**激活的日志类型**：type=1 op=1/2, type=2 op=1, type=4 op=1/3, type=5 op=1/2, type=6 op=1/2, type=7 op=1/3/4, type=8 op=1/2, type=10 op=3, type=11 op=1/2

**顺序依赖**：上传→替换→保留两份 串联依赖；配置先改小 max_file_size 再测"文件过大"再复原；日志清理放在最后；根目录按索引从大到小移除。

| # | 类型 | 操作 | 激活日志 |
|---|---|---|---|
| 1 | 文件列表 | GET /testa root=A | — |
| 2 | 文件列表 | GET /testb root=B | — |
| 3 | 文件列表 | GET / 无root | type=4 op=3（请求参数错误） |
| 4 | 浏览 | GET /nonexist root=A | type=10 op=3（系统找不到） |
| 5 | 上传 | POST new.txt → /testa | type=1 op=1（新增成功） |
| 6 | 上传exe | POST exe → /testa | type=1 op=1（上传成功，未实现阻断） |
| 7 | 冲突检测 | POST check new.txt | — |
| 8 | 替换 | POST up_conflict 替换 new.txt | type=2 op=1（替换成功） |
| 9 | 保留两份 | POST 同名上传 无replace | type=1 op=1（新增成功+重命名） |
| 10 | 上传 | POST root=999 | type=1 op=2（无效根目录） |
| 11 | 上传 | POST 穿越路径 ../ | type=1 op=2（无权访问） |
| 12 | 打开 | POST /testa/t.xyz | type=6 op=1（打开成功） |
| 13 | 打开 | POST /testa/nonexist.txt | type=6 op=2（找不到文件） |
| 14 | 打开 | POST /testa（目录） | type=6 op=2（不能打开目录） |
| 15 | 打开 | POST 空body | type=6 op=2（请求参数错误） |
| 16 | 打开 | POST root=999 | type=6 op=2（无效根目录） |
| 17 | 下载 | GET /testa/f1.txt | type=5 op=1（下载成功） |
| 18 | 下载 | GET /testb/f1.txt | type=5 op=1（下载成功） |
| 19 | 下载 | GET /testa/nonexist.txt | type=5 op=2（找不到文件） |
| 20 | 下载 | GET /testa（目录） | type=5 op=2（不能下载目录） |
| 21 | 下载 | GET 无root | type=5 op=2（请求参数错误） |
| 22 | 下载 | GET root=999 | type=5 op=2（无效根目录） |
| 23 | 删除 | DELETE /testa/f2.txt | type=4 op=1（回收站成功） |
| 24 | 删除 | DELETE /testa/nonexist.txt | type=4 op=3（找不到文件） |
| 25 | 删除 | DELETE 无root | type=4 op=3（请求参数错误） |
| 26 | 删除 | DELETE root=999 | type=4 op=3（无效根目录） |
| 27 | 删除 | DELETE /testa（目录） | type=4 op=1（回收站成功） |
| 28 | 删除 | DELETE /testa（已删） | type=4 op=3（找不到文件） |
| 29 | 根目录 | POST roots 重复添加 | type=7 op=3（已在共享列表） |
| 30 | 根目录 | POST roots 不存在路径 | type=7 op=3（目录不存在） |
| 31 | 根目录 | POST roots 文件路径 | type=7 op=3（路径不是目录） |
| 32 | 根目录 | DELETE roots 不存在路径 | type=7 op=4（不在共享列表） |
| 33 | 配置 | PUT maxFileSizeMB=1 | type=8 op=1（修改成功） |
| 34 | 上传 | POST up_large.bin（2MB>1MB） | type=1 op=2（文件过大） |
| 35 | 配置 | PUT maxFileSizeMB=500（还原） | type=8 op=1（修改成功） |
| 36 | 配置 | PUT showHiddenFiles=true | type=8 op=1（修改成功） |
| 37 | 配置 | PUT showHiddenFiles=false | type=8 op=1（修改成功） |
| 38 | 配置 | PUT maxFileSizeMB=0（超范围） | type=8 op=2（保存失败） |
| 39 | 上传 | POST → /testb testb_up.txt | type=1 op=1（新增成功） |
| 40 | 替换 | POST 替换 /testb/f1.txt | type=2 op=1（替换成功） |
| 41 | 删除 | DELETE /testb/testb_up.txt | type=4 op=1（回收站成功） |
| 42 | 日志 | POST logs type=10 op=2 | type=10 op=2（前端浏览） |
| 43 | 日志 | DELETE /logs/display | type=11 op=2（清缓冲区） |
| 44 | 日志 | DELETE /logs | type=11 op=1（清空全部） |
| 45 | 根目录 | DELETE roots testdirb | type=7 op=2（移除成功） |
| 46 | 根目录 | DELETE roots testdira | type=7 op=2（移除成功） |
| 47 | 文件列表 | GET 旧root | — |

## 爬虫功能测试项

通过 CDP 操作页面，模拟人操作前端。不截图。纯 UI 操作（关键交互用 CDP 真实鼠标事件 `Input.dispatchMouseEvent`，因为 Element Plus 弹窗确认/checkbox 选择要求受信事件），验证用 `req('GET', '/api/...')` 或 `V.*` 文件系统检查。

**激活的日志类型**：type=1 op=0/1（新增取消/成功）、type=2 op=1（替换成功）、type=4 op=0/1（删除取消/回收站）、type=7 op=1/2（根目录增删）、type=8 op=1（配置修改）、type=10 op=2/3（浏览）

| # | 类型 | 操作 | 预期 | 验证 |
|---|---|---|---|---|
| 1 | 导航 | 导航到 / | 首页显示 | — |
| 2 | 根目录 | 设置→输入路径→添加 testdira | 列表出现 testdira | API: GET /api/roots 含 testdira |
| 3 | 根目录 | 设置→输入路径→添加 testdirb | 列表出现 testdirb | API: GET /api/roots 含 testdirb |
| 4 | 配置 | 设置→点击最大上传值→子弹窗改值→保存 | 配置已更新 (type=8 op=1) | API: GET /api/config 值变化 + GET /api/logs type=8 op=1 |
| 5 | 文件列表 | 下拉选 testdira → 进入 testa/ | 列表 ≥ 3 文件 | dirExists(testdir/testdira/testa/) |
| 6 | 搜索 | 搜索框输入关键词过滤 | 列表过滤 | — |
| 7 | 上传 | 拖拽文件到页面（合成 DragEvent） | 上传成功 | fileExists(testdir/testdira/testa/crawl_up.txt) |
| 8 | 替换 | 同名上传→冲突→点"确定上传" | 已替换 | fileExists(testdir/testdira/testa/crawl_up.txt) |
| 9 | 取消上传 | 同名上传→冲突→点"取消上传" | 已取消 (type=1 op=0) | — |
| 10 | 批量操作 | 勾选全部 | 批量按钮可见 | — |
| 11 | 取消删除 | 行末删除→弹窗→取消 | 文件不变 | fileExists(testdir/testdira/testa/f2.txt) |
| 12 | 删除 | 行末删除→确认 | 文件已删 | !fileExists(testdir/testdira/testa/f2.txt) |
| 13 | 批量操作 | 全选→批量删除 | testa 无文件 | listDir(testdir/testdira/testa/) 为空 |
| 14 | 批量操作 | 面包屑回根→全选→批量删 testa 目录 | 目录已删 | !dirExists(testdir/testdira/testa/) |
| 15 | 浏览 | 导航到不存在的目录（history.pushState 触发路由） | 错误日志 | API: GET /api/logs type=10 op=3 |
| 16 | 文件列表 | 下拉选 testdirb → 进入 testb/ | 列表 ≥ 3 文件 | dirExists(testdir/testdirb/testb/) |
| 17 | 批量操作 | 勾选全部 | 批量按钮可见 | — |
| 18 | 删除 | 行末删除→确认 | 已删除 | — |
| 19 | 批量操作 | 全选→批量删除 | 无文件 | listDir(testdir/testdirb/testb/) 为空 |
| 20 | 批量操作 | 面包屑回根→全选→批量删 testb 目录 | 目录已删 | !dirExists(testdir/testdirb/testb/) |
| 21 | 根目录 | 设置→移除 testdirb | 列表中消失 | API: GET /api/roots 不含 testdirb |
| 22 | 根目录 | 设置→移除 testdira | 列表中消失 | API: GET /api/roots 不含 testdira |

## 测试流程

```
node test/setup.js          # 创建目录和文件
node test/test-api.js       # API 测试（52项），结束后自动清洁
node test/setup.js          # 重新创建目录和文件
node test/test-crawl.js     # 爬虫测试（22项），结束后自动清洁
```
