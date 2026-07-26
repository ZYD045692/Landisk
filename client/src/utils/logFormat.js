const TYPE_NAMES = {
  1: '新增', 2: '替换', 3: '阻断', 4: '删除', 5: '下载',
  6: '打开', 7: '根目录', 8: '配置', 9: '启动', 10: '浏览',
  11: '日志', 12: '服务'
}

function dispWidth(s) {
  let w = 0
  for (const ch of s) {
    w += /[一-鿿　-ヿ㐀-䶿＀-￯]/.test(ch) ? 2 : 1
  }
  return w
}

const FILE_NAME_WIDTH = 30

function formatFileName(name) {
  let displayName = ''
  let dw = 0
  for (const ch of name) {
    const cw = /[一-鿿　-ヿ㐀-䶿＀-￯]/.test(ch) ? 2 : 1
    if (dw + cw > FILE_NAME_WIDTH) break
    displayName += ch
    dw += cw
  }
  return { name: displayName, pad: ' '.repeat(FILE_NAME_WIDTH - dw) }
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
  const d = entry.data
  switch (entry.type) {
    case 1: case 2: {
      const fileItems = d.files || []
      return {
        summary: { op: `[${tn}]`, text: `${d.count} 个 → ${d.dir}` },
        files: fileItems.map(f => {
          const fmtd = formatFileName(f.name)
          return { prefix: `[${tn}]`, name: fmtd.name, pad: fmtd.pad, size: f.size }
        })
      }
    }
    case 3: {
      const fileItems = d.files || []
      const dirStr = d.dir ? ` → ${d.dir}` : ''
      return { summary: { op: `[${tn}]`, text: `${d.count} 个${dirStr}` }, files: fileItems.map(f => ({ text: f, prefix: `[${tn}]` })) }
    }
    case 4:
      if (d.count && d.files) {
        const dest = d.dest ? ` → ${d.dest}` : ''
        const dirStr = d.dir ? `${d.dir}${dest}` : dest
        return { summary: { op: `[${tn}]`, text: `${d.count} 个  ${dirStr}` }, files: d.files.map(f => ({ text: f.name || f, prefix: `[${tn}]` })) }
      }
      if (d.dest) return { summary: { op: `[${tn}]`, text: `${d.file} → ${d.dest}` } }
      if (d.error) return { summary: { op: `[${tn}]`, text: `${d.file} — ${d.error}` } }
      return { summary: { op: `[${tn}]`, text: `${d.file}` } }
    case 5:
      if (d.count && d.files) {
        const fileItems = d.files || []
        const dirStr = d.dir ? ` → ${d.dir}` : ''
        return {
          summary: { op: `[${tn}]`, text: `${d.count} 个${dirStr}` },
          files: fileItems.map(f => {
            const fmtd = formatFileName(f.name)
            return { prefix: `[${tn}]`, name: fmtd.name, pad: fmtd.pad, size: f.size }
          })
        }
      }
      if (d.error) return { summary: { op: `[${tn}]`, text: `${d.file} — ${d.error}` } }
      return { summary: { op: `[${tn}]`, text: `${d.file} (${d.size})` } }
    case 6:
      if (d.error) return { summary: { op: `[${tn}]`, text: `${d.file} — ${d.error}` } }
      return { summary: { op: `[${tn}]`, text: `${d.file}` } }
    case 7:
      if (d.op === 1) return { summary: { op: `[${tn}]`, text: `添加 ${d.dir}` } }
      if (d.op === 2) return { summary: { op: `[${tn}]`, text: `移除 ${d.dir}` } }
      return { summary: { op: `[${tn}]`, text: d.dir || '' } }
    case 8:
      return { summary: { op: `[${tn}]`, text: `${d.field}: ${d.value}` } }
    case 9:
      return { summary: { op: `[${tn}]`, text: d.desc } }
    case 10:
      if (d.op === 2) return { summary: { op: `[${tn}]`, text: `切换 → ${d.dir}` } }
      if (d.error) return { summary: { op: `[${tn}]`, text: `${d.dir} — ${d.error}` } }
      return { summary: { op: `[${tn}]`, text: d.dir } }
    case 11:
      if (d.op === 1) return { summary: { op: `[${tn}]`, text: '已清空' } }
      if (d.op === 2) return { summary: { op: `[${tn}]`, text: '缓冲区已清空' } }
      return { summary: { op: `[${tn}]`, text: '' } }
    case 12:
      return { summary: { op: `[${tn}]`, text: d.error || '' } }
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
