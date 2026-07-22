<template>
  <el-dialog v-model="showSettings" title="设置" width="520px" destroy-on-close>
    <div class="settings-body">
      <div class="settings-section">
        <div class="section-title">服务配置</div>
        <div class="setting-row">
          <span class="setting-label">端口号</span>
          <el-input-number v-model="configPort" :min="1" :max="65535" size="small" controls-position="right" style="width:160px" />
        </div>
        <div class="setting-row">
          <span class="setting-label">最大上传 (MB)</span>
          <el-input-number v-model="configMaxSize" :min="1" :max="9999" size="small" controls-position="right" style="width:160px" />
        </div>
        <div class="setting-row">
          <span class="setting-label">显示隐藏文件</span>
          <el-switch v-model="configShowHidden" size="small" />
        </div>
        <div class="setting-actions">
          <el-button type="primary" size="small" @click="handleSaveConfig" :loading="configSaving">保存设置</el-button>
          <span v-if="configSaved" class="success-msg">✓ 已保存</span>
        </div>
      </div>

      <el-divider />

      <div class="settings-section">
        <div class="section-title">共享目录</div>
        <div v-if="roots.length === 0" class="empty-hint">暂无共享目录</div>
        <div v-for="root in roots" :key="root.path" class="root-item">
          <div class="root-info">
            <el-icon :size="18"><Folder /></el-icon>
            <span class="root-name">{{ root.name }}</span>
            <span class="root-path">{{ root.path }}</span>
          </div>
          <el-button type="danger" size="small" plain @click="handleRemoveRoot(root.path)">
            移除
          </el-button>
        </div>
        <div class="add-section">
          <el-input
            v-model="newRootPath"
            placeholder="输入目录绝对路径，如 D:\Share"
            clearable
            @keyup.enter="handleAddRoot"
          />
          <el-button type="primary" size="small" @click="handleAddRoot" :loading="adding">
            添加
          </el-button>
        </div>
      </div>
      <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, inject } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Folder } from '@element-plus/icons-vue'
import { fetchRoots, addRoot, removeRoot, fetchConfig, updateConfig } from '../api'

const showSettings = ref(false)
const configPort = ref(22580)
const configMaxSize = ref(500)
const configShowHidden = ref(false)
const configSaving = ref(false)
const configSaved = ref(false)
const roots = inject('roots', ref([]))
const newRootPath = ref('')
const adding = ref(false)
const settingsError = ref('')

function open() {
  showSettings.value = true
  loadConfig()
  loadRoots()
}

defineExpose({ open })

async function loadRoots() {
  try {
    const res = await fetchRoots()
    roots.value = res.data.roots || []
  } catch { roots.value = [] }
}

async function loadConfig() {
  try {
    const res = await fetchConfig()
    configPort.value = res.data.port
    configMaxSize.value = res.data.maxFileSizeMB
    configShowHidden.value = res.data.showHiddenFiles
  } catch {}
}

async function handleSaveConfig() {
  configSaving.value = true
  configSaved.value = false
  try {
    await updateConfig({
      port: configPort.value,
      maxFileSizeMB: configMaxSize.value,
      showHiddenFiles: configShowHidden.value
    })
    configSaved.value = true
    setTimeout(() => configSaved.value = false, 2000)
  } catch (err) {
    settingsError.value = err.response?.data?.error || '保存失败'
  } finally {
    configSaving.value = false
  }
}

async function handleAddRoot() {
  const p = newRootPath.value.trim()
  if (!p) return
  adding.value = true
  settingsError.value = ''
  try {
    const res = await addRoot(p)
    roots.value = res.data.roots || []
    newRootPath.value = ''
  } catch (err) {
    if (err.response) {
      settingsError.value = err.response.data?.error || `服务器错误 (${err.response.status})`
    } else if (err.request) {
      settingsError.value = '无法连接到服务，请重启应用'
    } else {
      settingsError.value = err.message || '添加失败'
    }
  } finally {
    adding.value = false
  }
}

async function handleRemoveRoot(targetPath) {
  try {
    await ElMessageBox.confirm(`确定移除共享目录「${targetPath}」？`, '确认', {
      confirmButtonText: '移除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch { return }
  settingsError.value = ''
  try {
    const res = await removeRoot(targetPath)
    roots.value = res.data.roots || []
  } catch (err) {
    settingsError.value = err.response?.data?.error || '移除失败'
  }
}
</script>

<style scoped>
.settings-body { padding-left: 0; }
.settings-body { display: flex; flex-direction: column; gap: 12px; }
.settings-section { display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 14px; font-weight: 600; color: #303133; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
.setting-label { font-size: 13px; color: #606266; }
.setting-actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
.success-msg { font-size: 13px; color: #67c23a; }
.empty-hint { color: #909399; font-size: 14px; text-align: center; padding: 12px 0; }

.root-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}
.root-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.root-name { font-weight: 600; white-space: nowrap; }
.root-path { color: #909399; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-section { display: flex; gap: 8px; }
.add-section .el-input { flex: 1; }
.error-msg { color: #f56c6c; font-size: 13px; }
</style>
