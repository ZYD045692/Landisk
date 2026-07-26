# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 后端
npm run server          # 启动生产 Express (:22580)
npm run dev             # 后端开发，node --watch 自动重启
npm start               # npx tauri dev（Tauri 桌面开发模式）

# 前端开发
cd client && npm run dev       # Vite dev server (:5173)，/api → localhost:22580
cd client && npm run build     # 构建到 client/dist/，Express 托管

# 全新检出或新增依赖后
npm install && cd client && npm install

# 构建安装包
npm run build:server           # ① 构建前端(client/dist) → ② 打包后端+依赖到 server-dist/
npx tauri build                # ③ 生成 NSIS 安装包 (.exe)
npm run build:tauri            # 一键：build:server → npx tauri build → copy-installer
```

## 项目概览

**LanDisk** — 局域网文件快传桌面应用。Tauri 2 壳承载一个 Express 服务，同一进程提供 REST API 和 Vue 3 + Element Plus 前端页面。手机和 PC 在同一局域网下访问同一服务，扫码即连。

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) — 窗口/托盘/子进程管理 |
| 前端 | Vue 3 + Vite + Element Plus |
| 后端 | Express (Node.js) |
| 打包 | NSIS |

### Tauri 架构

`src-tauri/src/lib.rs` 管理窗口（1024×633）、系统托盘、单实例锁、开机自启。Express 作为 sidecar 由 Tauri 管理生命周期 — `npm start` = `npx tauri dev`。

### 构建流程

```
① cd client && npm run build         前端编译到 client/dist/
② node scripts/bundle-server.js      复制 server 源码 + client/dist/ + 生产依赖到 server-dist/
③ npx tauri build                    用 server-dist/ 生成 NSIS 安装包
④ node scripts/copy-installer.js     把安装包复制到 dist/
```

`npm run build:server` = ①+②
`npm run build:tauri`  = ①+②+③+④

产物：`dist/LanDisk_*_x64-setup.exe`

### 配置持久化

配置存 `%APPDATA%/LanDisk/config.json`（安装目录可能只读，Program Files 不可写）。首次运行从仓库 `config.json` 复制到用户目录。字段：`roots[]`, `port`, `maxFileSizeMB`, `showHiddenFiles`。

## 架构模式

### 路由工厂模式

每个路由文件导出 `createXxxRouter(config)` 函数，由 `server.js` 注入全局 `config` 对象。**不要在路由中直接 `require` 配置文件。**

```js
// routes/files.js
function createFilesRouter(config) {
  const router = express.Router();
  router.get('/', async (req, res) => { ... });
  return router;
}
module.exports = { createFilesRouter };
```

### 路径安全门

`middleware/pathSafety.js` 的 `resolveSafePath(userPath, roots)` 是所有 API 端点处理用户路径的唯一入口。工作方式：
1. 空路径或 `/` → `'.'`
2. 剥离开头的 `../`、`..\`
3. `path.resolve(root, normalized)` 得到绝对路径
4. 校验绝对路径以 `root + path.sep` 开头（防 `D:/Shared` 匹配 `D:/SharedSecret`）

**添加新 API 时，任何接受用户路径的参数都必须经此函数校验。**

### 前端路由

SPA，浏览路径存储在 URL query `?path=/subfolder` 中。`FileBrowser.vue` 通过 `vue-router` 的 `useRoute().query.path` 读写，目录导航通过 `router.push({ query: { path } })` 实现，不刷新页面。

### 全局状态注入

`App.vue` 通过 `provide()` 注入 roots（根目录列表）和 droppedFiles（全局拖拽文件）。子组件通过 `inject()` 消费。

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/files` | GET | 目录列表，`?path=` + `?root=`(索引) |
| `/api/upload` | POST | 上传文件（multer） |
| `/api/upload/check` | POST | 冲突检测（返回已存在的文件名） |
| `/api/download` | GET | 文件下载，`?path=` |
| `/api/delete` | DELETE | 删除到回收站，`?path=` |
| `/api/roots` | GET/POST/DELETE | 根目录增删查 |
| `/api/server-info` | GET | 返回本机 IP、端口、URL（二维码用） |

## 上传流程

1. 前端检查冲突 → `POST /api/upload/check` → 返回已存在的文件名列表
2. 有冲突 → 弹窗让用户逐项选择「替换/保留两份/取消」
3. 使用 `XMLHttpRequest`（非 `fetch`）以获得上传进度事件
4. 后端 `multer.diskStorage` 中处理去重：同名文件自动加 `(1)` `(2)` 序号
5. 可执行扩展名阻断（`.exe .bat .cmd .ps1 .sh .msi .dll .sys .vbs .scr`）：先写入再立即删除，避免 multer 中途抛错卡死
6. 中文文件名通过 `Buffer.from(raw, 'latin1').toString('utf8')` 修复编码

## 删除流程

- 优先调用 PowerShell COM 方法移入回收站（`Microsoft.VisualBasic.FileIO.FileSystem`）
- 回收站不可用时 fallback 到 `fs.rm` / `fs.unlink` 永久删除
- 批量删除使用 `Promise.allSettled` + 逐项进度百分比

## 前端结构

```
client/src/
├── api/index.js            # Axios 封装，所有 API 函数集中于此
├── components/
│   ├── FileTable.vue       # 文件列表 — PC 端 el-table / 移动端卡片，含搜索/排序/分页/批量删除
│   ├── UploadZone.vue      # 上传区域 + 冲突弹窗 + 进度条 + 全局拖拽监听
│   └── BreadcrumbNav.vue   # 面包屑导航
├── views/
│   └── FileBrowser.vue     # 主视图，组合 BreadcrumbNav + UploadZone + FileTable
├── utils/
│   └── format.js           # getFileIcon(70+种图标，颜色分类)、formatFileSize、formatDate
├── router/index.js         # 单路由 /
├── App.vue                 # 根组件：Header/Footer、设置弹窗、二维码、全局拖拽遮罩
└── main.js                 # 入口：注册 Element Plus + 全部图标
```

## 全局拖拽覆盖层

`App.vue` 中监听 `@dragover`/`@drop`，显示毛玻璃全屏提示（`backdrop-filter: blur(8px)`）。三图标对称三角布局：

- **左侧表格图标**：靠上左后方，旋转 -16deg，底层 Z
- **右侧文档图标**：靠上右后方，旋转 16deg，底层 Z
- **中间图表图标**：居中靠下压在前方，最顶层 Z (z-index: 3)

`dragleave` 事件检测鼠标离开窗口边界时关闭覆盖层。

### 日志格式

日志采用结构化 JSON，完整 type/op 码表见 [LOG_FORMAT.md](LOG_FORMAT.md)。

## 日志内存缓冲

`utils/logger.js` 维护一个环形缓冲区（`ringBuffer[]`），上限 **200 条**。所有日志查询 API（`GET /api/logs`）直接从内存读取，零文件 I/O。

**服务启动时**自动从 `landisk.log` 末尾解析最后 **100 条** JSON 条目补入缓冲池，避免重启后日志查看器空白。

### SSE 实时推流

日志写入环形缓冲区时通过 `EventEmitter` 触发 `'log'` 事件。日志 API 路由注册了 `GET /api/logs/stream` SSE 端点，前端通过 `EventSource` 监听实时推送新日志，无需轮询。

```
后端写日志 → ringBuffer.push() + logEmitter.emit('log')
                                         │
                                         ▼
                    GET /api/logs/stream → EventSource.onmessage
                                         │
                                         ▼
                    logEntries.push() + 粘性滚动
```

## 路径归一化

`server.js` 中 `POST /api/roots` 使用 `fs.realpathSync.native()` 统一路径大小写，避免 Windows 盘符大小写（`D:` / `d:`）导致同一目录被重复添加。

## 路由兜底

`client/src/router/index.js` 设有 `/:pathMatch(.*)*` 兜底路由，未知路径自动重定向到 `/`。

## 无共享目录提示

`client/src/views/FileBrowser.vue` 在 `roots.length === 0` 时显示引导提示，URL 自动清除查询参数。

## 测试

测试脚本位于 `test/` 目录：

| 脚本 | 说明 |
|---|---|
| `test/verify.js` | 文件系统验证工具：dirExists, fileExists, filesMatch, fileIs, checkConfigRoots 等 |
| `test/setup.js` | 创建测试目录 testdir/{testdira/testa, testdirb/testb, tmp} |
| `test/verify-clean.js` | 删除 testdir/ + 检查 config 残留 |
| `test/test-api.js` | API 功能测试（23 项），用 verify.js 断言 |
| `test/test-crawl.js` | 爬虫功能测试（15 项），纯 UI 操作 |

全部测试通过：`node test/setup.js && node test/test-api.js && node test/setup.js && node test/test-crawl.js`