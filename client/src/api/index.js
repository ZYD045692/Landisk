import axios from 'axios'

// Tauri 壳 webview 在 tauri://localhost，API 走绝对地址；浏览器走相对路径（Vite 代理/直连）
const apiBase = (typeof window !== 'undefined' && window.__LANDISK_PORT__)
  ? `http://localhost:${window.__LANDISK_PORT__}/api`
  : '/api'

const api = axios.create({
  baseURL: apiBase,
  timeout: 30000
})

/** 拼完整 API 地址（供 EventSource / XHR / fetch 等非 axios 调用使用） */
export function apiUrl(path) {
  return `${apiBase}${path}`
}

/**
 * 获取目录文件列表（虚拟路径，第一段为根目录名）
 * @param {string} dirPath - 虚拟路径，默认 '/'（虚拟根，列出所有共享目录）
 */
export function fetchFiles(dirPath = '/') {
  return api.get('/files', { params: { path: dirPath } })
}

export function fetchRoots() {
  return api.get('/roots')
}

/**
 * 获取下载链接（虚拟路径）
 * @param {string} filePath - 虚拟文件路径
 */
export function getDownloadUrl(filePath) {
  return `${apiUrl('/download')}?path=${encodeURIComponent(filePath)}`
}

/**
 * 删除文件或目录（虚拟路径）
 * @param {string} filePath - 虚拟文件路径
 */
export function deleteFile(filePath) {
  return api.delete('/delete', { params: { path: filePath } })
}

/**
 * 添加共享目录
 * @param {string} dirPath - 要添加的目录绝对路径
 * @param {string} [name] - 根目录名称（默认取路径最后一段，须唯一）
 */
export function addRoot(dirPath, name) {
  return api.post('/roots', { path: dirPath, name })
}

/**
 * 移除共享目录
 * @param {string} dirPath - 要移除的目录绝对路径
 */
export function removeRoot(dirPath) {
  return api.delete('/roots', { data: { path: dirPath } })
}

/**
 * 重命名共享目录
 * @param {string} dirPath - 根目录绝对路径
 * @param {string} newName - 新名称（须唯一）
 */
export function renameRoot(dirPath, newName) {
  return api.put('/roots/rename', { path: dirPath, newName })
}

/**
 * 检查上传文件冲突（虚拟路径）
 */
export function checkConflicts(targetPath, names) {
  return api.post('/upload/check', { targetPath, names })
}

/**
 * 获取服务端日志
 * @param {number} lines - 返回行数
 */
export function fetchLogs(lines = 200) {
  return api.get('/logs', { params: { lines } })
}

/** 打开日志目录（本机系统资源管理器） */
export function openLogDir() {
  return api.post('/open/logdir')
}

export function clearLogs() {
  return api.delete('/logs')
}

export function clearLogDisplay() {
  return api.delete('/logs/display')
}

/**
 * 获取配置
 */
export function fetchConfig() {
  return api.get('/config')
}

/**
 * 更新配置
 * @param {object} data - { port, maxFileSizeMB, showHiddenFiles }
 */
export function updateConfig(data) {
  return api.put('/config', data)
}

/**
 * 用 fetch 下载文件（支持 JSON 错误检测，虚拟路径）
 * @param {string} filePath - 虚拟文件路径
 * @returns {Promise<{response: Response, isJson: boolean, data: any}>}
 */
export async function downloadFileBlob(filePath) {
  const url = `${apiUrl('/download')}?path=${encodeURIComponent(filePath)}`
  const response = await fetch(url)
  const ct = response.headers.get('content-type') || ''
  const isJson = ct.includes('json')
  let data = null
  if (isJson) {
    data = await response.json()
  }
  return { response, isJson, data }
}

export default api
