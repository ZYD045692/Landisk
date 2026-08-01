<template>
  <div class="file-browser">
    <!-- 根目录切换（多根目录时显示） -->
    <div v-if="roots.length > 1" class="root-switcher">
      <span class="switch-label">共享目录：</span>
      <el-select v-model="activeRoot" size="small" style="max-width: 280px" @change="onRootChange">
        <el-option
          v-for="(root, idx) in roots"
          :key="root.path"
          :label="root.name"
          :value="idx"
        />
      </el-select>
    </div>

    <!-- 面包屑导航 -->
    <BreadcrumbNav
      :current-path="currentPath"
      @navigate="navigateTo"
    />

    <!-- 无共享目录时提示 -->
    <div v-if="roots.length === 0" class="no-roots-hint">
      <el-empty description="暂无共享目录" :image-size="100">
        <template #description>
          <p style="margin:0 0 8px;color:#606266;font-weight:500;font-size:14px">请先添加共享目录</p>
          <p style="margin:0;color:#80858a;font-size:14px">点击右上角设置添加一个本地文件夹为共享目录</p>
        </template>
      </el-empty>
    </div>

    <!-- 上传区域 -->
    <UploadZone
      v-if="roots.length > 0"
      :upload-path="currentPath"
      :root-index="activeRoot"
      :root-path="(roots[activeRoot] || {}).path || ''"
      @uploaded="onUploaded"
    />

    <!-- 文件列表 -->
    <FileTable
      v-if="roots.length > 0"
      :entries="entries"
      :loading="loading"
      :error="error"
      :current-path="currentPath"
      :root-index="activeRoot"
      :root-path="(roots[activeRoot] || {}).path || ''"
      :pin-top="pinnedNames"
      @open-dir="openDirectory"
      @retry="loadDirectory"
      @deleted="refreshDirectory"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchFiles, apiUrl } from '../api'
import { ElMessage } from 'element-plus'
import BreadcrumbNav from '../components/BreadcrumbNav.vue'
import UploadZone from '../components/UploadZone.vue'
import FileTable from '../components/FileTable.vue'

const route = useRoute()
const router = useRouter()

const currentPath = ref('/')
const entries = ref([])
const loading = ref(false)
const error = ref('')
const pinnedNames = ref([])
const roots = inject('roots', ref([]))
const refreshFilesKey = inject('refreshFilesKey', ref(0))
const activeRoot = ref(0)

onMounted(() => {
  // 无共享目录时清除查询参数
  if (!roots.value || roots.value.length === 0) {
    if (route.query.path || route.query.root !== undefined) {
      router.replace('/')
    }
    loadDirectory()
    return
  }
  const qp = route.query.path
  if (qp) {
    currentPath.value = qp.startsWith('/') ? qp : '/' + qp
  }
  const rp = route.query.root
  if (rp !== undefined) {
    activeRoot.value = parseInt(rp) || 0
  }
  loadDirectory()
})

// 显示隐藏文件变化时完整刷新（含骨架遮罩）
watch(refreshFilesKey, () => {
  if (entries.value.length > 0) loadDirectory()
})

// 根目录变化时：处理移除后的索引变化
watch(roots, (val, old) => {
  if (val.length === 0) {
    activeRoot.value = 0
    currentPath.value = '/'
    entries.value = []
    if (route.query.path || route.query.root !== undefined) {
      router.replace('/')
    }
    return
  }

  // 获取变化前正在浏览的根目录路径
  const prevRootPath = old?.[activeRoot.value]?.path
  if (prevRootPath) {
    const newIdx = val.findIndex(r => r.path === prevRootPath)
    if (newIdx === -1) {
      // 当前根被移除了 → 重置到第一个
      activeRoot.value = 0
      currentPath.value = '/'
      router.push({ query: { path: '/', root: 0 } })
      loadDirectory()
      return
    }
    if (newIdx !== activeRoot.value) {
      // 当前根还在但索引变了（前面的根被移除导致数组左移）
      activeRoot.value = newIdx
      router.push({ query: { path: currentPath.value, root: newIdx } })
      return
    }
  }

  // 索引超出新数组长度 → 回退
  if (activeRoot.value >= val.length) {
    activeRoot.value = 0
    currentPath.value = '/'
    router.push({ query: { path: '/', root: 0 } })
    loadDirectory()
    return
  }

  loadDirectory()
})

// 监听路由 query 变化（path 或 root）
watch(() => [route.query.path, route.query.root], ([newPath, newRoot]) => {
  if (newRoot !== undefined) {
    activeRoot.value = parseInt(newRoot) || 0
  }
  if (newPath) {
    currentPath.value = newPath.startsWith('/') ? newPath : '/' + newPath
  } else {
    currentPath.value = '/'
  }
  loadDirectory()
})

// 上传完成后：静默拉取新列表，并把上传的文件排到最前
function onUploaded(newNames) {
  pinnedNames.value = newNames || []
  loadDirectory()
}

function onRootChange() {
  router.push({ query: { path: '/', root: activeRoot.value } })
  const name = roots.value[activeRoot.value]?.name || '未知'
  fetch(apiUrl('/logs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'info', type: 10, data: { op: 2, dir: name } })
  }).catch(() => {})
}

async function loadDirectory() {
  // 无共享目录时跳过 API 请求
  if (!roots.value || roots.value.length === 0) {
    entries.value = []
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  pinnedNames.value = []

  const startTime = Date.now()

  try {
    const res = await fetchFiles(currentPath.value, activeRoot.value)
    if (!res.data.success) {
      ElMessage.warning(res.data.message)
      const parent = currentPath.value.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/'
      router.push({ query: { path: parent, root: activeRoot.value } })
      return
    }
    entries.value = res.data.data.isDirectory ? res.data.data.entries : []
  } catch {
    error.value = ''
    entries.value = []
  } finally {
    // 保证至少 400ms 的加载时长，让 shimmer 效果能看到
    const elapsed = Date.now() - startTime
    const minDuration = 400
    if (elapsed < minDuration) {
      await new Promise(r => setTimeout(r, minDuration - elapsed))
    }
    loading.value = false
  }
}

// 上传/删除后静默刷新：不清列表、不闪骨架
async function refreshDirectory() {
  error.value = ''

  try {
    const res = await fetchFiles(currentPath.value, activeRoot.value)
    if (res.data.success && res.data.data?.isDirectory) {
      entries.value = res.data.data.entries
    }
  } catch {
    // 静默失败，保留旧列表
  }
}

async function navigateTo(path) {
  router.push({ query: { path, root: activeRoot.value } })
}

async function openDirectory(name) {
  let newPath = currentPath.value
  if (!newPath.endsWith('/')) newPath += '/'
  newPath += name
  router.push({ query: { path: newPath, root: activeRoot.value } })
}
</script>

<style scoped>
.file-browser {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.root-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.switch-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 28px;
  color: #606266;
  white-space: nowrap;
}
</style>
