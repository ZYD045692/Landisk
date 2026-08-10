<template>
  <div class="file-browser">
    <!-- 面包屑导航 -->
    <BreadcrumbNav
      :current-path="currentPath"
      @navigate="navigateTo"
    />

    <!-- 无共享目录时提示 -->
    <div v-if="roots.length === 0">
      <el-empty :image-size="100">
        <template #description>
          <p style="margin:0 0 8px;color:#606266;font-weight:500;font-size:14px">请先添加共享目录</p>
          <p style="margin:0;color:#80858a;font-size:14px">点击右上角设置添加一个本地文件夹为共享目录</p>
        </template>
      </el-empty>
    </div>

    <!-- 虚拟根提示：两端都显示，注明是桌面应用功能（浏览器拖入会给引导提示） -->
    <div v-if="isVirtualRoot && roots.length > 0" class="virtual-root-hint">
      在桌面应用中拖入文件夹可添加共享目录
    </div>

    <!-- 上传区域（仅真实目录内） -->
    <UploadZone
      v-if="roots.length > 0 && !isVirtualRoot"
      :upload-path="currentPath"
      @uploaded="onUploaded"
    />

    <!-- 文件列表 -->
    <FileTable
      v-if="roots.length > 0"
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
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchFiles } from '../api'
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

// 虚拟根目录：无上传目标，隐藏上传区，拖入文件夹添加共享
const isVirtualRoot = computed(() => currentPath.value === '/' || currentPath.value === '')

onMounted(() => {
  // 注意：roots 可能尚未从 API 加载完（初始为空），不能据此清路径——等 watch(roots) 加载完再决定
  const qp = route.query.path
  if (qp) {
    currentPath.value = qp.startsWith('/') ? qp : '/' + qp
  }
  loadDirectory()
})

// 显示隐藏文件变化时完整刷新（含骨架遮罩）——空目录（仅隐藏文件被过滤）也必须刷新，否则切换开关看不到隐藏文件出现
watch(refreshFilesKey, () => {
  loadDirectory()
})

// 根目录被移除时：当前路径指向已移除的根 → 回虚拟根
watch(roots, (val) => {
  if (val.length === 0) {
    currentPath.value = '/'
    entries.value = []
    if (route.query.path) router.replace('/')
    return
  }
  const rootName = currentPath.value.split('/').filter(Boolean)[0]
  if (rootName && !val.some(r => r.name === rootName)) {
    currentPath.value = '/'
    router.push({ query: { path: '/' } })
  }
  loadDirectory()
})

// 监听路由 query 变化（虚拟路径）—— 应用内点击 / 浏览器前进后退 / URL 变更统一在这里同步当前路径
watch(() => route.query.path, (newPath) => {
  const next = (newPath && newPath.startsWith('/') ? newPath : '/' + (newPath || ''))
  currentPath.value = next
  loadDirectory()
})

async function onUploaded(newNames) {
  pinnedNames.value = newNames || []
  loadDirectory()
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
    const res = await fetchFiles(currentPath.value)
    if (!res.data.success) {
      ElMessage.warning(res.data.message)
      const parent = currentPath.value.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/'
      router.push({ query: { path: parent } })
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
    const res = await fetchFiles(currentPath.value)
    if (res.data.success && res.data.data?.isDirectory) {
      entries.value = res.data.data.entries
    }
  } catch {
    // 静默失败，保留旧列表
  }
}

async function navigateTo(path) {
  router.push({ query: { path } })
}

async function openDirectory(name) {
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

.virtual-root-hint {
  padding: 8px 12px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  background: #fff;
  color: #909399;
  font-size: 13px;
  text-align: center;
}
</style>
