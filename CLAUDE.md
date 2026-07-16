# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 后端
npm start              # 启动生产服务（需先构建前端）
npm run dev            # 启动后端，文件变更自动重启

# 前端开发
cd client && npm run dev    # Vite dev server (5173)，/api → localhost:3000
cd client && npm run build  # 构建到 client/dist/，Express 直接托管

# 首次或新增依赖后
npm install && cd client && npm install
```

## 架构概览

**单 Express 进程同时提供 API 和静态前端文件。** 生产模式下 `client/dist/` 由 Express 托管；开发模式下 Vite dev server 独立运行并通过 proxy 转发 `/api`。

**路由工厂模式：** 每个路由文件导出 `createXxxRouter(config)` 函数，由 `server.js` 注入全局 `config` 对象。不要直接在路由中 `require` 配置文件。

**路径安全门：** `middleware/pathSafety.js` 的 `resolveSafePath(userPath, roots)` 是所有 API 端点处理用户路径的唯一入口。工作方式：
1. 空路径 or `/` → `'.'`
2. 剥离开头的 `../`、`..\`
3. `path.resolve(root, normalized)` 得到绝对路径
4. 校验绝对路径以 `root + path.sep` 开头（防 `D:/Shared` 匹配 `D:/SharedSecret`）

添加新 API 时，任何接受用户路径的参数都必须经此函数校验。

**前端路由：** 单页应用，当前浏览路径存储在 URL query `?path=/subfolder` 中。`FileBrowser.vue` 通过 `vue-router` 的 `useRoute().query.path` 读写，目录导航通过 `router.push({ query: { path } })` 实现，不刷新页面。

**上传去重：** `routes/upload.js` 中同名文件自动加序号 `(1)` `(2)`，不会覆盖已有文件。上传前 `fileFilter` 阻断可执行扩展名列表（`.exe` `.bat` `.cmd` `.ps1` `.sh` `.msi` `.dll` `.sys` `.vbs` `.scr`）。

**移动端适配：** `FileTable.vue` 使用 CSS `@media (max-width: 768px)` 切换显示 — PC 端 `<el-table>`，移动端卡片列表。`UploadZone.vue` 使用 `XMLHttpRequest`（非 `fetch`）以支持上传进度事件。
