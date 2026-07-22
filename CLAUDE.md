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
npm run build:server           # 构建前端 + 打包后端到 server-dist/
npx tauri build                # 生成 NSIS 安装包 (.exe)
```

## 项目概览

**LanDisk** — 局域网文件快传桌面应用。Tauri 2 壳承载一个 Express 服务，同一进程提供 REST API 和 Vue 3 + Element Plus 前端页面。手机和 PC 在同一 WiFi 下访问同一服务，扫码即连。

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) — 窗口/托盘/子进程管理 |
| 前端 | Vue 3 + Vite + Element Plus |
| 后端 | Express (Node.js) |
| 打包 | NSIS |

### Tauri 架构

`src-tauri/src/lib.rs` 管理窗口、系统托盘、单实例锁、开机自启。Express 作为 sidecar 由 Tauri 管理生命周期 — `npm start` = `npx tauri dev`。构建产物：`src-tauri/target/release/bundle/nsis/LanDisk_*_x64-setup.exe`。

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

## 日志结构化 JSON 格式

日志文件 `%USERPROFILE%\.landisk\logs\landisk.log` 每记录一个 JSON 块：

```json
{
  "ts": "2026-07-22 22:04:50",
  "level": "INFO",
  "type": 1,
  "data": { "op": 1, "dir": "D:\\test", "count": 4, "files": [...] }
}
```

### type 码表

| type | 操作 |
|---|---|
| 1 | 新增 |
| 2 | 替换 |
| 3 | 阻断 |
| 4 | 删除 |
| 5 | 下载 |
| 6 | 打开 |
| 7 | 根目录 |
| 8 | 配置 |
| 9 | 启动 |
| 10 | 浏览 |
| 11 | 日志 |
| 12 | 服务 |

### data.op 码表

#### type 1=新增 / 2=替换
```json
{"op": 1, "dir": "D:\\test", "count": 4, "files": [{"name": "a.pdf", "size": "3.5 MB"}]}
```

#### type 3=阻断
```json
{"op": 1, "count": 2, "files": ["setup.exe", "install.bat"]}
```

#### type 4=删除
| op | 含义 |
|---|---|
| 1 | 回收站 |
| 2 | 永久删除 |
| 3 | 失败 |

```json
{"op": 1, "file": "D:\\a.pdf", "dest": "trash"}
{"op": 2, "file": "D:\\a.pdf", "dest": "permanent"}
{"op": 3, "file": "D:\\a.pdf", "error": "not found"}
```

#### type 5=下载
| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

```json
{"op": 1, "file": "report.pdf", "size": "1.2 MB"}
{"op": 2, "file": "report.pdf", "error": "not found"}
```

#### type 6=打开
| op | 含义 |
|---|---|
| 1 | 成功 |
| 2 | 失败 |

```json
{"op": 1, "file": "report.pdf"}
{"op": 2, "file": "report.pdf", "error": "permission denied"}
```

#### type 7=根目录
| op | 含义 |
|---|---|
| 1 | 添加 |
| 2 | 移除 |

```json
{"op": 1, "dir": "D:\\Share"}
{"op": 2, "dir": "D:\\OldShare"}
```

#### type 8=配置
```json
{"op": 1, "field": "port", "value": 22581}
```

#### type 9=启动
```json
{"op": 1, "desc": "local access", "url": "http://localhost:22580"}
```

#### type 10=浏览
```json
{"op": 1, "dir": "D:\\Share", "error": "permission denied"}
```

#### type 11=日志
```json
{"op": 1}
```

#### type 12=服务
```json
{"op": 1, "error": "xxx is not defined"}
```

### data 通用字段

| 字段 | 说明 | 出现于 type |
|---|---|---|
| `dir` | 目录路径 | 1, 2, 7, 10 |
| `file` | 文件路径或文件名 | 4, 5, 6 |
| `files` | 文件列表 | 1, 2, 3 |
| `dest` | 去向（trash/permanent） | 4 |
| `size` | 文件大小文字 | 1, 2, 5 |
| `error` | 错误原因 | 4, 5, 6, 10, 12 |
| `field` | 配置字段名 | 8 |
| `value` | 配置值 | 8 |
| `desc` | 启动描述 | 9 |
| `url` | 访问地址 | 9 |

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