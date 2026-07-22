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

export function clearLogs() {
  return api.delete('/logs')
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
 * 记录批量下载日志
 * @param {object} data - { dir, files: [{name, size}] }
 */
export function batchDownloadLog(data) {
  return api.post('/logs', {
    level: 'info',
    message: `${data.files.length} 个 → ${data.dir}`,
    type: 5,
    data: { op: 1, count: data.files.length, dir: data.dir, files: data.files }
  })
}

/**
 * 记录批量删除日志
 * @param {object} data - { dir, files: [{name}] }
 */
export function batchDeleteLog(data) {
  const op = data.dest === '永久删除' ? 2 : 1
  return api.post('/logs', {
    level: 'info',
    message: `${data.files.length} 个 ${data.dir} → ${data.dest}`,
    type: 4,
    data: { op, count: data.files.length, dir: data.dir, dest: data.dest, files: data.files }
  })
}

export default api
