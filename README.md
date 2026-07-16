# LanDisk

局域网文件快传工具 — PC 启动服务，手机扫码即连，拖拽上传 / 点击下载。

## 使用场景

```
电脑上放个文件 → 手机扫码 → 下载到手机
手机拍张照 → 浏览器上传 → 电脑收到
```

电脑和手机在同一个 WiFi 下即可，无需数据线、无需登录、无需安装 App。

## 截图

```
┌─────────────────────────────────┐
│  📁 LanDisk    📱  ⚙            │
├─────────────────────────────────┤
│  共享目录：[kaoyan        ▼]     │
│  [搜索...]  [名称▲] [大小] [时间] │
│                                 │
│  ☐ 📄 document.pdf   2.3 MB     │
│  ☐ 📁 photos/         --        │
│  ☐ 🎵 song.mp3       5.1 MB     │
│                                 │
│  ◀ 1 2 3 ▶  10条/页  共25条     │
├─────────────────────────────────┤
│        LanDisk · 内网文件服务     │
└─────────────────────────────────┘
```

## 功能

- **文件浏览** — 多根目录切换，面包屑导航
- **上传下载** — 拖拽上传、点击下载、批量删除
- **搜索排序** — 文件名搜索，名称/大小/时间排序
- **分页** — 5/10/20/50 条每页
- **手机连接** — 界面内嵌二维码，手机扫码即连
- **系统托盘** — 关闭窗口隐藏到托盘，后台持续服务
- **开机自启** — 托盘菜单一键开关
- **目录管理** — 界面增删共享目录，自动持久化

## 使用说明

### 启动

双击桌面快捷方式或 `landisk.exe`，窗口打开后托盘出现图标，后端自动启动。

### 手机连接

1. 点窗口右上角 📱 按钮打开二维码
2. 手机扫描二维码（确保在同一 WiFi）
3. 手机浏览器打开后即可浏览/下载/上传文件
4. 也可手动输入二维码下方显示的地址（如 `http://192.168.1.12:3000`）

### 托盘操作

| 操作 | 效果 |
|---|---|
| 关闭窗口 | 隐藏到托盘，后台继续运行 |
| 双击托盘图标 | 显示窗口 |
| 右键 → 显示窗口 | 恢复窗口 |
| 右键 → 开机自启 | 开关开机自动启动 |
| 右键 → 退出 | 完全退出程序 |

### 上传限制

- 默认最大文件 **500 MB**（可在 `config.json` 中修改 `maxFileSizeMB`）
- 以下扩展名被拦截：`.exe` `.bat` `.cmd` `.ps1` `.sh` `.msi` `.dll` `.sys` `.vbs` `.scr`
- 同名文件自动加序号 `(1)` `(2)`，不会覆盖

### 注意

- 电脑和手机必须在**同一局域网**（连同一个 WiFi，或电脑开热点手机连）
- 首次启动时 Windows 防火墙可能弹窗，**必须允许** `node.exe` 访问网络
- `config.json` 位于安装目录，可通过界面"管理共享目录"增删，无需手动编辑

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) |
| 前端 | Vue 3 + Vite + Element Plus |
| 后端 | Express (Node.js) |
| 打包 | NSIS 安装包 |

## 开发

### 环境要求

- Node.js ≥ 18
- Rust (for Tauri)

### 安装依赖

```bash
npm install
cd client && npm install
```

### 启动

| 命令 | 说明 |
|---|---|
| `start.bat` | Tauri 桌面开发模式（Express + Vite + WebView） |
| `start-dev.bat` | 纯前端开发（Express + Vite 分窗，浏览器访问 :5173） |
| `start-cli.bat` | 仅后端（Express，浏览器访问 :3000） |

### 安装使用

安装包：`LanDisk_0.1.0_x64-setup.exe`

**需要 Node.js 环境**（当前未捆绑 Node.js）。安装前请确保已安装 [Node.js](https://nodejs.org/) ≥ 18。

安装后首次启动会自动启动 Express 后端服务，托盘图标常驻，关闭窗口即隐藏到托盘。

## 构建

```bash
# 生成 Windows 安装包
npx tauri build
```

产物位置：`src-tauri/target/release/bundle/nsis/LanDisk_0.1.0_x64-setup.exe`

构建过程会自动：
1. `npm --prefix client run build` — 构建前端
2. `node scripts/bundle-server.js` — 打包服务端（含生产依赖）
3. `cargo build --release` — 编译 Rust
4. `makensis` — 生成 NSIS 安装包

## 项目结构

```
├── client/             # Vue 前端
│   └── src/
│       ├── api/        # API 请求层
│       ├── components/ # FileTable, UploadZone, BreadcrumbNav
│       ├── utils/      # format.js (图标/大小/日期)
│       └── views/      # FileBrowser.vue
├── middleware/         # Express 中间件
│   └── pathSafety.js   # 路径穿越防护
├── routes/             # Express API 路由
│   ├── files.js        # 目录列表
│   ├── upload.js       # 文件上传（去重 + 扩展名阻断）
│   ├── download.js     # 文件下载
│   └── delete.js       # 文件/目录删除
├── scripts/
│   └── bundle-server.js # Tauri 打包前：复制服务端文件 + 生产依赖
├── src-tauri/          # Tauri Rust 代码
│   └── src/
│       ├── main.rs     # 入口
│       └── lib.rs      # 窗口管理、托盘、Express 进程管理
├── server.js           # Express 入口
├── config.json         # 共享目录配置（可通过界面管理）
├── gen-tauri-icons.js  # 图标生成脚本
└── start.bat           # Tauri 开发启动
```

## 配置

`config.json` 示例：

```json
{
  "roots": ["D:/Desktop/kaoyan"],
  "port": 3000,
  "maxFileSizeMB": 500,
  "showHiddenFiles": false
}
```

共享目录可通过界面右上角齿轮按钮添加/删除，修改自动持久化。

## 常见问题

**Q: 启动后显示"加载失败"或白屏？**
A: 确认已安装 Node.js ≥ 18。命令行运行 `node --version` 检查。

**Q: 手机扫二维码打不开？**
A: 确认手机和电脑在同一 WiFi 下。检查 Windows 防火墙是否拦截了 Node.js（控制面板 → 防火墙 → 允许应用 → 找到 Node.js）。

**Q: 端口 3000 被占用？**
A: 修改 `config.json` 中的 `port`，重启应用。

**Q: 怎么彻底退出？**
A: 右键托盘图标 → 退出。直接关窗口只是隐藏到托盘。

**Q: 上传按钮没反应 / 拖拽不生效？**
A: 确认至少添加了一个共享目录（右上角齿轮 → 添加目录）。没有共享目录时无法上传。
