/**
 * 格式化文件大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

/**
 * 格式化日期
 */
export function formatDate(isoString) {
  if (!isoString) return '-'
  const d = new Date(isoString)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 根据文件扩展名返回图标名和颜色
 */
export function getFileIcon(name, isDirectory, extension) {
  if (isDirectory) return { icon: 'Folder', color: '#E6A23C' }

  const ext = (extension || '').toLowerCase()
  const I = (icon, color = '#909399') => ({ icon, color })

  const map = {
    // 图片 — 绿色
    '.jpg': I('PictureFilled', '#67C23A'), '.jpeg': I('PictureFilled', '#67C23A'),
    '.png': I('PictureFilled', '#67C23A'), '.gif': I('PictureFilled', '#67C23A'),
    '.svg': I('PictureFilled', '#67C23A'), '.webp': I('PictureFilled', '#67C23A'),
    '.bmp': I('PictureFilled', '#67C23A'), '.ico': I('PictureFilled', '#67C23A'),
    '.tiff': I('PictureFilled', '#67C23A'), '.psd': I('PictureFilled', '#67C23A'),
    '.heic': I('PictureFilled', '#67C23A'),
    // 视频 — 红色
    '.mp4': I('VideoCameraFilled', '#F56C6C'), '.avi': I('VideoCameraFilled', '#F56C6C'),
    '.mkv': I('VideoCameraFilled', '#F56C6C'), '.mov': I('VideoCameraFilled', '#F56C6C'),
    '.wmv': I('VideoCameraFilled', '#F56C6C'), '.flv': I('VideoCameraFilled', '#F56C6C'),
    '.webm': I('VideoCameraFilled', '#F56C6C'),
    // 音频 — 紫色
    '.mp3': I('Headset', '#8B5CF6'), '.wav': I('Headset', '#8B5CF6'),
    '.flac': I('Headset', '#8B5CF6'), '.aac': I('Headset', '#8B5CF6'),
    '.ogg': I('Headset', '#8B5CF6'), '.wma': I('Headset', '#8B5CF6'),
    '.m4a': I('Headset', '#8B5CF6'), '.ape': I('Headset', '#8B5CF6'),
    // 文档 — 蓝色
    '.pdf': I('Document', '#E6A23C'), '.doc': I('Document', '#409EFF'),
    '.docx': I('Document', '#409EFF'),
    '.xls': I('DataAnalysis', '#67C23A'), '.xlsx': I('DataAnalysis', '#67C23A'),
    '.csv': I('DataAnalysis', '#67C23A'),
    '.ppt': I('TrendCharts', '#E6A23C'), '.pptx': I('TrendCharts', '#E6A23C'),
    '.txt': I('Ticket', '#909399'), '.md': I('Ticket', '#409EFF'),
    '.log': I('Ticket', '#909399'), '.rtf': I('Ticket', '#909399'),
    // 压缩包 — 棕色
    '.zip': I('FolderOpened', '#B88230'), '.rar': I('FolderOpened', '#B88230'),
    '.7z': I('FolderOpened', '#B88230'), '.tar': I('FolderOpened', '#B88230'),
    '.gz': I('FolderOpened', '#B88230'), '.bz2': I('FolderOpened', '#B88230'),
    '.xz': I('FolderOpened', '#B88230'), '.tgz': I('FolderOpened', '#B88230'),
    // 代码 — 青色
    '.js': I('Monitor', '#0EA5E9'), '.jsx': I('Monitor', '#0EA5E9'),
    '.ts': I('Monitor', '#0EA5E9'), '.tsx': I('Monitor', '#0EA5E9'),
    '.vue': I('Monitor', '#67C23A'), '.svelte': I('Monitor', '#E6A23C'),
    '.html': I('Monitor', '#E6A23C'), '.htm': I('Monitor', '#E6A23C'),
    '.css': I('Monitor', '#0EA5E9'), '.scss': I('Monitor', '#0EA5E9'),
    '.less': I('Monitor', '#0EA5E9'), '.json': I('Monitor', '#F59E0B'),
    '.xml': I('Monitor', '#E6A23C'), '.yaml': I('Monitor', '#E6A23C'),
    '.yml': I('Monitor', '#E6A23C'), '.toml': I('Monitor', '#909399'),
    '.py': I('Monitor', '#306998'), '.java': I('Monitor', '#E6A23C'),
    '.c': I('Monitor', '#909399'), '.cpp': I('Monitor', '#409EFF'),
    '.h': I('Monitor', '#909399'), '.hpp': I('Monitor', '#409EFF'),
    '.rs': I('Monitor', '#E6A23C'), '.go': I('Monitor', '#0EA5E9'),
    '.rb': I('Monitor', '#F56C6C'), '.php': I('Monitor', '#8B5CF6'),
    '.swift': I('Monitor', '#E6A23C'), '.kt': I('Monitor', '#8B5CF6'),
    '.lua': I('Monitor', '#409EFF'), '.sh': I('Monitor', '#67C23A'),
    '.bat': I('Monitor', '#909399'), '.ps1': I('Monitor', '#409EFF'),
    '.sql': I('Monitor', '#0EA5E9'), '.r': I('Monitor', '#409EFF'),
    '.dart': I('Monitor', '#0EA5E9'),
    // 字体 — 粉色
    '.ttf': I('MagicStick', '#EC4899'), '.otf': I('MagicStick', '#EC4899'),
    '.woff': I('MagicStick', '#EC4899'), '.woff2': I('MagicStick', '#EC4899'),
    '.eot': I('MagicStick', '#EC4899'),
    // 镜像
    '.iso': I('Odometer', '#909399'), '.dmg': I('Odometer', '#909399'),
    // 安装包
    '.apk': I('Cellphone', '#67C23A'), '.ipa': I('Cellphone', '#909399'),
    '.exe': I('Platform', '#409EFF'), '.msi': I('Platform', '#409EFF'),
    // 电子书
    '.epub': I('Reading', '#67C23A'), '.mobi': I('Reading', '#67C23A'),
  }

  return map[ext] || I('Document', '#909399')
}
