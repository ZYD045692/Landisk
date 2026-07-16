# LanDisk

局域网文件快传工具 — 电脑启动服务，手机扫码访问，拖拽上传 / 点击下载。

电脑和手机在同一 WiFi 下即可，无需数据线、无需登录、无需安装 App。

## 功能

- **文件浏览** — 多根目录切换，面包屑导航
- **拖拽上传** — 拖文件到窗口即上传，同名自动去重
- **点击下载** — 点文件名直接下载
- **手机扫码** — 界面内嵌二维码，手机浏览器扫码即连
- **搜索排序** — 文件名搜索，名称/大小/时间排序
- **分页** — 5/10/20/50 条每页
- **批量操作** — 多选后批量删除
- **系统托盘** — 关窗口隐藏到托盘，后台持续运行
- **开机自启** — 托盘菜单一键开关
- **目录管理** — 界面增删共享目录，自动持久化
- **单实例** — 多点图标不会重复启动

## 安装使用

1. 安装 [Node.js](https://nodejs.org) ≥ 18
2. 运行 `LanDisk_0.1.0_x64-setup.exe` 安装
3. 启动后在界面右上角 ⚙ 添加共享目录
4. 点 📱 获取二维码，手机扫码访问

## 手机连接

| 操作 | 效果 |
|---|---|
| 关闭窗口 | 隐藏到托盘，后台继续运行 |
| 双击托盘图标 | 显示窗口 |
| 右键托盘 → 退出 | 完全退出 |
| 右键托盘 → 开机自启 | 开关开机启动 |

## 注意事项

- 电脑手机需在同一 WiFi（或电脑开热点手机连）
- 首次启动 Windows 防火墙会弹窗，**必须允许** Node.js 访问网络
- 后端端口 `22580`，如有冲突修改 `config.json`

## 开发

### 环境

- Node.js ≥ 18
- Rust

### 安装

```bash
npm install
cd client && npm install
```

### 启动

| 命令 | 说明 |
|---|---|
| `start.bat` | Tauri 桌面开发模式 |
| `start-dev.bat` | 纯前端开发（浏览器 :5173） |
| `start-cli.bat` | 仅后端（浏览器 :22580） |

### 构建

```bash
npm run build:server   # 仅构建前端 + 打包服务端
npx tauri build        # 完整打包 → NSIS 安装包
```

产物：`src-tauri/target/release/bundle/nsis/LanDisk_0.1.0_x64-setup.exe`

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2 (Rust) |
| 前端 | Vue 3 + Vite + Element Plus |
| 后端 | Express (Node.js) |
| 打包 | NSIS |

## 项目结构

```
├── client/              # Vue 前端
│   └── src/
│       ├── api/         # 请求层
│       ├── components/  # FileTable, UploadZone, BreadcrumbNav
│       ├── utils/       # format.js
│       └── views/       # FileBrowser.vue
├── middleware/          # Express 中间件
│   └── pathSafety.js    # 路径穿越防护
├── routes/              # API 路由
│   ├── files.js         # 目录列表
│   ├── upload.js        # 上传（去重 + 扩展名阻断）
│   ├── download.js      # 文件下载
│   └── delete.js        # 删除
├── scripts/
│   └── bundle-server.js # 打包服务端
├── src-tauri/           # Tauri Rust
│   └── src/
│       ├── main.rs
│       └── lib.rs       # 窗口、托盘、进程管理
├── server.js            # Express 入口
├── config.json          # 配置文件
└── start.bat            # 开发启动
```

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

共享目录也可通过界面 ⚙ 按钮增删。
