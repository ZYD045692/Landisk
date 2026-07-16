<template>
  <div class="upload-wrapper">
    <div
      class="drop-zone"
      :class="{ 'is-dragover': isDragover }"
      @dragover.prevent="isDragover = true"
      @dragleave.prevent="isDragover = false"
      @drop.prevent="handleDrop"
    >
      <el-icon :size="32" color="#909399"><UploadFilled /></el-icon>
      <p class="drop-text">拖拽文件到此处上传</p>
      <el-divider class="upload-divider">
        <span style="color:#c0c4cc;font-size:12px;">或者</span>
      </el-divider>
      <el-button type="primary" :icon="Plus" @click="triggerFileInput" :loading="uploading">
        {{ uploading ? '上传中...' : '选择文件' }}
      </el-button>
      <input
        ref="fileInputRef"
        type="file"
        multiple
        style="display:none"
        @change="handleFileInput"
      />
    </div>

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress">
      <el-progress :percentage="progress" :stroke-width="8" :show-text="true" />
      <p class="progress-text">{{ progressText }}</p>
    </div>

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
import { ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'

const props = defineProps({
  uploadPath: { type: String, default: '/' }
})

const emit = defineEmits(['uploaded'])

const isDragover = ref(false)
const uploading = ref(false)
const progress = ref(0)
const progressText = ref('')
const uploadResult = ref('')
const uploadError = ref(false)
const fileInputRef = ref(null)

function triggerFileInput() {
  fileInputRef.value?.click()
}

function handleFileInput(e) {
  if (e.target.files.length > 0) {
    uploadFiles(e.target.files)
    e.target.value = ''
  }
}

function handleDrop(e) {
  isDragover.value = false
  if (e.dataTransfer.files.length > 0) {
    uploadFiles(e.dataTransfer.files)
  }
}

async function uploadFiles(fileList) {
  const formData = new FormData()
  formData.append('targetPath', props.uploadPath)
  for (const file of fileList) {
    formData.append('files', file)
  }

  uploading.value = true
  progress.value = 0
  progressText.value = `准备上传 ${fileList.length} 个文件...`
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

    uploadResult.value = `成功上传 ${fileList.length} 个文件`
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
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  padding: 24px 16px;
  text-align: center;
  transition: border-color 0.3s, background 0.3s;
}

.drop-zone.is-dragover {
  border-color: #409eff;
  background: #ecf5ff;
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
