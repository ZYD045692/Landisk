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
 * 获取目录文件列表
 * @param {string} dirPath - 目录路径，默认 '/'
 * @param {number} [rootIndex] - 根目录索引（多根目录时指定）
 */
export function fetchFiles(dirPath = '/', rootIndex) {
  const params = { path: dirPath }
  if (rootIndex !== undefined && rootIndex !== null) {
    params.root = rootIndex
  }
  return api.get('/files', { params })
}

export function fetchRoots() {
  return api.get('/roots')
}

/**
 * 获取下载链接
 * @param {string} filePath - 文件路径
 */
export function getDownloadUrl(filePath, rootIndex) {
  let url = `${apiUrl('/download')}?path=${encodeURIComponent(filePath)}`
  if (rootIndex !== undefined && rootIndex !== null) {
    url += `&root=${rootIndex}`
  }
  return url
}

/**
 * 删除文件或目录
 * @param {string} filePath - 文件路径
 */
export function deleteFile(filePath, rootIndex) {
  const params = { path: filePath }
  if (rootIndex !== undefined && rootIndex !== null) {
    params.root = rootIndex
  }
  return api.delete('/delete', { params })
}

/**
 * 添加共享目录
 * @param {string} dirPath - 要添加的目录绝对路径
 */
export function addRoot(dirPath) {
  return api.post('/roots', { path: dirPath })
}

/**
 * 移除共享目录
 * @param {string} dirPath - 要移除的目录绝对路径
 */
export function removeRoot(dirPath) {
  return api.delete('/roots', { data: { path: dirPath } })
}

/**
 * 检查上传文件冲突
 */
export function checkConflicts(targetPath, names, rootIndex) {
  const body = { targetPath, names }
  if (rootIndex !== undefined && rootIndex !== null) {
    body.root = rootIndex
  }
  return api.post('/upload/check', body)
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
 * 用 fetch 下载文件（支持 JSON 错误检测）
 * @param {string} filePath - 文件路径
 * @param {number} [rootIndex] - 根目录索引
 * @returns {Promise<{response: Response, isJson: boolean, data: any}>}
 */
export async function downloadFileBlob(filePath, rootIndex) {
  let url = `${apiUrl('/download')}?path=${encodeURIComponent(filePath)}`
  if (rootIndex !== undefined && rootIndex !== null) {
    url += `&root=${rootIndex}`
  }
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
