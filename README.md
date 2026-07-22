# LanDisk

局域网文件快传 — 电脑手机在同一 WiFi 下，扫码即连，拖拽传文件。

无需数据线、无需登录、无需安装 App。

## 架构

```
┌──────────────────────────────────────┐
│  Tauri WebView ──▶ localhost:22580 ──┤
│  手机浏览器 ────▶ 192.168.1.x:22580 ─┤
│                                      │
│  Express 同时提供：                    │
│   ├─ 前端页面 (client/dist)           │
│   └─ API (/api/*)                    │
└──────────────────────────────────────┘
```

PC 和手机访问的是同一个 Express 服务，前端只存一份。

## 功能

- 文件浏览、多根目录切换、面包屑导航
- 全局拖拽：拖文件到窗口任意位置即可上传，毛玻璃全屏提示
- 冲突弹窗：同名文件可选替换 / 保留两份 / 取消，支持批量统一操作
- 文件列表刷新时逐格 shimmer 加载效果，列名不受影响
- 删除进回收站 / 永久删除（回收站不可用时自动 fallback），不丢失数据
- 批量删除：多选 + 并行执行 + 百分比进度条，逐条实际去向记录（回收站 / 永久删除）
- 批量下载：多选 + 逐项浏览器下载
- 搜索：文件名过滤
- 排序：名称 / 大小 / 时间 / 类型（后缀）
- 分页：5 / 10 / 20 / 50 条
- 70+ 种文件图标，彩色分类
- 界面内嵌二维码，手机扫码即连
- 内置日志查看器：
  - SSE 实时推送，无需轮询
  - 粘性底部 + 「回到底部」按钮
  - 等级过滤（全部 / INFO / WARN / ERROR）
  - 文本搜索过滤
  - 清除显示 / 清除本地（清空文件+缓冲池）
  - 结构化 JSON 日志，统一 `[操作] N 个 → 目录` 格式
  - 文件名固定 30 显示宽度，`(大小)` 左对齐
  - 服务重启后自动加载最后 100 条历史
- 系统托盘，关闭窗口后台运行
- 开机自启（静默托盘，不弹窗）
- 单实例，多点图标不重复启动
- 界面管理共享目录，持久化到 `%USERPROFILE%\.landisk\`
- 点击文件可用系统默认程序打开（本机）
- 中文文件名上传不乱码
- 可执行扩展名上传阻断（.exe .bat .cmd .ps1 等）
- PC / 手机同源访问，纯本地无联网

## 安装使用

1. 安装 [Node.js](https://nodejs.org) ≥ 18
2. 运行 `LanDisk_0.1.0_x64-setup.exe`
3. 右上角 ⚙ 添加共享目录
4. 点 📱 获取二维码，手机扫码访问

| 操作 | 效果 |
|---|---|
| 关闭窗口 | 隐藏到托盘 |
| 双击托盘 | 显示窗口 |
| 右键托盘 → 开机自启 | 开关开机启动 |
| 右键托盘 → 退出 | 完全退出 |

## 注意事项

- 电脑手机需在同一 WiFi
- 首次启动 Windows 防火墙会弹窗，**必须允许** Node.js
- 端口 `22580`，如冲突修改 `%USERPROFILE%\.landisk\config.json`

## 开发

```bash
npm install && cd client && npm install
```

| 命令 | 说明 |
|---|---|
| `start.bat` | Tauri 桌面开发模式 |
| `start-dev.bat` | 浏览器开发 (:5173) |
| `start-cli.bat` | 仅后端 (:22580) |

### 构建

```bash
npm run build:server   # 构建前端 + 打包服务端到 server-dist/
npx tauri build        # 生成 NSIS 安装包
```

产物：`src-tauri/target/release/bundle/nsis/LanDisk_0.1.0_x64-setup.exe`

## 项目结构

```
├── client/              # Vue 前端
│   └── src/
│       ├── api/         # 请求层
│       ├── components/  # FileTable, UploadZone, LogViewer, SettingsDialog
│       ├── utils/       # format.js (图标/大小/日期), logFormat.js (日志解析)
│       └── views/       # FileBrowser.vue
├── routes/              # Express API
│   ├── files.js         # 目录列表
│   ├── upload.js        # 上传（去重+阻断）
│   ├── download.js      # 文件下载 + 批量下载
│   ├── delete.js        # 删除（回收站/永久）
│   ├── logs.js          # 日志读取/清空/SSE 推流
│   └── roots.js         # 根目录管理
├── utils/
│   └── logger.js        # 环形缓冲区(100条) + 文件写入 + SSE 事件推送
├── scripts/
│   └── bundle-server.js # 打包服务端+前端到 server-dist/
├── src-tauri/           # Tauri Rust
│   └── src/
│       ├── main.rs
│       └── lib.rs       # 窗口/托盘/Express 管理
├── server.js            # Express 入口
├── config.json          # 默认配置
└── start.bat            # 开发启动
```

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) |
| 前端 | Vue 3 + Vite + Element Plus |
| 后端 | Express (Node.js) |
| 打包 | NSIS |

## 配置

`config.json`：

```json
{
  "roots": ["D:/Desktop"],
  "port": 22580,
  "maxFileSizeMB": 500,
  "showHiddenFiles": false
}
```

共享目录也可通过界面 ⚙ 增删，自动持久化到 `%USERPROFILE%\.landisk\`。
