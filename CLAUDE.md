# CLAUDE.md

本文件是给 Claude Code 的项目工作手册：在这个仓库里怎么安全地改代码。**项目是什么、怎么用、整体架构见 [README.md](README.md)**，日志格式与 type/op 码表见 [LOG_FORMAT.md](LOG_FORMAT.md)，测试计划见 [TESTPLAN.md](TESTPLAN.md)。

## 常用命令

```bash
# 后端
npm run server          # Rust 后端直启 (:22580) + 前端静态文件
npm run dev             # 后端热重载：cargo watch --poll 检测变更自动重编（靠 mtime，Windows 可能漏检；用 server-info.buildTs 判断是否最新）
npm start               # npx tauri dev（Tauri 桌面开发模式，自动编译壳+后端）
start-dev.bat           # 当前调试模式：杀旧进程 → 启动 Vite(HMR) + Tauri（beforeDevCommand 编译后端）。浏览器 localhost:5173

# 前端开发
cd client && npm run dev       # Vite dev server (:5173)，/api → localhost:22580
cd client && npm run build     # 构建到 client/dist/

# 全新检出或新增依赖后
npm install && cd client && npm install

# 构建安装包
npm run build:server           # 构建前端 + 编译 Rust 后端 sidecar
npm run build:tauri            # 一键：build:server → npx tauri build → copy-installer
```

### 关于 start-dev.bat 调试模式

`start-dev.bat` 只负责拉起开发环境：杀旧进程 → 启动 Vite(5173) → 启动 Tauri。**后端编译完全交给 tauri dev 的 `beforeDevCommand`**（删 debug exe → `cargo build` → 复制到 binaries，见 tauri.conf.json，避免与 start-dev.bat 重复编译两遍）；因为先删了 exe，cargo 必重编，**后端一定是最新代码**，不依赖 mtime（重跑 start-dev.bat 即可）。前端**不构建 dist**：Tauri webview 加载 Vite dev server（`devUrl=localhost:5173`）源码，改 `.vue`/JS/CSS 即时 HMR 生效，始终最新。

**后端热重载**（改 Rust 代码自动重编）走 `npm run dev`（`cargo watch --poll`）：
- 脚本内用 `--workdir src-tauri/server`，从仓库根直接跑即可（cargo watch 找不到 Cargo.toml 会报 "project root does not exist"）
- cargo watch 靠 mtime 检测变更，Windows 上可能漏检；漏检时后端不会重编、仍跑旧代码

**如何判断后端是不是最新**：后端启动日志会写一行 `[启动] 编译时间 : YYYY-MM-DD HH:mm:ss`，`/api/server-info` 也返回 `buildTs` 字段。改完代码重编后该时间会刷新；**如果还是旧时间，说明 cargo watch 漏检没重编**（用下面的强制重编补救）。

**不需要重启的情况**（改完就能看到）：
- Rust handler 代码（`src-tauri/server/src/main.rs`）
- 前端 Vue / JS / CSS 代码
- 日志格式、API 封装等纯逻辑修改

**必须重启的情况**（需要手动重启 `start-dev.bat`）：
- `tauri.conf.json` 改动
- `Cargo.toml` 新增依赖
- `package.json` 新增依赖
- Tauri 壳代码（`src-tauri/src/`）改动
- 构建脚本（`scripts/`）改动
- `beforeDevCommand` / `beforeBuildCommand` 改动

**cargo watch 漏检时的强制重编**（改完发现 buildTs 没刷新时用）：
```bash
del /F src-tauri\server\target\debug\landisk-server.exe
cargo build --manifest-path src-tauri/server/Cargo.toml
```

## 构建流程

```
① npm --prefix client run build             前端编译到 client/dist/
② node scripts/build-sidecar.js             编译 Rust 后端 → binaries/ landisk-server.exe
③ npx tauri build                           用 binaries/ 作 externalBin 生成 NSIS 安装包
④ node scripts/copy-installer.js            把安装包复制到 dist/
```

`npm run build:server` = ①+②；`npm run build:tauri` = ①+②+③+④。产物：`dist/LanDisk_*_x64-setup.exe`。

## 后端结构（Rust）

```
src-tauri/server/src/
├── main.rs              # axum 路由 + 所有 handler（files/upload/download/delete/roots/config/logs/server-info）
├── config.rs            # 配置加载（数据目录 = LANDISK_DATA_DIR 或程序所在目录）
├── logger/mod.rs        # 环形缓冲区(200条) + 文件写入(1MB 旋转) + SSE 推流
└── middleware/path_safety.rs  # 路径穿越防护
```

### 配置持久化

数据目录优先级：`LANDISK_DATA_DIR` 环境变量（dev/test 指向 `dev-data/`）→ 否则为程序（landisk-server.exe）所在目录。`config.json` 存于数据目录下，首次运行自动创建，字段：`roots[]`（`[{name, path}]`，name 唯一）、`port`, `max_file_size_mb`, `show_hidden_files`。

## 架构模式（改代码必读）

### 路径安全门

`middleware/path_safety.rs` 的 `resolve_safe_path(userPath, roots)` 是所有 API 端点处理用户路径的唯一入口。三种分支：
- 根路径（空或 `/`）→ `'.'`
- 绝对路径（含 `:` 的 Windows 盘符路径）→ 直接校验是否在根目录范围内
- 相对路径 → 剥开头的 `../` 后拼接，校验结果在根目录范围内

**添加新 API 时，任何接受用户路径的参数都必须经此函数校验。**

### 前端路由与虚拟路径

SPA，浏览路径存储在 URL query `?path=/根名/子路径`（**虚拟路径**，第一段为根目录 name，`/` 为虚拟根列出所有根目录）。`FileBrowser.vue` 通过 `vue-router` 的 `useRoute().query.path` 读写，目录导航通过 `router.push({ query: { path } })` 实现，不刷新页面。所有 API 的 `path` 参数均为虚拟路径，由后端 `resolve_virtual_path` 解析到具体根目录。

### Tauri webview 与 API 通信

生产环境 webview 以 `tauri://localhost` 加载前端（frontendDist），API 请求通过注入的 `__LANDISK_PORT__` 拼绝对地址 `http://localhost:{port}/api`。浏览器直接访问时走相对路径 `/api`（Vite 代理或直连）。

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/files` | GET | 目录列表，`?path=`（虚拟路径，第一段为根名；`/` 返回虚拟根列表） |
| `/api/files/open` | POST | 打开文件（系统默认程序）或目录（Windows 资源管理器，均仅桌面应用可打开，远程设备拒绝），`path` 为虚拟路径 |
| `/api/upload` | POST | 上传文件（multipart），`targetPath` 为虚拟路径 |
| `/api/upload/check` | POST | 冲突检测（返回已存在的文件名），`targetPath` 为虚拟路径 |
| `/api/download` | GET | 文件下载，`?path=`（虚拟路径） |
| `/api/delete` | DELETE | 删除到回收站，`?path=`（虚拟路径）；虚拟路径就是共享根本身时被拒绝（请用移除） |
| `/api/delete/batch` | POST | 批量删除，`paths[]` 为虚拟路径；含共享根本身时该项失败 |
| `/api/roots` | GET/POST/DELETE | 根目录增删查（添加可带 `name`，默认取路径最后一段，名称唯一） |
| `/api/roots/rename` | PUT | 重命名共享目录（`path` + `newName`，新名须唯一） |
| `/api/config` | GET/PUT | 配置读写 |
| `/api/server-info` | GET | 返回本机 IP、端口、URL（二维码用） |
| `/api/logs` | GET/DELETE | 日志查询 / 清除（缓冲池+文件+归档） |
| `/api/logs/display` | DELETE | 仅清缓冲池 |
| `/api/logs/stream` | GET | SSE 实时日志推流 |
| `/api/open/logdir` | POST | 打开日志目录（本机资源管理器，仅桌面应用可调） |

## 上传流程

1. 前端检查冲突 → `POST /api/upload/check` → 返回已存在的文件名列表
2. **无冲突** → 直接上传（不论文件数量）
3. **有冲突** → 弹窗让用户逐项选择「替换/保留两份/取消」，单文件也会弹
4. 使用 `XMLHttpRequest`（非 `fetch`）以获得上传进度事件
5. 后端处理去重：同名文件自动加 `(1)` `(2)` 序号
6. 中文文件名由 multer 直接以 UTF-8 处理，无需额外转码

## 删除流程

- 优先调用 PowerShell COM 方法移入回收站（`Microsoft.VisualBasic.FileIO.FileSystem`）
- 回收站不可用时 fallback 到 `fs::remove_file` / `fs::remove_dir_all` 永久删除
- 共享根目录本身禁止直接删除：`handle_delete`/`handle_delete_batch` 用 `is_root_path(resolved, root)` 拦截，返回「不能在根目录删除，请用移除」。虚拟根下共享目录行的按钮是「移除」（`DELETE /api/roots`，只改 config 不碰磁盘），批量栏在虚拟根为「批量移除」

## 前端结构

```
client/src/
├── api/index.js            # Axios 封装 + apiUrl helper，所有 API 函数集中于此
├── components/
│   ├── FileTable.vue       # 文件列表 — PC 端 el-table / 移动端卡片，含搜索/排序/分页/删除；虚拟根行=打开+移除、批量栏=批量移除；壳内文件夹「打开」→资源管理器
│   ├── UploadZone.vue      # 上传区域 + 冲突弹窗 + 进度条 + 全局拖拽监听
│   ├── LogViewer.vue       # 服务器日志查看器 — 筛选/清除/SSE 实时推流
│   ├── SettingsDialog.vue  # 设置弹窗 — 最大上传/显示隐藏/开机自启/日志目录/共享目录管理
│   └── BreadcrumbNav.vue   # 面包屑导航
├── views/
│   └── FileBrowser.vue     # 主视图，组合 BreadcrumbNav + UploadZone + FileTable
├── utils/
│   ├── format.js           # getFileIcon(70+种图标，颜色分类)、formatFileSize、formatDate
│   ├── env.js              # 运行环境：isShell（桌面应用/网页端），启动时一次性判定
│   └── logFormat.js        # 日志条目解析渲染（type/op 码表 → 可读文本）
├── router/index.js         # 单路由 / + 兜底重定向
├── App.vue                 # 根组件：Header/Footer、设置弹窗、二维码、全局拖拽遮罩
└── main.js                 # 入口：注册 Element Plus + 全部图标
```

## 全局拖拽覆盖层

`App.vue` 中监听 `@dragover`/`@drop`，显示毛玻璃全屏提示（`backdrop-filter: blur(8px)`）。三图标对称三角布局。`dragleave` 事件检测鼠标离开窗口边界时关闭覆盖层。

**拖拽分两套逻辑**：
- **桌面应用内（原生拖拽）**：`src-tauri/src/lib.rs` 的 `on_window_event` 接管 `WindowEvent::DragDrop`（Tauri 原生拖拽会消费 DOM 的 `dragover`/`drop`），把绝对路径 + `isDir` 用 `window.eval` 派发 `landisk-drop` / `landisk-dragover` DOM CustomEvent，前端 `App.vue` 监听处理。虚拟根拖入文件夹 = 添加共享目录（`addRootsFromPaths`，重名弹窗改名）；真实目录拖入文件 = 上传（`convertFileSrc` 经 asset 协议读本地文件转 File 交给 UploadZone，保进度条/冲突弹窗）。桌面应用拖拽需要 tauri 的 `protocol-asset` feature + `assetProtocol` 配置。
- **网页端内（DOM 拖拽）**：走 `@drop.prevent="onGlobalDrop"`。**虚拟根拖拽限缩**：浏览器拿不到绝对路径，`App.vue` 的 `setDragover` 在虚拟根 + 非壳时不显示全屏遮罩，但 `onGlobalDrop` 会提示「请在桌面应用中拖入文件夹添加共享目录，或到右上角设置中添加」（避免操作习惯不同步），不添加共享；虚拟根的「在桌面应用中拖入文件夹可添加共享目录」提示两端都显示；真实目录拖入文件 = 上传。
- 判断依据是 `useRoute().query.path` 是否为虚拟根，见 `App.vue` 的 `isVirtualRoot`。

**环境判断**：`client/src/utils/env.js` 启动时一次性判定 `isShell`（`window.__TAURI_INTERNALS__`，可用 `?shell=1/0` 强制——同机浏览器配 `?shell=1` 可测全部桌面应用操作，后端对本机请求天然放行）。客户端只有桌面应用/网页端两种；所有打开类操作（文件/文件夹/日志目录）按 `isShell` 显隐，后端以 `is_local_client`（IP 主机信任）作安全门，「本机」不再是客户端分类。爬虫测试先以网页端模式运行（`?shell=0`），再经 CDP `Page.addScriptToEvaluateOnNewDocument` 注入 `__TAURI_INTERNALS__` 切桌面应用模式。

## 日志系统

日志采用结构化 JSON，完整 type/op 码表见 [LOG_FORMAT.md](LOG_FORMAT.md)。**整体流转链路（写日志 → 缓冲池/文件/SSE 三路 → 前端查看器）见 [README.md](README.md#日志流转)**。

`logger/mod.rs` 维护环形缓冲区（`ringBuffer[]`），上限 **200 条**。所有日志查询 API（`GET /api/logs`）直接从内存读取，零文件 I/O。

**服务启动时**自动从 `landisk.log` 末尾解析最后 **100 条** JSON 条目补入缓冲池，避免重启后日志查看器空白。日志文件写入 `<数据目录>/logs/landisk.log`，超过 1 MB 或跨天时归档为 `landisk-{date}.log`。SSE 推流：日志写入环形缓冲区时通过 `broadcast::channel` 推送，前端 `EventSource` 监听。

### 新增功能日志规范

新增功能时必须添加对应的日志记录，修改顺序严格如下：

1. **日志格式文档** → 先在 [LOG_FORMAT.md](LOG_FORMAT.md) 添加格式定义：
   - type 码表（新操作大类）、data.op 码表（新操作子类型）
   - data 通用字段（如有新字段）
   - 渲染输出效果示例（成功/失败/异常至少各一条）

2. **后端日志系统** → 修改 `src-tauri/server/src/logger/mod.rs`，添加 type/op 常量定义

3. **前端日志渲染** → 修改 `client/src/utils/logFormat.js`，添加新 type/op 的 `parseLog()` 分支

4. **后端 handler 写入** → 在 `src-tauri/server/src/main.rs` 对应 API handler 中调用日志写入

**日志系统核心文件：`src-tauri/server/src/logger/mod.rs`**（环形缓冲区 + 文件写入 + SSE 推流三合一）。

## 其他约定

- **路径归一化**：根目录添加时使用 `dunce::canonicalize` 统一路径大小写，避免 Windows 盘符大小写（`C:` / `c:`、`D:` / `d:` 等）导致同一目录被重复添加。
- **路由兜底**：`client/src/router/index.js` 设有 `/:pathMatch(.*)*` 兜底路由，未知路径自动重定向到 `/`。
- **无共享目录提示**：`client/src/views/FileBrowser.vue` 在 `roots.length === 0` 时显示引导提示，URL 自动清除查询参数。

## 测试

测试遵循**日志激活与全路径覆盖原则**，API 测试覆盖全 type/op，爬虫测试覆盖前端完整交互路径。详见 [TESTPLAN.md](TESTPLAN.md)。

测试脚本位于 `test/` 目录：

| 脚本 | 说明 |
|---|---|
| `test/verify.js` | 文件系统验证工具：dirExists, fileExists, filesMatch, fileIs, checkConfigRoots 等 |
| `test/setup.js` | 创建测试目录 testdir/{testdira/testa, testdirb/testb, testdirc, renamedir/testdira, tmp}（**每个测试运行前都必须先执行**） |
| `test/verify-clean.js` | 删除 testdir/ + 检查 config 残留 |
| `test/server-mgr.js` | 测试用后端服务管理：自动「构建前端→杀旧→起新→等待就绪→停止」，被 test-api / test-crawl 调用 |
| `test/test-api.js` | API 功能测试（87 项），用 verify.js 断言 |
| `test/test-crawl.js` | 爬虫功能测试（63 项，结果表带「模式」列区分网页端/桌面应用），纯 UI 操作（CDP 真实鼠标事件），**双模式顺序**：先以网页端模式运行（`?shell=0`，测下载/批量下载/日志目录提示/通用上传删除/文件过大/多文件上传/保留两份/虚拟根拖拽禁用）→ 再注入 `__TAURI_INTERNALS__` 切桌面应用模式（测打开文件/landisk-drop 拖拽/开机自启 UI，含伪造 `convertFileSrc` 模拟桌面应用 asset:// 上传、伪造 `invoke` 让开机自启查询不抛错）；`nav`/`safe`/`cdpRaw` 等全局由 `test/cdp-wrapper.js` 注入，须 `node -r ./test/cdp-wrapper.js test/test-crawl.js` 运行 |
| `test/capture-screens.js` | 用 CDP 截文档用图到 images/（`node -r ./test/cdp-wrapper.js test/capture-screens.js`） |

> **服务器自动管理**：`test-api.js` / `test-crawl.js` 开始时自动构建前端（`client/dist`）、杀旧后端进程并启动新的（`npm run server` + `LANDISK_DATA_DIR=dev-data`），结束时在 finally 里自动关闭。无需手动起服务。

全部测试通过：`node test/setup.js && node test/test-api.js && node test/setup.js && node -r ./test/cdp-wrapper.js test/test-crawl.js`
