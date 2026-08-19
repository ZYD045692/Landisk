// Markdown 数学渲染管线（KaTeX）——纯函数模块，供 MarkdownPreview 使用。
// 核心思路：marked 会把 LaTeX 的 \\（行分隔符）当转义反斜杠折叠成 \，破坏数学；
// 因此在 marked 之前先把数学区域提取成占位符保护，marked 之后恢复为 KaTeX 渲染结果。

import katex from 'katex'
import 'katex/dist/katex.min.css'

/** HTML 转义 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** HTML 实体解码（从带 &amp;/&gt; 等实体导出的源里还原字符，KaTeX 才能正确解析） */
export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** 修正常见导出错误（Obsidian/MathJax 的宽松写法 → KaTeX 兼容）：
 *  \left{ 应写作 \left\{，\right} 应写作 \right\}
 *  行尾残留 \\（\\\end 前的行分隔符）→ 移除
 *  行分隔符统一为 \\：单/双 \ 后跟 {{（矩阵单元开始）都是行分隔（MathJax 容忍单 \） */
export function normalizeTex(tex) {
  return tex
    .replace(/\\left{/g, '\\left\\{')
    .replace(/\\right}/g, '\\right\\}')
    .replace(/\\{2,}\s*(?=\\end\{)/g, '')
    .replace(/(\\{1,2})(?=\{\{)/g, '\\\\ ')
}

/** KaTeX 渲染单个公式（统一归一化 + 实体解码） */
export function renderTex(tex, display) {
  try {
    return katex.renderToString(normalizeTex(decodeEntities(tex.trim())), { displayMode: display, throwOnError: false, strict: false })
  } catch { return tex }
}

/** 从原始 markdown 提取代码块 + 数学区域为占位符（marked 前执行）。
 *  单次左到右扫描、最外层优先：\begin{...} 块 > $$...$$ > $...$（避免嵌套被内层先提取）。 */
export function extractMathAndCode(md) {
  const codes = []
  let text = md.replace(/```[\s\S]*?```/g, (m) => {
    codes.push({ raw: m })
    return `@@CODE_${codes.length - 1}@@`
  })
  text = text.replace(/`[^`\n]+`/g, (m) => {
    codes.push({ raw: m })
    return `@@CODE_${codes.length - 1}@@`
  })
  const math = []
  text = text.replace(
    /(\\begin\{(aligned|align\*?|equation\*?|gather\*?|split|multline|multline\*?|cases|dcases|rcases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array|smallmatrix)\}[\s\S]*?\\end\{\2\})|\$\$([\s\S]+?)\$\$|\$([^\$\n]+?)\$/g,
    // 注意参数对应：g1=begin块, g2=env名, g3=$$内容, g4=$内容 —— env 必须占位，否则后面参数错位
    (m, beginTex, env, dispTex, inlineTex) => {
      if (beginTex) { math.push({ tex: beginTex, display: true }); return `@@MATH_${math.length - 1}@@` }
      if (dispTex !== undefined) { math.push({ tex: dispTex, display: true }); return `@@MATH_${math.length - 1}@@` }
      if (inlineTex !== undefined) {
        if (/^\s/.test(inlineTex) || /\s$/.test(inlineTex)) return m // $ 后/前空白 → 价格等
        math.push({ tex: inlineTex, display: false }); return `@@MATH_${math.length - 1}@@`
      }
      return m
    }
  )
  return { text, codes, math }
}

/** 恢复代码块占位符 → <pre><code> / <code>（marked 把占位符当文本渲染，这里替换回来） */
export function restoreCode(html, codes) {
  html = html.replace(/<p>(@@CODE_\d+)<\/p>/g, (m, ph) => {
    const i = +ph.match(/\d+/)[0]
    const body = codes[i].raw.replace(/^```[^\n]*\n/, '').replace(/```$/, '').replace(/\n$/, '')
    return '<pre><code>' + escapeHtml(body) + '</code></pre>'
  })
  html = html.replace(/@@CODE_(\d+)@@/g, (_, i) => '<code>' + escapeHtml(codes[+i].raw.replace(/^`|`$/g, '')) + '</code>')
  return html
}

/** 恢复数学占位符 → KaTeX 渲染结果（块级公式替换整个 <p>，避免 display 块嵌在段落里） */
export function restoreMath(html, math) {
  html = html.replace(/<p>(@@MATH_\d+)<\/p>/g, (m, ph) => {
    const i = +ph.match(/\d+/)[0]
    return renderTex(math[i].tex, math[i].display)
  })
  html = html.replace(/@@MATH_(\d+)@@/g, (_, i) => {
    const it = math[+i]
    return renderTex(it.tex, it.display)
  })
  return html
}
