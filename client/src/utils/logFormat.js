/** 标签最大显示宽度（[根目录] = 8） */
const TAG_WIDTH = 8

/** 计算字符串显示宽度（CJK = 2，其他 = 1） */
function dispWidth(s) {
  let w = 0
  for (const ch of s) {
    w += /[一-鿿　-ヿ㐀-䶿＀-￯]/.test(ch) ? 2 : 1
  }
  return w
}

/** 补齐标签到固定宽度 */
function padTag(tag) {
  return ' '.repeat(Math.max(0, TAG_WIDTH - dispWidth(tag)))
}

const TYPE_NAMES = {
  1: '新增', 2: '替换', 4: '删除', 5: '下载',
  6: '打开', 7: '根目录', 8: '配置', 9: '启动', 10: '浏览',
  11: '日志', 12: '服务', 13: '预览'
}

/** 从路径中提取纯文件名（去掉目录和开头的 /），目录加 / 后缀 */
function displayFile(path, isDir) {
  if (!path) return ''
  const name = path.replace(/^\/+/, '').replace(/\\/g, '/').split('/').pop() || path
  return isDir ? name + '/' : name
}

/** 从完整路径中截掉根目录路径，得到相对路径 */
function relativeDir(dir, root) {
  if (!dir) return ''
  let d = dir.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/$/, '')
  if (!root || !d) return d
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (d === r) return ''
  if (d.startsWith(r + '/')) return d.slice(r.length + 1)
  return d
}

/**
 * 解析结构化日志条目为 { summary, files[] }，便于前端渲染
 * @param {{ type?: number, data?: object }} entry
 * @returns {{ summary: string, files: string[] } | null}
 */
export function parseLog(entry) {
  if (!entry) return null

  // 非结构化数据，跳过
  if (!entry.type || !entry.data) return null

  const tn = TYPE_NAMES[entry.type] || entry.type
  const tag = `[${tn}]`;
  const d = entry.data
  switch (entry.type) {
    case 1: case 2: {
      if (d.op === 0) {
        if (d.count && d.files) {
          return {
            summary: { op: tag, text: `已取消(${d.count}项)` },
            files: d.files.map(f => ({ prefix: tag, text: `${f.name || f}` }))
          }
        }
        return { summary: { op: tag, text: d.file ? `已取消(1项)` : `已取消` }, files: d.file ? [{ prefix: tag, text: `${displayFile(d.file, d.is_dir)}` }] : d.count ? [{ prefix: tag, text: `(${d.count}项)` }] : [] }
      }
      if (d.op === 2) {
        const failText = entry.type === 2 ? '替换失败' : '上传失败'
        return { summary: { op: tag, text: failText }, files: [{ prefix: tag, text: `${displayFile(d.file, d.is_dir)}` }, { prefix: tag, text: `${d.error}` }] }
      }
      const fileItems = d.files || []
      const dir = relativeDir(d.dir, d.root)
      const prefixText = entry.type === 2 ? '已替换' : '成功'
      const countText = d.count > 1 ? `(${d.count}项)` : ''
      // 目标目录显示「根名/子路径」：上传到子目录 → testdira/testa/，上传到根 → testdira/
      const rootName = d.root ? String(d.root).replace(/[/\\]+$/, '').split(/[\\/]/).pop() : ''
      const dirDisplay = (rootName ? rootName + '/' : '') + (dir ? dir + '/' : '')
      return {
        summary: { op: tag, text: `${prefixText}${countText} → ${dirDisplay}` },
        files: fileItems.map(f => ({ prefix: tag, text: `${f.name}`, size: f.size ? `(${f.size})` : '' }))
      }
    }
    case 3: {
      const fileItems = d.files || []
      return { summary: { op: tag, text: `已阻断(${d.count}项)` }, files: fileItems.map(f => ({ text: f, prefix: tag })) }
    }
    case 4:
      if (d.op === 0) {
        const countText = d.count ? `(${d.count}项)` : (d.file ? `(1项)` : '');
        return { summary: { op: tag, text: `已取消${countText}` }, files: d.file ? [{ prefix: tag, text: `${d.file}` }] : [] }
      }
      if (d.op === 3) {
        return { summary: { op: tag, text: `删除失败` }, files: [{ prefix: tag, text: `${d.file || ''}` }, { prefix: tag, text: `${d.error}` }] }
      }
      if (d.count && d.files) {
        const isPermanent = d.dest === 'permanent'
        const prefixText = isPermanent ? '已永久删除' : '成功'
        const countText = d.count > 1 ? `(${d.count}项)` : ''
        const destSuffix = isPermanent ? '' : ` → 回收站`
        return { summary: { op: tag, text: `${prefixText}${countText}${destSuffix}` }, files: d.files.map(f => ({ text: f.name || f, prefix: tag })) }
      }
      if (d.dest) return { summary: { op: tag, text: `${d.file || ''} → ${d.dest}` } }
      if (d.error) return { summary: { op: tag, text: `${d.file || ''} — ${d.error}` } }
      return { summary: { op: tag, text: `${d.file || ''}` } }
    case 5:
      if (d.op === 2) {
        return { summary: { op: tag, text: `下载失败` }, files: [{ prefix: tag, text: `${displayFile(d.file, d.is_dir)}` }, { prefix: tag, text: `${d.error}` }] }
      }
      if (d.count && d.files) {
        const fileItems = d.files || []
        return {
          summary: { op: tag, text: `${d.count} 个` },
          files: fileItems.map(f => ({ prefix: tag, text: `${f.name}`, size: f.size ? `(${f.size})` : '' }))
        }
      }
      if (d.error) return { summary: { op: tag, text: `${displayFile(d.file, d.is_dir)} — ${d.error}` } }
      return { summary: { op: tag, text: `${displayFile(d.file, d.is_dir)} (${d.size})` } }
    case 6:
      if (d.error) return { summary: { op: tag, text: `打开失败` }, files: [{ prefix: tag, text: `${displayFile(d.file, d.is_dir)}` }, { prefix: tag, text: `${d.error}` }] }
      return { summary: { op: tag, text: `${displayFile(d.file, d.is_dir)}` } }
    case 7:
      if (d.op === 1) return { summary: { op: tag, text: `添加成功` }, files: [{ prefix: tag, text: `${d.dir}` }] }
      if (d.op === 2) return { summary: { op: tag, text: `移除成功` }, files: [{ prefix: tag, text: `${d.dir}` }] }
      if (d.op === 3) return { summary: { op: tag, text: `添加失败` }, files: [{ prefix: tag, text: `${d.dir}` }, ...(d.error ? [{ prefix: tag, text: `${d.error}` }] : [])] }
      if (d.op === 4) return { summary: { op: tag, text: `移除失败` }, files: [{ prefix: tag, text: `${d.dir}` }, ...(d.error ? [{ prefix: tag, text: `${d.error}` }] : [])] }
      if (d.op === 5) {
        const isRemove = d.action === 'remove'
        const countText = d.count ? `(${d.count}项)` : ((d.dirs || d.dir) ? `(1项)` : '')
        const label = isRemove ? `移除已取消${countText}` : `添加已取消${countText}`
        const items = d.dirs ? d.dirs.map(x => ({ prefix: tag, text: `${x}` })) : (d.dir ? [{ prefix: tag, text: `${d.dir}` }] : [])
        return { summary: { op: tag, text: label }, files: items }
      }
      if (d.op === 6) return { summary: { op: tag, text: `重命名成功` }, files: [{ prefix: tag, text: `${d.dir || ''}` }, { prefix: tag, text: `${d.oldName || ''} → ${d.newName || ''}` }] }
      if (d.op === 7) return { summary: { op: tag, text: `重命名失败` }, files: [{ prefix: tag, text: `${d.dir || ''}` }, ...(d.error ? [{ prefix: tag, text: `${d.error}` }] : [])] }
      return { summary: { op: tag, text: d.dir || '' } }
    case 8:
      if (d.op === 2) {
        const fieldLabel = d.field === 'maxFileSizeMB' ? '最大上传 (MB)' :
          d.field === 'showHiddenFiles' ? '显示隐藏文件' :
          d.field === 'autostart' ? '开机自启' :
          d.field || '配置';
        return { summary: { op: tag, text: `${fieldLabel} 修改失败` }, files: d.error ? [{ prefix: tag, text: `${d.error}` }] : [] }
      }
      // config path log (at startup)
      if (entry.message && !d.field) {
        return { summary: { op: tag, text: entry.message } }
      }
      if (d.field === 'maxFileSizeMB' && d.ori !== undefined && d.now !== undefined) {
        return { summary: { op: tag, text: `最大上传 (MB) 已修改` }, files: [{ prefix: tag, text: `${d.ori} → ${d.now} MB` }] }
      }
      if (d.field === 'showHiddenFiles') {
        return { summary: { op: tag, text: d.now ? '显示隐藏文件已开启' : '显示隐藏文件已关闭' } }
      }
      if (d.field === 'autostart') {
        return { summary: { op: tag, text: d.now ? '开机自启已开启' : '开机自启已关闭' } }
      }
      return { summary: { op: tag, text: entry.message || d.field || '' } }
    case 9:
      if (d.count && d.dirs) {
        return {
          summary: { op: tag, text: `共享目录 ${d.count} 个` },
          files: d.dirs.map(dir => ({ prefix: tag, text: `${dir}` }))
        }
      }
      if (d.desc && d.url) return { summary: { op: tag, text: `${d.desc} : ${d.url}` } }
      if (d.desc && d.buildTs) return { summary: { op: tag, text: `${d.desc} : ${d.buildTs}` } }
      return { summary: { op: tag, text: d.desc } }
    case 10:
      if (d.op === 3) {
        const dir = relativeDir(d.dir, d.root) || d.dir || ''
        return { summary: { op: tag, text: `打开失败` }, files: [{ prefix: tag, text: `${dir}` }, { prefix: tag, text: `${d.error}` }] }
      }
      if (d.error) { const dir = relativeDir(d.dir, d.root); return { summary: { op: tag, text: `${dir} — ${d.error}` } } }
      return { summary: { op: tag, text: relativeDir(d.dir, d.root) || d.dir } }
    case 11:
      if (d.op === 0) return { summary: { op: tag, text: '已取消' } }
      if (d.op === 1) return { summary: { op: tag, text: '已清空' } }
      if (d.op === 2) return { summary: { op: tag, text: '缓冲区已清空' } }
      return { summary: { op: tag, text: entry.message || '' } }
    case 12:
      return { summary: { op: tag, text: d.error || '' } }
    case 13:
      if (d.op === 2) {
        return { summary: { op: tag, text: '预览失败' }, files: [{ prefix: tag, text: `${displayFile(d.file, d.is_dir)}` }, { prefix: tag, text: `${d.error}` }] }
      }
      if (d.error) return { summary: { op: tag, text: `${displayFile(d.file, d.is_dir)} — ${d.error}` } }
      return { summary: { op: tag, text: `${displayFile(d.file, d.is_dir)} (${d.size})` } }
    default:
      return null
  }
}

export function showSummary(entry) {
  const p = parseLog(entry)
  return p ? p.summary : null
}

export function showFiles(entry) {
  const p = parseLog(entry)
  return p ? (p.files || []) : []
}

export function showSummaryText(entry) {
  const s = showSummary(entry)
  return s ? (s.op + ' ' + s.text) : ''
}

/**
 * 过滤日志时搜索文本包含 summary 和 files
 */
export { TAG_WIDTH, dispWidth, padTag }

export function logMatchesFilter(entry, search) {
  const s = search.toLowerCase()
  const p = parseLog(entry)
  if (!p) return (entry.message || '').toLowerCase().includes(s)
  const filesText = (p.files || []).map(f => {
    if (typeof f === 'string') return f
    if ('name' in f) return f.name + (f.size ? ` (${f.size})` : '')
    return f.text || ''
  }).join(' ')
  return (showSummaryText(entry) + ' ' + filesText).toLowerCase().includes(s)
}
