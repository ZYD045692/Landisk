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

    <!-- 上传区域 -->
    <UploadZone
      :upload-path="currentPath"
      @uploaded="onUploaded"
    />

    <!-- 文件列表 -->
    <FileTable
      :entries="entries"
      :loading="loading"
      :error="error"
      :current-path="currentPath"
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
import { fetchFiles } from '../api'
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
const activeRoot = ref(0)

onMounted(() => {
  const qp = route.query.path
  if (qp) {
    currentPath.value = qp.startsWith('/') ? qp : '/' + qp
  }
  loadDirectory()
})

// 根目录变化时：如果当前选中的被删除，回退到第一个
watch(roots, (val) => {
  if (val.length > 0 && activeRoot.value >= val.length) {
    activeRoot.value = 0
    currentPath.value = '/'
    loadDirectory()
  }
  // 从多根变单根时也重新加载（去掉 root 参数）
  if (val.length <= 1) {
    loadDirectory()
  }
})

// 监听路由 query 变化
watch(() => route.query.path, (newPath) => {
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
  refreshDirectory()
}

function onRootChange() {
  currentPath.value = '/'
  router.push({ query: { path: '/' } })
  loadDirectory()
}

async function loadDirectory() {
  loading.value = true
  error.value = ''
  pinnedNames.value = []

  const startTime = Date.now()

  try {
    const rootIdx = roots.value.length > 1 ? activeRoot.value : undefined
    const res = await fetchFiles(currentPath.value, rootIdx)
    entries.value = res.data.isDirectory ? res.data.entries : []
  } catch (err) {
    const msg = err.response?.data?.error || err.message || '加载失败'
    error.value = msg
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
    const rootIdx = roots.value.length > 1 ? activeRoot.value : undefined
    const res = await fetchFiles(currentPath.value, rootIdx)
    if (res.data.isDirectory) {
      entries.value = res.data.entries
    }
  } catch {
    // 静默失败，保留旧列表
  }
}

function navigateTo(path) {
  router.push({ query: { path } })
}

function openDirectory(name) {
  let newPath = currentPath.value
  if (!newPath.endsWith('/')) newPath += '/'
  newPath += name
  router.push({ query: { path: newPath } })
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
  color: #606266;
  white-space: nowrap;
}
</style>
