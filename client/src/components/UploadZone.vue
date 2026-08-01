<template>
  <div class="upload-wrapper">
    <div class="drop-zone">
      <el-icon :size="32" color="#909399"><UploadFilled /></el-icon>
      <p class="drop-text">拖拽文件到此处上传</p>
      <el-divider class="upload-divider">
        <span style="color:#c0c4cc;font-size:14px;">或者</span>
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

    <!-- 上传确认弹窗 -->
    <el-dialog v-model="showConfirm" title="上传确认" width="540px" destroy-on-close :close-on-click-modal="false">
      <div class="confirm-body">
        <div class="confirm-actions">
          <span class="confirm-actions-label">全部设为：</span>
          <el-button size="small" @click="setAllChoices('replace')">替换</el-button>
          <el-button size="small" @click="setAllChoices('keep')">保留两份</el-button>
          <el-button size="small" @click="setAllChoices('skip')">取消</el-button>
          <span class="confirm-summary">共 {{ allFiles.length }} 个文件</span>
        </div>
        <el-divider style="margin:4px 0" />

        <!-- 分页文件列表 -->
        <div class="confirm-list">
          <div v-for="item in pagedFiles" :key="item.name" class="confirm-row" :class="{ 'is-new': !item.conflict }">
            <span class="confirm-name">{{ item.name }}</span>
            <template v-if="item.conflict">
              <el-radio-group v-model="choices[item.name]" class="confirm-radio-group">
                <el-radio value="replace">替换</el-radio>
                <el-radio value="keep">保留两份</el-radio>
                <el-radio value="skip">取消</el-radio>
              </el-radio-group>
            </template>
            <el-radio-group v-else v-model="choices[item.name]" class="confirm-radio-group">
              <el-radio value="keep">保留</el-radio>
              <el-radio value="skip">取消</el-radio>
            </el-radio-group>
          </div>
        </div>

        <!-- 分页控件 -->
        <div v-if="totalPages > 1" class="confirm-pagination">
          <el-pagination
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :total="allFiles.length"
            layout="prev, pager, next"
            small
            background
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="onConfirmCancel">取消上传</el-button>
        <el-button type="primary" @click="onConfirmOk">确定上传</el-button>
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
import { ref, computed, inject, watch, onUnmounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { checkConflicts, apiUrl } from '../api'

const props = defineProps({
  uploadPath: { type: String, default: '/' },
  rootIndex: { type: Number, default: undefined }
})

const emit = defineEmits(['uploaded'])

const uploading = ref(false)
const progress = ref(0)
const progressText = ref('')
const uploadResult = ref('')
const uploadError = ref(false)
let resultTimer = null

// 上传确认弹窗
const showConfirm = ref(false)
const allFiles = ref([])         // [{ name, conflict }]
const choices = ref({})           // { [name]: 'replace' | 'keep' | 'skip' }
const currentPage = ref(1)
const pageSize = 10

const totalPages = computed(() => Math.ceil(allFiles.value.length / pageSize))
const pagedFiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return allFiles.value.slice(start, start + pageSize)
})

let _confirmResolve = null

onUnmounted(() => {
  if (resultTimer) clearTimeout(resultTimer)
})

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

// 上传流程：冲突检查 → （有冲突则弹窗确认） → XHR 上传
async function uploadFiles(fileList) {
  let files = Array.from(fileList).filter(f => !(f.size === 0 && f.type === ''))
  if (files.length === 0) {
    showTemporaryMsg('不支持上传文件夹，请选择文件', true)
    return
  }

  const names = files.map(f => f.name)
  uploading.value = true
  progress.value = 0
  progressText.value = '检查文件冲突...'
  uploadResult.value = ''
  uploadError.value = false

  let replaceList = []
  try {
    // Phase 1: 冲突检查
    const res = await checkConflicts(props.uploadPath, names, props.rootIndex)
    const conflicts = res.data.conflicts || []

    if (conflicts.length > 0) {
      // 有冲突 → 弹确认窗
      uploading.value = false
      const result = await showConfirmDialog(names, conflicts)
      if (!result) return  // 用户点击取消上传

      replaceList = result.replaceList
      const skipList = result.skipList || []
      // 过滤掉取消的文件
      if (skipList.length > 0) {
        files = files.filter(f => !skipList.includes(f.name))
        if (files.length === 0) { uploading.value = false; return }
      }
      uploading.value = true
    }

    // Phase 2: 上传
    const formData = new FormData()
    formData.append('targetPath', props.uploadPath)
    if (props.rootIndex !== undefined && props.rootIndex !== null) {
      formData.append('root', props.rootIndex)
    }
    formData.append('replace', replaceList.join(','))
    let count = 0
    for (const file of files) {
      formData.append('files', file)
      count++
    }
    if (count === 0) { uploading.value = false; return }

    progress.value = 0
    progressText.value = `准备上传 ${count} 个文件...`

    const data = await xhrUpload(formData)
    uploadResult.value = data.message || '上传完成'
    uploadError.value = false
    const newNames = (data.data?.files || []).map(f => f.name).filter(Boolean)
    emit('uploaded', newNames)
  } catch (err) {
    uploadResult.value = err.message || '上传失败'
    uploadError.value = true
  } finally {
    uploading.value = false
    resultTimer = setTimeout(() => { uploadResult.value = '' }, 3000)
  }
}

// XHR 上传
function xhrUpload(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/upload'))

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        progress.value = Math.round((e.loaded / e.total) * 100)
        progressText.value = `上传中 ${progress.value}%`
      }
    })

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
}

// 全部设为统一操作
function setAllChoices(value) {
  for (const item of allFiles.value) {
    if (item.conflict) {
      choices.value[item.name] = value
    } else if (value === 'skip') {
      choices.value[item.name] = 'skip'
    }
  }
}

function skipFile(name) {
  choices.value[name] = 'skip'
}

// 确认弹窗：返回 Promise
// resolve(replaceList) = 用户确认
// resolve(null) = 用户取消
function showConfirmDialog(names, conflicts) {
  return new Promise(resolve => {
    const conflictSet = new Set(conflicts)
    allFiles.value = names.map(name => ({ name, conflict: conflictSet.has(name) }))
    choices.value = {}
    for (const name of conflicts) {
      choices.value[name] = 'replace'
    }
    for (const name of names) {
      if (!conflictSet.has(name)) {
        choices.value[name] = 'keep'
      }
    }
    currentPage.value = 1
    showConfirm.value = true
    _confirmResolve = resolve
  })
}

function onConfirmOk() {
  showConfirm.value = false
  if (_confirmResolve) {
    const replaceList = Object.entries(choices.value)
      .filter(([, v]) => v === 'replace')
      .map(([k]) => k)
    const skipList = Object.entries(choices.value)
      .filter(([, v]) => v === 'skip')
      .map(([k]) => k)
    // 每条取消的文件记一条日志
    for (const name of skipList) {
      fetch(apiUrl('/logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'info', type: 1, data: { op: 0, file: name, dir: props.uploadPath } })
      }).catch(() => {})
    }
    _confirmResolve({ replaceList, skipList })
    _confirmResolve = null
  }
}

function onConfirmCancel() {
  showConfirm.value = false
  if (_confirmResolve) {
    _confirmResolve(null)
    _confirmResolve = null
  }
  // 记取消日志
  fetch(apiUrl('/logs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'info', type: 1, data: { op: 0, count: allFiles.value.length, files: allFiles.value.map(f => f.name), dir: props.uploadPath } })
  }).catch(() => {})
}

function showTemporaryMsg(msg, isError) {
  uploadResult.value = msg
  uploadError.value = isError
  resultTimer = setTimeout(() => { uploadResult.value = '' }, 3000)
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
  color: #000;
  margin: 8px 0 4px;
  font-size: 16px;
  font-weight: 500;
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

.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: 480px;
}

.confirm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 4px;
}

.confirm-actions-label {
  font-size: 13px;
  color: #909399;
  white-space: nowrap;
}

.confirm-summary {
  margin-left: auto;
  font-size: 13px;
  color: #909399;
}

.confirm-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 100px;
  overflow-y: auto;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 14px;
}

.confirm-row.is-new {
  background: transparent;
  color: #909399;
}

.confirm-row:not(.is-new) {
  background: #fafafa;
}

.confirm-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.confirm-status {
  flex-shrink: 0;
  font-size: 12px;
  color: #67c23a;
  padding: 0 8px;
}

.confirm-radio-group {
  flex-shrink: 0;
}

.confirm-pagination {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

@media (max-width: 768px) {
  .drop-zone {
    padding: 16px 12px;
  }
  .drop-text {
    font-size: 13px;
  }
}
</style>
