<template>
  <div class="upload-wrapper">
    <div
      class="drop-zone"
    >
      <el-icon :size="32" color="#909399"><UploadFilled /></el-icon>
      <p class="drop-text">拖拽文件到此处上传</p>
      <el-divider class="upload-divider">
        <span style="color:#c0c4cc;font-size:12px;">或者</span>
      </el-divider>
      <el-button type="primary" :icon="Plus" @click="triggerFileInput" :loading="uploading">
        {{ uploading ? '上传中...' : '选择文件' }}
      </el-button>

    </div>

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress">
      <el-progress :percentage="progress" :stroke-width="8" :show-text="true" />
      <p class="progress-text">{{ progressText }}</p>
    </div>

    <!-- 冲突弹窗 -->
    <el-dialog v-model="showConflict" title="同名文件处理" width="480px" destroy-on-close>
      <div class="conflict-body">
        <div v-for="name in conflictList" :key="name" class="conflict-row">
          <span class="conflict-name">📄 {{ name }}</span>
          <el-radio-group v-model="conflictChoices[name]">
            <el-radio value="replace">替换</el-radio>
            <el-radio value="keep">保留两份</el-radio>
            <el-radio value="skip">取消</el-radio>
          </el-radio-group>
        </div>
      </div>
      <template #footer>
        <el-button @click="cancelConflict">取消</el-button>
        <el-button type="primary" @click="doUpload">确认上传</el-button>
      </template>
    </el-dialog>

    <!-- 上传结果 -->
    <div v-if="uploadResult" class="upload-result">
      <el-alert
        :title="uploadResult"
        :type="uploadError ? 'error' : 'success'"
        :closable="true"
        show-icon
        @close="uploadResult = ''"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, inject, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { checkConflicts } from '../api'

const props = defineProps({
  uploadPath: { type: String, default: '/' }
})

const emit = defineEmits(['uploaded'])

const uploading = ref(false)
const progress = ref(0)
const progressText = ref('')
const uploadResult = ref('')
const uploadError = ref(false)

// 冲突弹窗
const showConflict = ref(false)
const conflictList = ref([])
const conflictChoices = ref({})
let pendingFiles = null

// 全局拖拽监听
const droppedFiles = inject('droppedFiles', ref(null))
watch(droppedFiles, (val) => {
  if (val && val.length > 0) {
    uploadFiles(val)
    droppedFiles.value = null
  }
})

function triggerFileInput() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = e => { if (e.target.files.length > 0) uploadFiles(e.target.files) }
  input.click()
}

async function uploadFiles(fileList) {
  const names = Array.from(fileList).map(f => f.name)
  uploading.value = true
  progress.value = 0
  progressText.value = '检查文件冲突...'
  uploadResult.value = ''
  uploadError.value = false

  // 检查冲突
  try {
    const res = await checkConflicts(props.uploadPath, names)
    const conflicts = res.data.conflicts || []
    if (conflicts.length > 0) {
      conflictList.value = conflicts
      conflictChoices.value = {}
      for (const n of conflicts) conflictChoices.value[n] = 'replace'
      pendingFiles = fileList
      uploading.value = false
      showConflict.value = true
      return
    }
  } catch {
    // check 失败，直接上传
  }

  doUploadDirect(fileList)
}

function cancelConflict() {
  showConflict.value = false
  pendingFiles = null
  conflictChoices.value = {}
}

async function doUpload() {
  showConflict.value = false
  doUploadDirect(pendingFiles)
  pendingFiles = null
  conflictChoices.value = {}
}

async function doUploadDirect(fileList) {
  const formData = new FormData()
  formData.append('targetPath', props.uploadPath)
  // replace 必须在 files 之前，multer 按顺序解析
  const replaceList = Object.entries(conflictChoices.value)
    .filter(([, v]) => v === 'replace')
    .map(([k]) => k)
  formData.append('replace', replaceList.join(','))
  const skipList = Object.entries(conflictChoices.value)
    .filter(([, v]) => v === 'skip')
    .map(([k]) => k)
  let count = 0
  for (const file of fileList) {
    if (skipList.includes(file.name)) continue
    formData.append('files', file)
    count++
  }
  if (count === 0) { uploading.value = false; return }

  uploading.value = true
  progress.value = 0
  progressText.value = `准备上传 ${count} 个文件...`
  uploadResult.value = ''
  uploadError.value = false

  try {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        progress.value = Math.round((e.loaded / e.total) * 100)
        progressText.value = `上传中 ${progress.value}%`
      }
    })

    await new Promise((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || '上传失败'))
          } catch {
            reject(new Error('上传失败'))
          }
        }
      })
      xhr.addEventListener('error', () => reject(new Error('网络错误')))
      xhr.send(formData)
    })

    const data = JSON.parse(xhr.responseText)
    const skipped = skipList.length
    let msg = data.message || '上传完成'
    if (skipped > 0) msg += `，取消 ${skipped} 个`
    uploadResult.value = msg
    uploadError.value = false
    emit('uploaded')
  } catch (err) {
    uploadResult.value = err.message
    uploadError.value = true
  } finally {
    uploading.value = false
    setTimeout(() => { uploadResult.value = '' }, 3000)
  }
}
</script>

<style scoped>
.upload-wrapper {
  margin-bottom: 12px;
}

.drop-zone {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 24px 16px;
  text-align: center;
  transition: border-color 0.3s, background 0.3s;
}

.drop-text {
  color: #909399;
  margin: 8px 0 4px;
  font-size: 14px;
}

.upload-divider {
  margin: 12px 0;
}

.upload-progress {
  background: #fff;
  padding: 16px;
  border-radius: 8px;
  margin-top: 8px;
  border: 1px solid #ebeef5;
}

.progress-text {
  text-align: center;
  color: #606266;
  font-size: 13px;
  margin-top: 8px;
}

.upload-result {
  margin-top: 8px;
}

.conflict-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conflict-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 6px;
}

.conflict-name {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .drop-zone {
    padding: 16px 12px;
  }
  .drop-text {
    font-size: 13px;
  }
}
</style>
