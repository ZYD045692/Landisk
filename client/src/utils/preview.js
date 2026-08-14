/**
 * 文件预览类型判定（点击文件名直接预览）
 * 目前支持：视频（浏览器在线播放）、Markdown（渲染）
 * 后续扩展（图片/PDF/文本等）在此登记即可
 */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.m4v', '.mov', '.ogv', '.mkv', '.avi', '.flv', '.mpeg', '.mpg']
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

/**
 * 返回预览类型：'video' | 'markdown' | null（不支持预览）
 * @param {{ isDirectory?: boolean, extension?: string }} row - 文件行数据
 */
export function getPreviewKind(row) {
  if (!row || row.isDirectory) return null
  const ext = (row.extension || '').toLowerCase()
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
  return null
}

/** 该行是否可预览 */
export function canPreview(row) {
  return getPreviewKind(row) !== null
}
