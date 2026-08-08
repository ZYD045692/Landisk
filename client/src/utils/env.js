/**
 * 运行环境状态 —— 启动时一次性判定，全局共享，各组件直接 import 消费，不再各自重复判断。
 *
 * 客户端只有两种：桌面应用（Tauri WebView2）与网页端（浏览器）。
 * - isShell：是否桌面应用。
 *   判定依据 window.__TAURI_INTERNALS__；可用 URL 参数 ?shell=1 / ?shell=0 强制覆盖，
 *   以便在浏览器里调试/测试「桌面应用 UI」分支（爬虫测试用 CDP 注入 __TAURI_INTERNALS__ 等价；
 *   同机浏览器配 ?shell=1 可测全部桌面应用操作，后端对本机请求天然放行）。
 *   所有主机级操作（打开文件/文件夹/日志目录）按 isShell 显隐。
 */
import { ref } from 'vue'

export const isShell = ref(false)

let inited = false

export function initEnv() {
  if (inited) return
  inited = true
  const hasTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  const forceShell = q ? q.get('shell') : null
  if (forceShell === '1') isShell.value = true
  else if (forceShell === '0') isShell.value = false
  else isShell.value = hasTauri
}

initEnv()
