import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

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

/**
 * 获取根目录列表
 */
export function fetchRoots() {
  return api.get('/roots')
}

/**
 * 获取下载链接
 * @param {string} filePath - 文件路径
 */
export function getDownloadUrl(filePath) {
  return `/api/download?path=${encodeURIComponent(filePath)}`
}

/**
 * 删除文件或目录
 * @param {string} filePath - 文件路径
 */
export function deleteFile(filePath) {
  return api.delete('/delete', { params: { path: filePath } })
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

export default api
