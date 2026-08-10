# LanDisk 测试计划
## 前置准备

**无需手动启动服务**，测试脚本自动处理：

1. 前端构建: 由 `test/server-mgr.js` 自动执行（`npm --prefix client run build`，测试加载最新 `client/dist`），无需手动
2. 后端: 由 `test/server-mgr.js` 自动「构建前端 → 杀旧 → 起新（`npm run server` + `LANDISK_DATA_DIR=dev-data`）→ 等待就绪 → 停止」，无需手动 `npm run server`
3. Chrome CDP: 由 `test/cdp-wrapper.js` 自动查找 Chrome 并以 `--remote-debugging-port=9222` 启动，无需手动开启
4. 环境前置: 已 `npm install`、已安装 Chrome

## 测试原则

1. **日志激活与全路径覆盖**：API 测试应尽可能触发所有可由后端 handler 写入的 type/op 日志，让各类日志都能在日志查看器中显示。爬虫测试模拟人操作前端的完整路径（添加根 → 导航 → 上传/删除 → 查看日志 → 清理），覆盖前端独有的日志写入（取消）和界面渲染正确性
2. **双维度验证**：每条操作先看 API 返回码，再用 verify.js 在文件系统确认结果
3. **try/finally 包裹**：每个测试脚本全部逻辑在 try 内，finally 跑 verifyClean
4. **verifyClean 直接删整个 testdir/**：每个操作已由 verify.js 即时验证，清洁时不再统计剩余文件明细，直接删除整个目录完事
5. **爬虫双模式顺序**：爬虫**先以浏览器模式**开始（CDP 不注入壳标志），先测浏览器专属操作——文件行「下载」按钮、批量栏「批量下载」、下载成功 toast（`已开始下载「xx」`）、`?shell=0` 浏览器提示；需要壳专属操作时再经 CDP `Page.addScriptToEvaluateOnNewDocument` 注入 `__TAURI_INTERNALS__` 切**壳模式**，测「打开→资源管理器」「landisk-drop 拖拽」「开机自启 UI」。顺序不可逆（壳模式无下载按钮，全程锁壳会漏掉浏览器专属 UI/toast）

## 目录结构

```
test/
  testdir/
    testdira/            ← 共享根 A
      testa/             ← 操作目录，API 可删整个目录
        f1.txt f2.txt f3.txt t.txt
      empty/             ← 空目录
    testdirb/            ← 共享根 B
      testb/
        f1.txt f2.txt f3.txt t.txt
    testdirc/            ← 拖入添加共享的目标目录
    renamedir/testdira/  ← 拖入重名（与根名 testdira 冲突）的目标目录
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
| test/test-api.js | API 功能测试（87 项），覆盖全 type/op（**前置：setup.js**） |
| test/test-crawl.js | 爬虫功能测试（63 项），覆盖前端交互全景（**前置：setup.js**；须 `node -r ./test/cdp-wrapper.js` 运行以注入 CDP 全局） |

## API 功能测试项（87 项）

每项测试：执行 API 操作 → 检查返回码 → 用 verify.js 文件系统验证。
路径由测试脚本拼接绝对路径：`DIR_A = testdir/testdira`, `DIR_B = testdir/testdirb`, `TMP_DIR = testdir/tmp`。所有 `path` 均为**虚拟路径**（第一段为根目录 name，如 `/testdira/testa`），不再有 `?root=` 参数。

> 下表列出关键场景，完整 87 项以 `test/test-api.js` 为准（编号为实际运行顺序）。

**激活的日志类型**：type=1 op=1/2, type=2 op=1/2, type=4 op=1/3, type=5 op=1/2, type=6 op=1/2, type=7 op=1/3/4/5/6/7, type=8 op=1/2, type=9 op=1, type=10 op=3, type=11 op=0/1/2

> 新增关键项：#2 server-info 回归（`local` 已删除）、#3 重启后 type=9 共享目录启动日志、#24 上传无效根名、#25/#31/#39/#44 四类「穿越外逃→无权访问」（upload/open/download/delete）、#32 打开日志目录（含 type=6 op=1 断言）、#43 删除无 path、#54/#56 roots 无 path、#57 GET config、#70/#71 无共享目录时上传/删除、#21 替换目录名 → type=2 op=2 替换失败日志、#8/#9 files 无效根/穿越 → type=10 op=3 日志、#49 batch 空 paths → type=4 op=3 日志。爬虫新增：重复拖入→type=7 op=3、改名取消/移除取消→type=7 op=5（add/remove）。

**顺序依赖**：上传→替换→保留两份 串联依赖；配置先改小 max_file_size 再测"文件过大"再复原；**日志清理放在最前**（先清空，便于查看后续各操作的日志格式）；根目录按路径移除。

| # | 类型 | 操作 | 激活日志 |
|---|---|---|---|
| 1 | 文件列表 | GET /testa root=A | — |
| 2 | 文件列表 | GET /testb root=B | — |
| 3 | 文件列表 | GET / 无root | type=4 op=3（请求参数错误） |
| 4 | 浏览 | GET /nonexist root=A | type=10 op=3（系统找不到） |
| 5 | 日志 | DELETE /logs/display | type=11 op=2（清缓冲区） |
| 6 | 日志 | DELETE /logs | type=11 op=1（清空全部） |
| 7 | 日志 | POST logs type=4 op=0 | type=4 op=0（删除取消） |
| 8 | 上传 | POST new.txt → /testa | type=1 op=1（新增成功） |
| 9 | 上传exe | POST exe → /testa | type=1 op=1（上传成功，未实现阻断） |
| 10 | 冲突检测 | POST check new.txt | — |
| 11 | 替换 | POST up_conflict 替换 new.txt | type=2 op=1（替换成功） |
| 12 | 保留两份 | POST 同名上传 无replace | type=1 op=1（新增成功+重命名） |
| 13 | 上传 | POST root=999 | type=1 op=2（无效根目录） |
| 14 | 上传 | POST 穿越路径 ../ | type=1 op=2（无权访问） |
| 15 | 打开 | POST /testa/t.txt | type=6 op=1（打开成功） |
| 16 | 打开 | POST /testa/nonexist.txt | type=6 op=2（找不到文件） |
| 17 | 打开 | POST /testa（目录） | type=6 op=1（本机→资源管理器打开，会短暂弹出窗口） |
| 18 | 打开 | POST 空body | type=6 op=2（请求参数错误） |
| 19 | 打开 | POST root=999 | type=6 op=2（无效根目录） |
| 20 | 下载 | GET /testa/f1.txt | type=5 op=1（下载成功） |
| 21 | 下载 | GET /testb/f1.txt | type=5 op=1（下载成功） |
| 22 | 下载 | GET /testa/nonexist.txt | type=5 op=2（找不到文件） |
| 23 | 下载 | GET /testa（目录） | type=5 op=2（不能下载目录） |
| 24 | 下载 | GET 无root | type=5 op=2（请求参数错误） |
| 25 | 下载 | GET root=999 | type=5 op=2（无效根目录） |
| 26 | 删除 | DELETE /testa/f2.txt | type=4 op=1（回收站成功） |
| 27 | 删除 | DELETE /testa/nonexist.txt | type=4 op=3（找不到文件） |
| 28 | 删除 | DELETE 无root | type=4 op=3（请求参数错误） |
| 29 | 删除 | DELETE root=999 | type=4 op=3（无效根目录） |
| 30 | 删除 | DELETE /testa（目录） | type=4 op=1（回收站成功） |
| 31 | 删除 | DELETE /testa（已删） | type=4 op=3（找不到文件） |
| 32 | 根目录 | POST roots 重复添加 | type=7 op=3（已在共享列表） |
| 33 | 根目录 | POST roots 不存在路径 | type=7 op=3（目录不存在） |
| 34 | 根目录 | POST roots 文件路径 | type=7 op=3（路径不是目录） |
| 35 | 根目录 | DELETE roots 不存在路径 | type=7 op=4（不在共享列表） |
| 36 | 配置 | PUT maxFileSizeMB=1 | type=8 op=1（修改成功） |
| 37 | 上传 | POST up_large.bin（2MB>1MB） | type=1 op=2（文件过大） |
| 38 | 配置 | PUT maxFileSizeMB=500（还原） | type=8 op=1（修改成功） |
| 39 | 配置 | PUT showHiddenFiles=true | type=8 op=1（修改成功） |
| 40 | 配置 | PUT showHiddenFiles=false | type=8 op=1（修改成功） |
| 41 | 配置 | PUT maxFileSizeMB=0（超范围） | type=8 op=2（保存失败） |
| 42 | 上传 | POST → /testb testb_up.txt | type=1 op=1（新增成功） |
| 43 | 替换 | POST 替换 /testb/f1.txt | type=2 op=1（替换成功） |
| 44 | 删除 | DELETE /testb/testb_up.txt | type=4 op=1（回收站成功） |
| 44b | 根目录 | PUT roots/rename testdirb→renamedB | type=7 op=6（重命名成功）+ config.json name 更新 |
| 44c | 根目录 | GET /renamedB/testb（新名有效） | — |
| 44d | 根目录 | GET /testdirb/testb（旧名失效） | type=10 op=3（无效根目录） |
| 44e | 根目录 | PUT roots/rename 失败场景（无path/无newName/空/重名/不在列表） | type=7 op=7（重命名失败） |
| 44f | 根目录 | PUT roots/rename 改回 testdirb | config.json name 恢复 |
| 45 | 根目录 | DELETE roots testdirb | type=7 op=2（移除成功） |
| 46 | 根目录 | DELETE roots testdira | type=7 op=2（移除成功） |
| 47 | 文件列表 | GET 旧root | — |
| 1 | 启动 | 启动日志（服务地址/编译时间） | type=9 op=1（buildTs 注入生效） |
| 21 | 上传 | POST /upload 无文件 | type=1 op=2（没有选择文件） |
| 32 | 下载 | GET /download 无path | type=5 op=2（请求参数错误） |
| 33 | 下载 | GET 穿越（绝对路径外逃） | type=5 op=2（无权访问） |
| 40 | 删除 | DELETE 根本身 | type=4 op=3（不能在根目录删除）+ 磁盘仍在 |
| 41 | 删除 | POST batch 含根本身 | type=4 op=3（该项失败） |
| 59 | 上传 | POST /upload 无共享目录（根已全移除） | type=1 op=2（请先添加共享目录） |

## 爬虫功能测试项

通过 CDP 操作页面，模拟人操作前端。不截图。纯 UI 操作（关键交互用 CDP 真实鼠标事件 `Input.dispatchMouseEvent`，因为 Element Plus 弹窗确认/checkbox 选择要求受信事件），验证用 `req('GET', '/api/...')` 或 `V.*` 文件系统检查。

**双模式顺序**：爬虫**先以网页端模式**运行（`?shell=0`，不注入 `__TAURI_INTERNALS__`）——测浏览器专属操作（文件行「下载」、批量下载、日志目录提示、无共享引导、通用上传/删除/配置）；再经 CDP `addScriptToEvaluateOnNewDocument` 注入 `__TAURI_INTERNALS__` 切**桌面端模式**（`?shell=1`）——测打开(资源管理器/默认程序)、`landisk-drop` 拖拽、开机自启 UI、虚拟根移除/批量移除。结果表带「模式」列区分网页端/桌面端。

**桌面端能力边界**：开机自启开关的**显示**（默认关闭）可测；真实 toggle（enable/disable IPC）、托盘、窗口等能力爬虫测不了，人工验证。

**激活的日志类型**：type=1 op=0/1/2（新增取消/成功/拒绝）、type=2 op=1（替换成功）、type=4 op=0/1（删除取消/回收站）、type=5 op=1/2（下载成功/失败）、type=6 op=1/2（打开成功/失败）、type=7 op=1/2/3/4/5/6/7（根目录增删/拒绝/取消/重命名）、type=8 op=1/2（配置修改/失败）、type=10 op=3（浏览打开失败）、type=11 op=0/1/2（日志清空）

| # | 模式 | 类型 | 操作 | 预期 | 验证 |
|---|---|---|---|---|---|
| 1 | 网页端 | 导航 | 导航到 / | 首页显示 | — |
| 2 | 网页端 | 引导 | 无共享目录时显示引导 | 提示「请先添加共享目录」 | DOM 校验（el-empty 含「请先添加共享目录」） |
| 3 | 网页端 | 根目录 | 设置→输入路径→添加 testdira | 列表出现 testdira | API: GET /api/roots 含 testdira |
| 4 | 网页端 | 根目录 | 设置→输入路径→添加 testdirb | 列表出现 testdirb | API: GET /api/roots 含 testdirb |
| 5 | 网页端 | 根目录 | 设置→重复添加 testdira | 已在共享列表 (type=7 op=3) | API: GET /api/logs type=7 op=3「已在共享列表」+ toast |
| 6 | 网页端 | 根目录 | 设置→添加不存在路径 | 目录不存在 (type=7 op=3) | API: GET /api/logs type=7 op=3「目录不存在」 |
| 7 | 网页端 | 根目录 | 设置→添加文件路径 | 路径不是目录 (type=7 op=3) | API: GET /api/logs type=7 op=3「路径不是目录」 |
| 7b | 网页端 | 根目录 | 共享目录行有「重命名」按钮 | 重命名存在 | DOM 校验（root-item 行按钮数 ≥2） |
| 7c | 网页端 | 根目录 | 点重命名 → 弹窗预填当前名 | 预填 testdira | DOM: .rename-row input value=testdira |
| 7d | 网页端 | 根目录 | 改新名 renamedA → 保存 | 列表更新 + type=7 op=6 | DOM: root-item 含 renamedA + API: logs type=7 op=6 newName=renamedA |
| 7e | 网页端 | 根目录 | 重命名改回 testdira | config 恢复 | DOM: root-item 含 testdira |
| 7f | 网页端 | 根目录 | 重命名空名→保存 | 拒绝 + 弹窗不关 | DOM: .el-message「名称不能为空」+ .rename-row 仍在 |
| 7g | 网页端 | 根目录 | 重命名重名（testdirb）→保存 | 拒绝 | DOM: .el-message--error「已存在」 |
| 8 | 网页端 | 配置 | 设置→最大上传调高→保存→**再调回 500** | 更新后还原 500 | API: config 值变化 + type=8 op=1 日志 |
| 9 | 网页端 | 配置 | 设置→最大上传填 10000（超范围） | 拒绝且值不变 | API: config 值不变 + warning toast |
| 10 | 网页端 | 配置 | 显示隐藏文件开关→`.hidden.txt` 出现 | 开关切换后隐藏文件可见 | DOM: .hidden.txt 行出现（需先进入 empty/） |
| 10b | 网页端 | 网页端 | 虚拟根拖拽（伪造 File.path 拖入 testdirc） | 提示行显示 + 无遮罩 + 提示「请在桌面应用」+ 不添加共享 | DOM: .virtual-root-hint 显示、无 .global-drop-overlay、toast 含「请在桌面应用」+ API: /api/roots 无 testdirc |
| 11 | 网页端 | 文件列表 | 虚拟根→点 testdira→进入 testa/ | 列表 ≥ 3 文件 | dirExists(testdir/testdira/testa/) |
| 12 | 网页端 | 网页端 | 文件行按钮=下载、批量栏有批量下载 | 网页端 UI 生效 | DOM 校验 |
| 13 | 网页端 | 下载 | 点文件行「下载」 | toast 已开始下载 + type=5 op=1 | API: GET /api/logs type=5 op=1 + EMS success |
| 14 | 网页端 | 下载 | 全选→批量下载 | toast「已下载 N 个」 | EMS success |
| 15 | 网页端 | 搜索 | 搜索框输入关键词过滤 | 列表过滤 | — |
| 16 | 网页端 | 排序 | 点「名称」排序（升→降） | 文件顺序变化 | DOM: 全部行名顺序变化 |
| 17 | 网页端 | 分页 | 切 pageSize=5 | 每页 ≤5 行 | DOM: 行数 ≤5 |
| 18 | 网页端 | 上传 | 拖拽文件到页面（合成 DragEvent） | 上传成功 | fileExists(testdir/testdira/testa/crawl_up.txt) |
| 19 | 网页端 | 上传 | **连续上传 2 个文件**（bulk_a/bulk_b） | 两个文件都成功 | fileExists(testa/bulk_a.txt) + fileExists(testa/bulk_b.txt) |
| 20 | 网页端 | 替换 | 同名上传→冲突→点"确定上传" | 已替换 (type=2 op=1) | fileExists(testdir/testdira/testa/crawl_up.txt) |
| 21 | 网页端 | 保留两份 | 同名上传→冲突→点"保留两份" | 生成 (1) 文件 | fileExists(testa/crawl_up (1).txt) |
| 22 | 网页端 | 取消上传 | 同名上传→冲突→点"取消上传" | 已取消 (type=1 op=0) | — |
| 23 | 网页端 | 上传 | 拖入文件夹→真实目录 | 拒绝 type=1 op=2 + toast | API: GET /api/logs type=1 op=2 + .el-message--error |
| 24 | 网页端 | 上传 | **文件过大**（上限调至 1MB → 拖 2MB） | 拒绝 type=1 op=2 + toast | API: GET /api/logs type=1 op=2「文件过大」 |
| 25 | 网页端 | 上传 | **冲突项取消 + 新文件成功**（拖 crawl_up 冲突→取消，mixed_a/b 成功） | 成功 2 个 + 取消 1 个日志 | fileExists(mixed_a/b) + type=1 op=0 日志 |
| 26 | 网页端 | 取消删除 | 行末删除→弹窗→取消 | 文件不变 (type=4 op=0) | fileExists(testdir/testdira/testa/f2.txt) |
| 27 | 网页端 | 删除 | 行末删除 f2.txt→确认 | 文件已删 (type=4 op=1) | !fileExists(testdir/testdira/testa/f2.txt) |
| 28 | 网页端 | 删除 | **删除已从磁盘消失的文件**（后端 fs 删 t.txt 后 UI 删） | type=4 op=3 + toast | API: GET /api/logs type=4 op=3「系统找不到」 |
| 29 | 网页端 | 批量操作 | 全选→批量删除（循环删到空） | testa 无文件 | listDir(testdir/testdira/testa/) 为空 |
| 30 | 网页端 | 批量操作 | 面包屑点 testdira→**行内删除 testa 目录**（非全选，保留 empty） | 目录不存在 + empty 保留 | !dirExists(testdir/testdira/testa/) + dirExists(testdir/testdira/empty/) |
| 31 | 网页端 | 浏览 | 导航到不存在的目录（有效根名+不存在子路径） | 错误日志 | API: GET /api/logs type=10 op=3 |
| 32 | 网页端 | 浏览 | URL 直达 /testdira（先回虚拟根再直达） | 保持在 testdira | DOM: 面包屑含 testdira |
| 33 | 网页端 | 网页端 | 点日志目录→提示 | 显示「请在桌面端」提示 | DOM 校验（.el-message） |
| 34 | 桌面端 | 桌面端 | 开机自启设置默认关闭 | 开关为 off | DOM 校验（.el-switch 无 is-checked） |
| 35 | 桌面端 | 文件列表 | 桌面端进入 testdira | empty 目录行存在 | DOM: 行数 ≥1 + 含 empty |
| 36 | 桌面端 | 打开 | **landisk-drop 上传文件→点该行「打开」→默认程序** | type=6 op=1 日志 | API: GET /api/logs type=6 op=1「open_me」 |
| 37 | 桌面端 | 打开 | 桌面端点 empty 目录「打开」→资源管理器 | type=6 op=1 日志 | API: GET /api/logs（会短暂弹出资源管理器窗口） |
| 38 | 桌面端 | 桌面端 | 文件行按钮=打开、批量栏无下载 | 桌面端 UI 生效 | DOM 校验 |
| 39 | 桌面端 | 打开 | 打开日志目录 | type=6 op=1 + toast | API: GET /api/logs type=6 op=1「logs」+ EMS success |
| 40 | 桌面端 | 根目录 | 虚拟根行按钮=移除（无删除） | 移除存在/删除不存在 | DOM 校验 |
| 41 | 桌面端 | 根目录 | 行末「移除」→ 确认弹窗 → 取消 | type=7 op=5 (remove) 日志 | API: GET /api/logs type=7 op=5 |
| 42 | 桌面端 | 根目录 | 虚拟根行末「移除」testdirb → 确认 | config 消失+磁盘仍在 | API: /api/roots 不含 testdirb + dirExists(testdir/testdirb) |
| 43 | 桌面端 | 根目录 | 虚拟根拖入 testdirc 文件夹添加共享（伪造 File.path） | config 出现 testdirc | API: /api/roots 含 testdirc |
| 44 | 桌面端 | 根目录 | 重复拖入同一目录→已在共享列表 | type=7 op=3 日志 + toast | API: GET /api/logs type=7 op=3「已在共享列表」+ .el-message--error |
| 45 | 桌面端 | 根目录 | 移除刚拖入的 testdirc | config 消失 | API: /api/roots 不含 testdirc |
| 46 | 桌面端 | 根目录 | 拖入重名目录（testdira）→ 改名弹窗 → 以 newroot 添加 | 改名后添加成功 | API: /api/roots 含 name=newroot |
| 47 | 桌面端 | 根目录 | 移除改名添加的 newroot | config 消失 | API: /api/roots 不含 newroot |
| 48 | 桌面端 | 根目录 | 拖入重名 → 改名弹窗 → 取消 | type=7 op=5 (add) 日志 | API: GET /api/logs type=7 op=5 |
| 49 | 桌面端 | 根目录 | 壳内 `landisk-drop` 合成事件（模拟 Rust eval）添加共享 | config 出现 testdirc | API: /api/roots 含 testdirc |
| 50 | 桌面端 | 根目录 | 移除 landisk-drop 添加的 testdirc | config 消失 | API: /api/roots 不含 testdirc |
| 51 | 桌面端 | 根目录 | 壳内拖入**普通文件** → 虚拟根 | 拒绝 type=7 op=3 + toast | API: GET /api/logs type=7 op=3「路径不是目录」+ .el-message--error |
| 52 | 桌面端 | 上传 | 壳内 `landisk-drop` 文件项 → `convertFileSrc` 伪造 asset:// → 真实目录上传 | 文件创建 | fileExists(testdir/testdira/shell_up.txt) + 内容一致 |
| 53 | 桌面端 | 上传 | 壳内拖入**文件夹** → 真实目录 | 拒绝 type=1 op=2 + toast | API: GET /api/logs type=1 op=2「不支持上传文件夹」+ .el-message--warning |
| 54 | 桌面端 | 上传 | 浏览器 DOM 拖文件夹（size=0/type=''）→ UploadZone 拒绝 | type=1 op=2 日志 | API: GET /api/logs type=1 op=2 |
| 55 | 桌面端 | 批量操作 | 虚拟根全选→批量移除→**取消** | type=7 op=5 批量 + config 不变 | API: GET /api/logs type=7 op=5 remove + /api/roots 仍含 testdira |
| 56 | 桌面端 | 批量操作 | 虚拟根全选→批量移除 testdira | config 消失+磁盘仍在 | API: /api/roots 不含 testdira + dirExists(testdir/testdira) |

## 测试流程

```
node test/setup.js          # 创建目录和文件
node test/test-api.js       # API 测试（87项），自动起服务→测试→自动关服务→自动清洁
node test/setup.js          # 重新创建目录和文件
node -r ./test/cdp-wrapper.js test/test-crawl.js   # 爬虫测试（63项），自动起服务→测试→自动关服务→自动清洁
```

> **服务器自动管理**：`test-api.js` / `test-crawl.js` 开始时自动构建前端、再杀旧的 22580 后端进程并启动新的（`npm run server` + `LANDISK_DATA_DIR=dev-data`，等待就绪），结束时在 finally 里自动关闭。**测试前无需手动起服务。** 爬虫测试结束时还会通过 CDP `Browser.close` 自动关闭 Chrome。

> **日志累积展示（有意设计）**：先 API 后爬虫的顺序，加上爬虫**不**清空日志，是有意为之——`landisk.log` 会累积两套套件的操作日志（API 各 handler 的 type/op + 爬虫模拟前端的日志写入），让日志查看器一次看到尽可能全的日志状态。**不要**给爬虫加清空日志操作。唯一的例外：API 测试开头会 `DELETE /logs` 一次（在启动日志/重启检查之后），使后续操作日志格式更清晰；type=9「共享目录」启动日志只在「有根时重启」才写，且会被那次清理抹掉，最终查看器里未必能看到它（已在 API 用例 #3 断言验证）。
