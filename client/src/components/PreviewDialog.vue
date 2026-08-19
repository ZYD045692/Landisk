<template>
  <el-dialog
    v-model="visible"
    :title="current ? current.name : ''"
    :width="dialogWidth"
    destroy-on-close
    append-to-body
    class="preview-dialog"
    :top="kind === 'video' ? '4vh' : '10vh'"
    @closed="onClosed"
  >
    <!-- 视频预览 -->
    <template v-if="kind === 'video'">
      <div class="video-wrap">
        <video
          ref="videoRef"
          controls
          autoplay
          playsinline
          preload="metadata"
          :src="videoUrl"
          class="preview-video"
          @error="onVideoError"
        ></video>
      </div>
      <el-alert
        v-if="videoError"
        type="warning"
        :title="videoError"
        :closable="false"
        show-icon
        class="preview-alert"
      />
    </template>

    <!-- Markdown 预览 -->
    <template v-else-if="kind === 'markdown'">
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
      <div v-else class="md-body" v-html="mdHtml"></div>
    </template>

    <template #footer>
      <el-button size="small" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { marked } from 'marked'
import { apiUrl } from '../api'
import { getPreviewKind } from '../utils/preview'

// ─── 状态 ────────────────────────

const visible = ref(false)
const current = ref(null)          // { name, vpath, size }
const kind = ref(null)             // 'video' | 'markdown' | null
const videoUrl = ref('')
const videoError = ref('')
const mdHtml = ref('')
const loading = ref(false)
const error = ref('')
const videoRef = ref(null)

// Markdown 预览大小上限（超过拒绝，避免整文件读入内存）
const MAX_MD_SIZE = 5 * 1024 * 1024

const dialogWidth = computed(() => (kind.value === 'video' ? 'min(82vw, 960px)' : 'min(86vw, 720px)'))

/** 打开预览（由 FileTable @preview 事件触发） */
function open(payload) {
  const name = payload?.name || ''
  const vpath = payload?.vpath || ''
  const size = payload?.size ?? 0
  current.value = { name, vpath, size }
  kind.value = getPreviewKind({ extension: extOf(vpath), isDirectory: false })
  videoUrl.value = ''
  videoError.value = ''
  mdHtml.value = ''
  error.value = ''
  loading.value = false
  visible.value = true

  if (kind.value === 'video') {
    videoUrl.value = downloadUrl(vpath)
  } else if (kind.value === 'markdown') {
    if (size > MAX_MD_SIZE) {
      error.value = '文件过大（超过 5MB），无法预览，请下载后查看'
      logPreviewFail(name, '文件过大，无法预览')
    } else {
      loadMarkdown(vpath, name)
    }
  }
}

function onClosed() {
  if (videoRef.value) {
    try { videoRef.value.pause() } catch {}
    videoRef.value.removeAttribute('src')
    videoRef.value.load?.()
  }
  current.value = null
  kind.value = null
}

function onVideoError() {
  videoError.value = '该视频格式浏览器无法播放，请下载后观看'
}

// ─── 工具 ─────────────────────────────────────

function extOf(vpath) {
  const name = String(vpath || '').replace(/\\/g, '/').split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function downloadUrl(vpath) {
  return `${apiUrl('/download')}?path=${encodeURIComponent(vpath)}&inline=1`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

// ─── Markdown 加载与渲染 ─────────────────────────────────────

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
  // 用完整 Renderer 实例并覆盖个别方法（部分 renderer 对象会让 marked 缺方法抛错）
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
  try {
    return marked.parse(text, { gfm: true, breaks: true, renderer })
  } catch {
    error.value = 'Markdown 解析失败'
    return ''
  }
}

// ─── 日志（type=13 预览，后端写成功、前端写拒绝类失败） ─────────────────────────────────────

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
.video-wrap {
  display: flex;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}
.preview-video {
  width: 100%;
  max-height: 72vh;
  outline: none;
}
.preview-alert {
  margin-top: 12px;
}
.md-loading {
  min-height: 200px;
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
