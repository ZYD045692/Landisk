<template>
  <div class="file-table-wrapper">
    <!-- 工具栏：搜索 + 批量操作 -->
    <div v-if="!error && entries.length > 0" class="toolbar">
      <div class="toolbar-left">
        <el-input
          v-model="searchQuery"
          placeholder="搜索文件..."
          :prefix-icon="Search"
          clearable
          size="small"
          style="width: 220px"
        />
        <div class="sort-btns">
          <el-button size="small" :type="sortBy === 'name' ? 'primary' : ''" :plain="sortBy !== 'name'" @click="toggleSort('name')">
            名称 {{ sortBy === 'name' ? (sortAsc ? '▲' : '▼') : '' }}
          </el-button>
          <el-button size="small" :type="sortBy === 'size' ? 'primary' : ''" :plain="sortBy !== 'size'" @click="toggleSort('size')">
            大小 {{ sortBy === 'size' ? (sortAsc ? '▲' : '▼') : '' }}
          </el-button>
          <el-button size="small" :type="sortBy === 'date' ? 'primary' : ''" :plain="sortBy !== 'date'" @click="toggleSort('date')">
            时间 {{ sortBy === 'date' ? (sortAsc ? '▲' : '▼') : '' }}
          </el-button>
          <el-button size="small" :type="sortBy === 'ext' ? 'primary' : ''" :plain="sortBy !== 'ext'" @click="toggleSort('ext')">
            类型 {{ sortBy === 'ext' ? (sortAsc ? '▲' : '▼') : '' }}
          </el-button>
          <el-button size="small" :icon="Refresh" @click="$emit('retry')" />
        </div>
      </div>
      <div v-if="selected.length > 0" class="batch-bar">
        <span class="batch-count">已选 {{ selected.length }} 项</span>
        <template v-if="isVirtualRoot">
          <el-button size="small" type="danger" @click="batchRemoveRoots" :loading="batchDeleting">批量移除</el-button>
        </template>
        <template v-else>
          <el-button v-if="!isShell" size="small" type="primary" @click="batchDownload">批量下载</el-button>
          <el-button size="small" type="danger" @click="batchDelete" :loading="batchDeleting">批量删除</el-button>
        </template>
        <el-button size="small" @click="selected = []">取消选择</el-button>
      </div>
    </div>

    <!-- 首次加载骨架屏（无数据时） -->
    <div v-if="loading && entries.length === 0" class="loading-state">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 错误 -->
    <el-result
      v-if="error"
      icon="error"
      :title="error"
      sub-title="请检查路径是否正确或稍后重试"
    >
      <template #extra>
        <el-button type="primary" @click="$emit('retry')">重试</el-button>
      </template>
    </el-result>

    <!-- 空目录（仅非加载、非错误时显示） -->
    <el-empty
      v-if="!loading && !error && entries.length === 0"
      description="此文件夹为空"
      :image-size="120"
    />

    <!-- 文件列表 -->
    <template v-if="!error && entries.length > 0">
      <!-- 批量删除进度条（不隐藏表格） -->
      <div v-if="batchDeleting" style="padding:8px 12px;border-bottom:1px solid #ebeef5">
        <el-progress :percentage="deleteProgress" :stroke-width="6" :show-text="true" />
      </div>
      <div class="pc-table">
        <el-table
          :cell-class-name="cellClass"
          :data="pagedEntries"
          style="width: 100%"
          stripe
          row-class-name="file-row"
          @row-click="handleRowClick"
          @selection-change="onSelectionChange"
        >
          <el-table-column type="selection" width="40" />

          <el-table-column min-width="120">
            <template #header>
              <span style="padding-left:28px">名称</span>
            </template>
            <template #default="{ row }">
              <div class="file-name-cell">
                <el-icon :size="20" :color="getIconInfo(row).color">
                  <component :is="getIconInfo(row).icon" />
                </el-icon>
                <span class="file-name" :title="row.name">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="大小" width="95" align="right" header-align="center" class-name="col-size">
            <template #default="{ row }">
              <span v-if="!row.isDirectory">{{ formatFileSize(row.size) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="修改时间" width="150" align="center" class-name="col-date">
            <template #default="{ row }">
              {{ formatDate(row.modified) }}
            </template>
          </el-table-column>

          <el-table-column label="操作" width="140" align="center" fixed="right">
            <template #default="{ row }">
              <template v-if="row.isDirectory">
                <!-- 壳里打开文件夹→资源管理器；浏览器→进入目录 -->
                <el-button link type="primary" size="small" @click.stop="isShell ? openFileRow(dirOpenPath(row)) : openDir(row.name)">
                  打开
                </el-button>
                <el-button v-if="isVirtualRoot" link type="danger" size="small" @click.stop="confirmRemoveRoot(row)">
                  移除
                </el-button>
                <el-button v-else link type="danger" size="small" @click.stop="confirmDelete(row)">
                  删除
                </el-button>
              </template>
              <template v-else>
                <el-button link :type="isShell ? 'primary' : 'success'" size="small" @click.stop="handleFileAction(row)">
                  {{ isShell ? '打开' : '下载' }}
                </el-button>
                <el-button link type="danger" size="small" @click.stop="confirmDelete(row)">
                  删除
                </el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页 -->
        <div v-if="filteredEntries.length > 0" class="pagination-wrap">
          <el-pagination
            :current-page="currentPage"
            :page-size="pageSize"
            :page-sizes="[5, 10, 20, 50]"
            :total="filteredEntries.length"
            layout="sizes, prev, pager, next, total"
            size="small"
            @current-change="v => currentPage = v"
            @size-change="v => { pageSize = v; currentPage = 1 }"
          />
        </div>
      </div>

      <!-- 移动端卡片列表 -->
      <div class="mobile-list" :class="{ 'is-loading': loading }">
        <div
          v-for="row in pagedEntries"
          :key="row.name"
          class="mobile-file-item"
        >
          <div
            class="mobile-file-main"
            @click="row.isDirectory ? openDir(row.name) : downloadFile(row)"
          >
            <div class="mobile-file-icon">
              <el-icon :size="28" :color="getIconInfo(row).color">
                <component :is="getIconInfo(row).icon" />
              </el-icon>
            </div>
            <div class="mobile-file-info">
              <div class="mobile-file-name">{{ row.name }}</div>
              <div class="mobile-file-meta">
                <span v-if="!row.isDirectory">{{ formatFileSize(row.size) }} · </span>
                <span>{{ formatDate(row.modified) }}</span>
              </div>
            </div>
          </div>
          <div class="mobile-file-actions">
            <el-button
              v-if="row.isDirectory"
              :icon="ArrowRight"
              circle
              size="small"
              @click.stop="openDir(row.name)"
            />
            <el-button
              v-else
              :icon="Download"
              circle
              size="small"
              type="primary"
              @click.stop="handleFileAction(row)"
            />
            <el-button
              v-if="isVirtualRoot"
              link
              type="warning"
              size="small"
              class="mobile-remove-btn"
              @click.stop="confirmRemoveRoot(row)"
            >移除</el-button>
            <el-button
              v-else
              :icon="Delete"
              circle
              size="small"
              type="danger"
              @click.stop="confirmDelete(row)"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Delete, Download, ArrowRight, Search, Refresh } from '@element-plus/icons-vue'
import { getFileIcon, formatFileSize, formatDate } from '../utils/format'
import { deleteFile, removeRoot, apiUrl, downloadFileBlob } from '../api'
import { isShell } from '../utils/env'

async function openFileRow(fpath) {
  const name = String(fpath).replace(/\/+$/, '').split('/').pop() || fpath
  try {
    const body = { path: fpath }
    const res = await fetch(apiUrl('/files/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (!data.success) {
      ElMessage.error(data.message)
      emit('retry')
    } else {
      ElMessage.success(`已打开「${name}」`)
    }
  } catch {
    ElMessage.error('打开失败')
    fetch(apiUrl('/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', type: 6, data: { op: 2, file: name, error: '打开失败' } })
    }).catch(() => {})
    emit('retry')
  }
}

const props = defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  currentPath: { type: String, default: '/' },
  pinTop: { type: Array, default: () => [] }
})

const emit = defineEmits(['open-dir', 'retry', 'deleted'])

// 共享目录列表（App.vue provide，同一个 ref）——移除后自动触发 FileBrowser 刷新
const roots = inject('roots', ref([]))

// 虚拟根目录（currentPath 为 '/' 或 ''）下的行都是共享根目录：操作列显示「移除」而非「删除」
const isVirtualRoot = computed(() => props.currentPath === '/' || props.currentPath === '')

// 搜索
const searchQuery = ref('')

// 排序
const sortBy = ref('name')
const sortAsc = ref(true)

function toggleSort(field) {
  if (sortBy.value === field) {
    sortAsc.value = !sortAsc.value
  } else {
    sortBy.value = field
    sortAsc.value = true
  }
}

// 刷新时数据格加载覆盖效果
function cellClass({ row, column }) {
  if (!props.loading) return ''
  if (!row) return ''                      // 表头单元格跳过
  if (column.type === 'selection') return '' // 复选框列跳过
  if (column.label === '操作') return ''    // 操作列跳过
  return 'cell-loading'
}

// 过滤
const filteredEntries = computed(() => {
  let list = [...props.entries]
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(e => e.name.toLowerCase().includes(q))
  }
  list.sort((a, b) => {
    // 目录始终优先于文件
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1

    // 同类内按用户选择的字段排序
    if (sortBy.value === 'name') {
      const va = a.name.toLowerCase(), vb = b.name.toLowerCase()
      return sortAsc.value ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    if (sortBy.value === 'size') {
      return sortAsc.value ? a.size - b.size : b.size - a.size
    }
    if (sortBy.value === 'date') {
      const va = new Date(a.modified).getTime(), vb = new Date(b.modified).getTime()
      return sortAsc.value ? va - vb : vb - va
    }
    // 类型（扩展名）
    const va = (a.extension || ''), vb = (b.extension || '')
    return sortAsc.value ? va.localeCompare(vb) : vb.localeCompare(va)
  })
  // 新上传的文件保持置顶
  if (props.pinTop.length > 0) {
    const top = new Set(props.pinTop)
    list = [...list.filter(e => top.has(e.name)), ...list.filter(e => !top.has(e.name))]
  }
  return list
})

// 分页
const currentPage = ref(1)
const pageSize = ref(10)
const totalPages = computed(() => Math.ceil(filteredEntries.value.length / pageSize.value))
const pagedEntries = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredEntries.value.slice(start, start + pageSize.value)
})

watch([searchQuery, () => props.entries], () => {
  currentPage.value = 1
  selected.value = []
})

// 多选
const selected = ref([])
const deleteProgress = ref(0)
const batchDeleting = ref(false)

function onSelectionChange(rows) {
  selected.value = rows
}

async function batchDelete() {
  const count = selected.value.length
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${count} 个项目吗？`,
      '批量删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
    batchDeleting.value = true
    deleteProgress.value = 0

    const paths = selected.value.map(row =>
      (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
    )
    try {
      const res = await fetch(apiUrl('/delete/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths })
      })
      const data = await res.json()
      if (data.success) {
        ElMessage.success(data.message || '已删除')
      } else {
        ElMessage.error(data.message || '删除失败')
      }
    } catch {
      ElMessage.error('删除失败')
    }

    selected.value = []
    deleteProgress.value = 0
    batchDeleting.value = false
    emit('deleted')
  } catch {
    ElMessage.info('已取消批量删除')
    // 用户取消，记日志
    fetch(apiUrl('/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', type: 4, data: { op: 0, count } })
    }).catch(() => {})
    batchDeleting.value = false
  }
}

async function batchDownload() {
  const files = selected.value.filter(r => !r.isDirectory)
  if (files.length === 0) return

  let success = 0
  let failures = []
  for (const row of files) {
    const fpath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
    try {
      const { response, isJson, data } = await downloadFileBlob(fpath)
      if (isJson) {
        failures.push({ name: row.name, message: data?.message || '下载失败' })
        continue
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/)
      const filename = match ? decodeURIComponent(match[1]) : row.name
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      success++
    } catch {
      failures.push({ name: row.name, message: '网络错误' })
    }
  }

  if (failures.length === 0) {
    ElMessage.success(`已下载 ${success} 个`)
  } else {
    const reasons = [...new Set(failures.map(f => f.message))].join('；')
    ElMessage.warning(`已下载 ${success} 个，${failures.length} 个失败：${reasons}`)
  }
}

// 原有功能
function getIconInfo(row) {
  return getFileIcon(row.name, row.isDirectory, row.extension)
}

function openDir(name) {
  emit('open-dir', name)
}

async function downloadFile(row) {
  const fpath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
  try {
    const { response, isJson, data } = await downloadFileBlob(fpath)
    if (isJson) {
      ElMessage.error(data?.message || '下载失败')
      emit('retry')
      return
    }
    // 二进制 → blob 下载
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const disposition = response.headers.get('content-disposition') || ''
    const match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/)
    const filename = match ? decodeURIComponent(match[1]) : row.name
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ElMessage.success(`已开始下载「${filename}」`)
  } catch {
    ElMessage.error('下载失败')
    fetch(apiUrl('/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', type: 5, data: { op: 2, file: row.name, error: '下载失败' } })
    }).catch(() => {})
    emit('retry')
  }
}

async function confirmDelete(row) {
  if (isVirtualRoot.value) return  // 虚拟根下的共享目录只能「移除」，禁止物理删除
  const dpath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
  const type = row.isDirectory ? '文件夹' : '文件'
  try {
    await ElMessageBox.confirm(
      `确定要删除${type}「${row.name}」吗？${row.isDirectory ? '目录内所有内容将被删除。' : ''}`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
    const res = await deleteFile(dpath)
    if (!res.data.success) throw new Error(res.data.message)
    ElMessage.success(res.data.message || (res.data.data?.dest === 'permanent' ? '已永久删除（回收站不可用）' : '已移入回收站'))
    emit('deleted')
  } catch (e) {
    if (e && e.message) {
      // 后端返回的错误消息
      ElMessage.error(e.message)
    } else {
      ElMessage.info('已取消删除')
      // 用户取消，记日志
      fetch(apiUrl('/logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'info', type: 4, data: { op: 0, file: dpath } })
      }).catch(() => {})
    }
  }
}

// 行内虚拟路径（虚拟根下前缀为空）
function rowPath(row) {
  return (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
}

// 壳里打开文件夹：POST /api/files/open → 后端用资源管理器打开（浏览器里则进入目录）
function dirOpenPath(row) {
  return rowPath(row)
}

// 移除共享目录（只从 config.roots 移除，不删磁盘文件）
async function confirmRemoveRoot(row) {
  try {
    await ElMessageBox.confirm(
      `确定移除共享目录「${row.name}」？\n仅取消共享，不会删除磁盘上的文件。`,
      '确认',
      { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    ElMessage.info('已取消移除')
    // 用户取消移除 → 记「移除已取消」（type=7 op=5，前端写入）
    fetch(apiUrl('/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', type: 7, data: { op: 5, dir: row.fullPath, action: 'remove' } })
    }).catch(() => {})
    return
  }
  try {
    const res = await removeRoot(row.fullPath)
    if (!res.data.success) throw { response: { data: res.data } }
    roots.value = res.data.data?.roots || roots.value
    ElMessage.success(`已移除「${row.name}」`)
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '移除失败')
  }
}

// 批量移除共享目录（虚拟根下的批量操作）
async function batchRemoveRoots() {
  const count = selected.value.length
  try {
    await ElMessageBox.confirm(
      `确定移除选中的 ${count} 个共享目录？\n仅取消共享，不会删除磁盘上的文件。`,
      '批量移除',
      { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    ElMessage.info(`已取消移除 ${count} 个共享目录`)
    // 用户取消批量移除 → 记「移除已取消」（type=7 op=5，前端写入）
    fetch(apiUrl('/logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', type: 7, data: { op: 5, count, dirs: selected.value.map(r => r.fullPath), action: 'remove' } })
    }).catch(() => {})
    return
  }

  batchDeleting.value = true
  deleteProgress.value = 0
  let lastRoots = null
  let okCount = 0
  for (let i = 0; i < selected.value.length; i++) {
    const row = selected.value[i]
    try {
      const res = await removeRoot(row.fullPath)
      if (res.data.data?.roots) lastRoots = res.data.data.roots
      okCount++
    } catch { /* 单个失败继续下一个 */ }
    deleteProgress.value = Math.round(((i + 1) / count) * 100)
  }
  // 一次性赋值，触发 FileBrowser watch(roots) 刷新一次
  if (lastRoots) roots.value = lastRoots
  batchDeleting.value = false
  selected.value = []
  deleteProgress.value = 0

  if (okCount === count) {
    ElMessage.success(`已移除 ${count} 个共享目录`)
  } else {
    ElMessage.warning(`已移除 ${okCount} 个，${count - okCount} 个失败`)
  }
}

function handleFileAction(row) {
  const fpath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
  if (isShell.value) {
    // POST /api/files/open 调系统默认程序打开
    openFileRow(fpath)
  } else {
    downloadFile(row)
  }
}

function handleRowClick(row) {
  if (row.isDirectory) {
    openDir(row.name)
  } else {
    handleFileAction(row)
  }
}
</script>

<style scoped>
.file-table-wrapper {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  overflow: hidden;
  /* scrollbar-gutter: stable; */
  position: relative;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  background: #fafafa;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.sort-btns {
  display: flex;
  gap: 18px;
}
.sort-btns .el-button {
  margin: 0 !important;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-count {
  font-size: 13px;
  color: #606266;
}

.loading-state {
  padding: 24px;
}

.pc-table {
  position: relative;
}

/* 刷新时数据格 shimmer 加载效果 */
:deep(.cell-loading .cell) {
  position: relative;
  overflow: hidden;
}
/* el-icon 默认 position:relative 会高于 ::after，临时改为 static 让覆盖层在上面 */
:deep(.cell-loading .cell .el-icon) {
  position: static !important;
}
:deep(.cell-loading .cell)::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    #e8e8ee 0%,
    #f2f2f8 50%,
    #e8e8ee 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 6px;
  pointer-events: none;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 移动端卡片加载效果 */
.mobile-list.is-loading .mobile-file-info {
  position: relative;
  overflow: hidden;
}
.mobile-list.is-loading .mobile-file-info::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    #e8e8ee 0%,
    #f2f2f8 50%,
    #e8e8ee 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 6px;
  pointer-events: none;
}

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.text-muted {
  color: #c0c4cc;
}

.file-row {
  cursor: pointer;
}

/* 分页 */
.pagination-wrap {
  display: flex;
  justify-content: center;
  padding: 10px 12px;
  border-top: 1px solid #ebeef5;
}

/* PC 端 */
.pc-table { display: block; }

/* 移动端 */
.mobile-list { display: none; }

.mobile-file-item {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-bottom: 1px solid #f2f3f5;
  transition: background 0.2s;
}

.mobile-file-main {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.mobile-file-main:active {
  background: #f5f7fa;
  margin: -10px -12px;
  padding: 10px 12px;
}

.mobile-file-icon {
  margin-right: 12px;
  flex-shrink: 0;
}

.mobile-file-info {
  flex: 1;
  min-width: 0;
}

.mobile-file-name {
  font-size: 15px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.mobile-file-meta {
  font-size: 12px;
  color: #909399;
}

.mobile-file-actions {
  display: flex;
  gap: 6px;
  margin-left: 8px;
  flex-shrink: 0;
}

.mobile-remove-btn {
  min-height: 32px;
  padding: 0 8px;
}

@media (max-width: 768px) {
  .pc-table { display: none; }
  .mobile-list { display: block; }
  .toolbar { padding: 8px; }
  .sort-btns { display: none; }
}
</style>
