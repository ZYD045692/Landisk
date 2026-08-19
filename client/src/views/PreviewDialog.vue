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
    <!-- 按文件类型路由到对应预览组件 -->
    <VideoPreview v-if="kind === 'video'" ref="videoComp" />
    <MarkdownPreview v-else-if="kind === 'markdown'" ref="mdComp" />

    <template #footer>
      <el-button size="small" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import VideoPreview from '../components/VideoPreview.vue'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import { getPreviewKind } from '../utils/preview'

const visible = ref(false)
const current = ref(null)          // { name, vpath, size }
const kind = ref(null)             // 'video' | 'markdown' | null
const videoComp = ref(null)
const mdComp = ref(null)

const dialogWidth = computed(() => (kind.value === 'video' ? 'min(82vw, 960px)' : 'min(86vw, 720px)'))

/** 打开预览（由 FileTable @preview 事件触发） */
function open(payload) {
  const name = payload?.name || ''
  const vpath = payload?.vpath || ''
  const size = payload?.size ?? 0
  current.value = { name, vpath, size }
  kind.value = getPreviewKind({ extension: extOf(vpath), isDirectory: false })
  visible.value = true
  // 等子组件挂载后再调用其 open
  nextTick(() => {
    if (kind.value === 'video') videoComp.value?.open(vpath)
    else if (kind.value === 'markdown') mdComp.value?.open(vpath, name, size)
  })
}

function onClosed() {
  if (kind.value === 'video') videoComp.value?.onClose()
  current.value = null
  kind.value = null
}

function extOf(vpath) {
  const name = String(vpath || '').replace(/\\/g, '/').split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

defineExpose({ open })
</script>
