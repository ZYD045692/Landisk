<template>
  <div>
    <div v-if="loading" class="md-loading">
      <el-skeleton :rows="6" animated />
    </div>
    <el-alert
      v-else-if="error"
      type="error"
      :title="error"
      :closable="false"
      show-icon
    />
    <div v-else class="md-layout">
      <div class="md-body" v-html="mdHtml"></div>
      <!-- 大纲：悬浮按钮固定在弹窗 1/4 处，点击向左摊开成覆盖面板（悬浮在正文上层，不挤压渲染） -->
      <div v-if="outline.length > 0" class="md-outline-fab">
        <!-- 折叠态：悬浮按钮（仅大纲图标；.stop 避免冒泡到正文容器被关闭逻辑弹回） -->
        <div v-if="!outlineOpen" class="md-outline-toggle" @click.stop="outlineOpen = true" title="展开大纲">
          <svg class="md-outline-toggle-icon" viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M1 2.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zM1 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zM1 13.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z"/></svg>
        </div>
        <!-- 展开态：面板从按钮位置向左覆盖正文（@click.stop 防止点击面板内冒泡到正文容器触发关闭） -->
        <div v-else class="md-outline-panel" @click.stop>
          <!-- 控制行：大纲图标 + 全部折叠/全部展开（图标按钮） -->
          <div class="md-outline-controls">
            <svg class="md-outline-logo" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1 2.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zM1 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1zM1 13.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm3 0a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z"/></svg>
            <!-- 单个位置互斥按钮：全折叠时显示「展开全部」图标，否则显示「全部折叠」图标 -->
            <button
              class="md-outline-action"
              :title="isCollapsedAll ? '全部展开' : '全部折叠'"
              @click="toggleAll"
            >
              <svg v-if="isCollapsedAll" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5l4 4 4-4M4 9.5l4 4 4-4"/></svg>
              <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l4-4 4 4M4 11.5l4-4 4 4"/></svg>
            </button>
          </div>
          <!-- 搜索行 -->
          <el-input
            v-model="outlineSearch"
            size="small"
            placeholder="搜索标题"
            clearable
            class="md-outline-search"
          />
          <div class="md-outline-list">
            <div v-for="item in visibleOutline" :key="item.id" class="md-outline-item">
              <!-- 行内容：先按层级缩进，箭头紧跟在本层级标题前（不固定最左列）；无子级留占位保持同级对齐 -->
              <span
                class="md-outline-item-row"
                :style="{ paddingLeft: (item.level - baseLevel) * 12 + 'px' }"
                @click="scrollToHeading(item.id)"
              >
                <span
                  v-if="expandableIds.has(item.id)"
                  class="md-outline-expand"
                  @click.stop="toggleExpand(item.id)"
                >
                  <svg class="md-outline-expand-icon" :class="{ 'is-open': expandedIds.has(item.id) }" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4l4 4-4 4"/></svg>
                </span>
                <span v-else class="md-outline-expand md-outline-expand--empty"></span>
                <span class="md-outline-item-text" :title="item.text">{{ item.text }}</span>
              </span>
            </div>
            <div v-if="visibleOutline.length === 0" class="md-outline-empty">无匹配标题</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { marked } from 'marked'
import { apiUrl } from '../api'
import { extractMathAndCode, restoreCode, restoreMath, escapeHtml } from '../utils/markdownMath'

// ─── 状态 ────────────────────────

const mdHtml = ref('')
const loading = ref(false)
const error = ref('')
const outline = ref([])              // Markdown 大纲：{ id, level, text }
const outlineOpen = ref(false)       // 大纲悬浮面板展开/收起
const outlineSearch = ref('')        // 大纲搜索关键字
const expandedIds = ref(new Set())   // 树状展开：已展开（显示其子级）的标题 id 集合
const expandableIds = ref(new Set()) // 有子级的标题 id（行首小按钮）

/** 实际最高层级（不一定是 1 级）：文档没有一级标题时，把最高级当基础层 */
const baseLevel = computed(() => outline.value.length ? Math.min(...outline.value.map(i => i.level)) : 1)

/** 面板可见标题：搜索优先（命中各层级）；否则按树状展开状态过滤（只显示各祖先已展开的标题） */
const visibleOutline = computed(() => {
  const q = outlineSearch.value.trim().toLowerCase()
  if (q) return outline.value.filter(i => i.text.toLowerCase().includes(q))
  const exp = expandedIds.value
  const openLevels = new Set() // 记录哪些层级当前是展开的（其子级可见）
  const result = []
  for (const item of outline.value) {
    const lv = item.level
    // 遇到新标题时清掉 >= 当前层级的旧分支展开标记
    for (const k of [...openLevels]) if (k >= lv) openLevels.delete(k)
    if (lv > baseLevel.value && !openLevels.has(lv - 1)) continue // 非基础层且父级未展开 → 隐藏本标题及其子树
    result.push(item)
    if (exp.has(item.id)) openLevels.add(lv)
  }
  return result
})

/** 互斥状态：是否处于「全部折叠」（只留基础层）。有任一层打开即为「非折叠」态 */
const isCollapsedAll = computed(() => expandedIds.value.size === 0)

/** 单个位置互斥按钮：全折叠时点=全部展开；非折叠时点=全部折叠（收回所有已打开层级） */
function toggleAll() {
  if (isCollapsedAll.value) {
    expandedIds.value = new Set(expandableIds.value) // 全部展开
  } else {
    expandedIds.value = new Set() // 全部折叠，只保留基础层
  }
}

/** 单行展开/收起（点行首小按钮，只对本分支生效；按钮图标随之转变状态） */
function toggleExpand(id) {
  const s = new Set(expandedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expandedIds.value = s
}

/** 点面板外任意区域（左右上下、弹窗空白、遮罩）关闭大纲 */
function onOutlineOutsideClick(e) {
  if (!outlineOpen.value) return
  if (e.target && e.target.closest && e.target.closest('.md-outline-panel')) return
  outlineOpen.value = false
}
watch(outlineOpen, (open) => {
  if (open) document.addEventListener('click', onOutlineOutsideClick)
  else document.removeEventListener('click', onOutlineOutsideClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onOutlineOutsideClick))

// ─── 打开与加载 ─────────────────────

// Markdown 预览大小上限（超过拒绝，避免整文件读入内存）
const MAX_MD_SIZE = 5 * 1024 * 1024

/** 由 PreviewDialog 打开时调用（组件已挂载） */
function open(vpath, name, size) {
  mdHtml.value = ''
  error.value = ''
  loading.value = false
  outlineOpen.value = false
  outlineSearch.value = ''
  if (size > MAX_MD_SIZE) {
    error.value = '文件过大（超过 5MB），无法预览，请下载后查看'
    logPreviewFail(name, '文件过大，无法预览')
  } else {
    loadMarkdown(vpath, name)
  }
}

async function loadMarkdown(vpath, name) {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(downloadUrl(vpath))
    // 后端错误统一 200 + JSON {success:false}，与下载一致
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('json')) {
      const text = await res.clone().text()
      try {
        const parsed = JSON.parse(text)
        if (parsed && parsed.success === false) {
          error.value = parsed.message || '预览失败'
          logPreviewFail(name, parsed.message || '预览失败')
          return
        }
      } catch { /* 非 JSON → 正常文件内容 */ }
    }
    const text = await res.text()
    mdHtml.value = renderMarkdown(text, vpath)
    // 成功日志由后端在 /api/download?inline=1 初始请求时写 type=13 op=1
  } catch {
    error.value = '预览失败，请稍后重试'
    logPreviewFail(name, '预览失败')
  } finally {
    loading.value = false
  }
}

function renderMarkdown(text, vpath) {
  const baseVpath = vpath
  outline.value = []
  // 1. 先提取代码块 + 数学区域（marked 前，避免 marked 把 LaTeX 的 \\ 折叠成 \）
  const { text: protectedText, codes, math } = extractMathAndCode(text)
  // 2. 用完整 Renderer 实例并覆盖个别方法（部分 renderer 对象会让 marked 缺方法抛错）
  const renderer = new marked.Renderer()
  // 原始 HTML：白名单净化后放行（div/img/表格等排版可渲染；script/on* 等危险内容转纯文本）
  renderer.html = function ({ text: htmlText }) {
    return sanitizeHtml(htmlText, baseVpath)
  }
  renderer.link = function ({ href, title, tokens }) {
    const inner = this.parser.parseInline(tokens)
    const url = finalUrl(href, baseVpath)
    if (!url) return escapeHtml(inner) // 危险 scheme / 锚点 → 纯文本
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${inner}</a>`
  }
  renderer.image = function ({ href, title, text }) {
    const url = finalUrl(href, baseVpath)
    if (!url) return '' // 危险 scheme → 丢弃
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(text || '')}"${titleAttr} loading="lazy">`
  }
  // 标题：加锚点 id 并收集到大纲（text 取纯文本，去掉行内 HTML 标签与数学占位符）
  renderer.heading = function ({ tokens, depth }) {
    const id = `md-h-${outline.value.length}`
    const text = tokens.map(t => t.text).join('').trim().replace(/@@MATH_\d+@@/g, '')
    outline.value.push({ id, level: depth, text })
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`
  }
  try {
    let html = marked.parse(protectedText, { gfm: true, breaks: true, renderer })
    // 3. 恢复代码块与数学占位符为渲染结果
    html = restoreCode(html, codes)
    html = restoreMath(html, math)
    // 4. 解析完后再算：有子级的标题（紧邻下一标题层级更深）→ 行首可展开按钮
    const expIds = new Set()
    for (let i = 0; i < outline.value.length; i++) {
      if (i + 1 < outline.value.length && outline.value[i + 1].level > outline.value[i].level) {
        expIds.add(outline.value[i].id)
      }
    }
    expandableIds.value = expIds
    expandedIds.value = new Set() // 默认全部折叠（只留基础层，行首箭头逐层展开）
    return html
  } catch {
    error.value = 'Markdown 解析失败'
    return ''
  }
}

/** 大纲点击：平滑滚动到对应标题，并收起面板（手机端点完即可看内容） */
function scrollToHeading(id) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  outlineOpen.value = false
}

// ─── 链接/图片地址解析与 HTML 净化 ─────────────────────

function downloadUrl(vpath) {
  return `${apiUrl('/download')}?path=${encodeURIComponent(vpath)}&inline=1`
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;')
}

/** HTML 白名单标签：仅放行排版常用标签（div/img/表格等），其余（script/iframe 等）转纯文本 */
const ALLOWED_HTML_TAGS = new Set([
  'div','span','p','br','img','b','i','em','strong','u','s','strike','center',
  'table','thead','tbody','tfoot','tr','td','th','caption','col','colgroup',
  'h1','h2','h3','h4','h5','h6','blockquote','code','pre','ul','ol','li','dl','dt','dd',
  'a','hr','sub','sup','mark','small','big','figure','figcaption'
])

/** 解析并净化 Markdown 内嵌原始 HTML：白名单标签 + 移除 on* 属性 + 相对图片/链接重写为内联下载 URL */
function sanitizeHtml(htmlText, baseVpath) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html')
  // 自底向上处理（先子后父），替换/清理节点
  const nodes = [...doc.body.querySelectorAll('*')].reverse()
  for (const el of nodes) {
    const tag = el.tagName.toLowerCase()
    if (!ALLOWED_HTML_TAGS.has(tag)) {
      // 白名单外标签（script/iframe 等）→ 转纯文本，不执行
      el.replaceWith(doc.createTextNode(el.textContent || ''))
      continue
    }
    // 移除事件属性（onclick 等）
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
    }
    if (tag === 'img') {
      const src = el.getAttribute('src')
      const url = src ? finalUrl(src, baseVpath) : null
      if (!url) { el.remove(); continue }
      el.setAttribute('src', url)
      el.removeAttribute('srcset') // srcset 无法安全重写，移除
    }
    if (tag === 'a') {
      const href = el.getAttribute('href')
      if (href) {
        const url = finalUrl(href, baseVpath)
        if (url) {
          el.setAttribute('href', url)
          el.setAttribute('target', '_blank')
          el.setAttribute('rel', 'noopener noreferrer')
        } else {
          el.removeAttribute('href')
        }
      }
    }
  }
  return doc.body.innerHTML
}

/** 危险 scheme 拦截：返回可用的 href 或 null（null → 渲染为纯文本/丢弃） */
function safeHref(href) {
  if (!href) return null
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return null // 锚点链接在弹窗内无意义
  // 带 scheme 的链接只允许 http/https
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : null
  }
  return trimmed // 相对路径
}

/** 相对路径解析为虚拟路径（基于 md 文件所在目录），绝对 http(s) 原样返回 */
function resolveHref(href, baseVpath) {
  const safe = safeHref(href)
  if (!safe) return null
  if (/^https?:\/\//i.test(safe)) return safe
  // 相对路径：基于 md 所在目录做段级解析（../ 不允许越过根名）
  const dir = String(baseVpath || '/').replace(/\\/g, '/')
  const baseDir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '/'
  const segments = baseDir.split('/').filter(Boolean)
  for (const part of safe.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (segments.length > 1) segments.pop()
      continue
    }
    segments.push(part)
  }
  return '/' + segments.join('/')
}

/** 链接/图片地址 → 可用的预览或跳转 URL */
function finalUrl(href, baseVpath) {
  const resolved = resolveHref(href, baseVpath)
  if (!resolved) return null
  if (/^https?:\/\//i.test(resolved)) return resolved
  return downloadUrl(resolved)
}

// ─── 日志（type=13 预览，后端写成功、前端写拒绝类失败） ─────────────────────

function logPreviewFail(name, reason) {
  fetch(apiUrl('/logs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'warn', type: 13, data: { op: 2, file: name, error: reason } })
  }).catch(() => {})
}

defineExpose({ open })
</script>

<style scoped>
.md-loading {
  min-height: 200px;
}
/* Markdown 大纲 + 正文布局 */
.md-layout {
  position: relative; /* 悬浮大纲的定位上下文 */
  display: flex;
  max-height: 60vh; /* 弹窗整体不超视口：长文档正文内部滚动，页面不再出现滚动条 */
}
.md-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;   /* 长文档内部滚动（滚动条隐藏，滚轮可用） */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.md-body::-webkit-scrollbar { display: none; }

/* 悬浮大纲：固定在弹窗右侧 1/4 处的按钮，点击向左摊开成覆盖面板（悬浮在正文上层，不挤压布局） */
.md-outline-fab {
  position: absolute;
  right: 0;
  top: 25%;
  transform: translateY(-50%);
  z-index: 30;
}
/* 折叠态：竖排悬浮按钮 */
.md-outline-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  padding: 12px 7px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-right: none;
  border-left: 2px solid #409eff;
  border-radius: 6px 0 0 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  user-select: none;
}
.md-outline-toggle:hover { background: #f5f7fa; }
.md-outline-toggle-icon {
  color: #409eff;
  display: block;
}
/* 展开态：覆盖面板，从按钮位置向左摊开，悬浮在正文之上（z-index 高于正文） */
.md-outline-panel {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 220px;
  max-height: 56vh;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 8px 12px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.md-outline-panel::-webkit-scrollbar { display: none; }
/* 控制行：大纲图标 + 全部折叠/展开开关 */
.md-outline-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 6px;
}
.md-outline-logo {
  color: #409eff;
  flex-shrink: 0;
  display: block;
}
.md-outline-action {
  border: none;
  background: none;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  color: #909399;
  display: flex;
  align-items: center;
}
.md-outline-action:hover { background: #f5f7fa; color: #409eff; }
/* 搜索行 */
.md-outline-search { margin-bottom: 6px; }
.md-outline-search :deep(.el-input__inner) { font-size: 12px; }
/* 标题列表 */
.md-outline-list {
  display: flex;
  flex-direction: column;
}
.md-outline-empty {
  font-size: 12px;
  color: #c0c4cc;
  text-align: center;
  padding: 12px 0;
}
.md-outline-item {
  font-size: 12.5px;
  color: #606266;
  line-height: 1.6;
  padding: 1px 4px;
  border-radius: 4px;
  cursor: pointer;
}
.md-outline-item:hover {
  background: #f5f7fa;
  color: #409eff;
}
/* 行内容：层级缩进在此，箭头紧跟本层标题前 */
.md-outline-item-row {
  display: flex;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}
/* 行内展开箭头（无子级则占位对齐） */
.md-outline-expand {
  flex-shrink: 0;
  width: 16px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #909399;
  user-select: none;
}
.md-outline-expand-icon {
  display: block;
  transition: transform 0.15s ease;
}
.md-outline-expand-icon.is-open { transform: rotate(90deg); }
.md-outline-expand:not(.md-outline-expand--empty):hover {
  color: #409eff;
  background: #ecf5ff;
}
.md-outline-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 2px;
}
@media (max-width: 768px) {
  /* 移动端：面板稍宽便于阅读，悬浮按钮加大触控面积、稍离屏幕边缘 */
  .md-outline-panel { width: 74vw; max-width: 250px; }
  .md-outline-fab { right: 4px; }
  .md-outline-toggle { padding: 16px 9px; }
  .md-outline-toggle-icon { width: 18px; height: 18px; }
}
/* v-html 渲染的 Markdown 内容（:deep 作用于弹窗内部） */
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4),
.md-body :deep(h5),
.md-body :deep(h6) {
  margin: 1em 0 0.5em;
  line-height: 1.3;
}
.md-body :deep(h1) { font-size: 22px; }
.md-body :deep(h2) { font-size: 19px; }
.md-body :deep(h3) { font-size: 16px; }
.md-body :deep(p) { margin: 0.5em 0; line-height: 1.7; }
.md-body :deep(ul),
.md-body :deep(ol) { margin: 0.5em 0; padding-left: 1.6em; }
.md-body :deep(li) { margin: 0.2em 0; line-height: 1.6; }
.md-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 4px 12px;
  border-left: 3px solid #409eff;
  background: #f5f7fa;
  color: #606266;
}
.md-body :deep(code) {
  background: #f5f7fa;
  border-radius: 3px;
  padding: 1px 5px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}
.md-body :deep(pre) {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.5;
}
.md-body :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}
.md-body :deep(table) {
  border-collapse: collapse;
  margin: 0.6em 0;
  width: 100%;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 6px 10px;
  text-align: left;
}
.md-body :deep(th) {
  background: #f5f7fa;
}
.md-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}
.md-body :deep(a) {
  color: #409eff;
  text-decoration: none;
}
.md-body :deep(a:hover) {
  text-decoration: underline;
}
.md-body :deep(hr) {
  border: none;
  border-top: 1px solid #dcdfe6;
  margin: 1em 0;
}
.md-body :deep(strong) { font-weight: 600; }
</style>

<style>
/* 预览弹窗（append-to-body 传送到 body，须用非 scoped 样式）：上下 padding 去掉，左右保留 20px */
.preview-dialog .el-dialog__body { padding: 0 20px; }
</style>
