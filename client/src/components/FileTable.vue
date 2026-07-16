<template>
  <div class="file-table-wrapper">
    <!-- 工具栏：搜索 + 批量操作 -->
    <div v-if="!loading && !error && entries.length > 0" class="toolbar">
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
        <el-button size="small" type="danger" @click="batchDelete" :loading="deleting">批量删除</el-button>
        <el-button size="small" @click="selected = []">取消选择</el-button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading || deleting" class="loading-state">
      <el-skeleton v-if="loading" :rows="5" animated />
      <el-progress v-if="deleting" :percentage="deleteProgress" :stroke-width="8" />
    </div>

    <!-- 错误 -->
    <el-result
      v-else-if="error"
      icon="error"
      :title="error"
      sub-title="请检查路径是否正确或稍后重试"
    >
      <template #extra>
        <el-button type="primary" @click="$emit('retry')">重试</el-button>
      </template>
    </el-result>

    <!-- 空目录 -->
    <el-empty
      v-else-if="!loading && entries.length === 0"
      description="此文件夹为空"
      :image-size="120"
    />

    <!-- 文件列表 -->
    <template v-else>
      <!-- PC 端表格 -->
      <div class="pc-table">
        <el-table
          :data="pagedEntries"
          style="width: 100%"
          stripe
          row-class-name="file-row"
          @row-click="handleRowClick"
          @selection-change="onSelectionChange"
          ref="tableRef"
        >
          <el-table-column type="selection" width="40" />

          <el-table-column label="名称" min-width="120">
            <template #default="{ row }">
              <div class="file-name-cell">
                <el-icon :size="20" :color="getIconInfo(row).color">
                  <component :is="getIconInfo(row).icon" />
                </el-icon>
                <span class="file-name" :title="row.name">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="大小" width="90" align="right" class-name="col-size">
            <template #default="{ row }">
              <span v-if="row.isDirectory" class="text-muted">--</span>
              <span v-else>{{ formatFileSize(row.size) }}</span>
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
                <el-button link type="primary" size="small" @click.stop="openDir(row.name)">
                  打开
                </el-button>
              </template>
              <template v-else>
                <el-button link type="success" size="small" @click.stop="downloadFile(row)">
                  下载
                </el-button>
              </template>
              <el-button link type="danger" size="small" @click.stop="confirmDelete(row)">
                删除
              </el-button>
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
            small
            @current-change="v => currentPage = v"
            @size-change="v => { pageSize = v; currentPage = 1 }"
          />
        </div>
      </div>

      <!-- 移动端卡片列表 -->
      <div class="mobile-list">
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
              @click.stop="downloadFile(row)"
            />
            <el-button
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
import { ref, computed, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Delete, Download, ArrowRight, Search, Refresh } from '@element-plus/icons-vue'
import { getFileIcon, formatFileSize, formatDate } from '../utils/format'
import { getDownloadUrl, deleteFile } from '../api'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  currentPath: { type: String, default: '/' }
})

const emit = defineEmits(['open-dir', 'retry', 'deleted'])

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

// 过滤
const filteredEntries = computed(() => {
  let list = [...props.entries]
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(e => e.name.toLowerCase().includes(q))
  }
  list.sort((a, b) => {
    let va, vb
    if (sortBy.value === 'name') {
      va = a.name.toLowerCase()
      vb = b.name.toLowerCase()
      return sortAsc.value ? va.localeCompare(vb) : vb.localeCompare(va)
    } else if (sortBy.value === 'size') {
      va = a.isDirectory ? -1 : a.size
      vb = b.isDirectory ? -1 : b.size
    } else if (sortBy.value === 'date') {
      va = new Date(a.modified).getTime()
      vb = new Date(b.modified).getTime()
    } else {
      va = (a.extension || '')
      vb = (b.extension || '')
      return sortAsc.value ? va.localeCompare(vb) : vb.localeCompare(va)
    }
    return sortAsc.value ? va - vb : vb - va
  })
  // 目录始终在最前（除非按名称排序）
  if (sortBy.value !== 'name') {
    list.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0))
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
})

// 多选
const selected = ref([])
const deleting = ref(false)
const deleteProgress = ref(0)
const tableRef = ref(null)

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
    deleting.value = true
    deleteProgress.value = 0
    let completed = 0
    const results = await Promise.allSettled(
      selected.value.map(async row => {
        const filePath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
        try { await deleteFile(filePath) } catch { /* skip */ }
        completed++
        deleteProgress.value = Math.round((completed / count) * 100)
      })
    )
    const success = results.filter(r => r.status === 'fulfilled').length
    selected.value = []
    deleteProgress.value = 0
    deleting.value = false
    ElMessage.success(`已删除 ${success} / ${count} 个项目`)
    emit('deleted')
  } catch { deleting.value = false }
}

// 原有功能
function getIconInfo(row) {
  return getFileIcon(row.name, row.isDirectory, row.extension)
}

function openDir(name) {
  emit('open-dir', name)
}

function downloadFile(row) {
  const filePath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
  window.open(getDownloadUrl(filePath), '_blank')
}

async function confirmDelete(row) {
  const type = row.isDirectory ? '文件夹' : '文件'
  try {
    await ElMessageBox.confirm(
      `确定要删除${type}「${row.name}」吗？${row.isDirectory ? '目录内所有内容将被删除。' : ''}`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning', confirmButtonClass: 'el-button--danger' }
    )
    deleting.value = true
    const filePath = (props.currentPath === '/' ? '' : props.currentPath) + '/' + row.name
    await deleteFile(filePath)
    ElMessage.success('已移入回收站')
    emit('deleted')
  } catch { /* cancelled */ }
  finally { deleting.value = false }
}

function handleRowClick(row) {
  if (row.isDirectory) {
    openDir(row.name)
  }
}
</script>

<style scoped>
.file-table-wrapper {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  overflow: hidden;
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
  gap: 8px;
  flex-wrap: wrap;
}

.sort-btns {
  display: flex;
  gap: 4px;
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

.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  align-items: center;
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

@media (max-width: 768px) {
  .pc-table { display: none; }
  .mobile-list { display: block; }
  .toolbar { padding: 8px; }
  .sort-btns { display: none; }
}
</style>
