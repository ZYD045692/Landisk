<template>
  <el-dialog v-model="showSettings" width="520px" destroy-on-close append-to-body>
    <template #title><div style="display:flex;align-items:center;gap:6px;font-size:18px"><svg viewBox="0 0 1024 1024" width="18" height="18" fill="#000"><path d="M512.25928 704c-108.8 0-192-83.2-192-192s83.2-192 192-192 192 83.2 192 192-83.2 192-192 192z m0-320c-70.4 0-128 57.6-128 128s57.6 128 128 128 128-57.6 128-128-57.6-128-128-128z" p-id="3205"></path><path d="M640.25928 1024H384.25928c-19.2 0-32-12.8-32-32v-121.6c-25.6-12.8-51.2-25.6-70.4-38.4l-102.4 64c-12.8 6.4-32 6.4-44.8-12.8l-128-224C-6.14072 640 0.25928 620.8 19.45928 614.4l102.4-64v-76.8l-102.4-64C0.25928 403.2-6.14072 384 6.65928 364.8l128-224c6.4-12.8 25.6-19.2 44.8-6.4l102.4 64c19.2-12.8 44.8-32 70.4-38.4V32c0-19.2 12.8-32 32-32h256c19.2 0 32 12.8 32 32v121.6c25.6 12.8 51.2 25.6 70.4 38.4l102.4-64c12.8-6.4 32-6.4 44.8 12.8l128 224c12.8 19.2 6.4 38.4-12.8 44.8l-102.4 64v76.8l102.4 64c12.8 6.4 19.2 25.6 12.8 44.8l-128 224c-6.4 12.8-25.6 19.2-44.8 12.8l-102.4-64c-19.2 12.8-44.8 32-70.4 38.4V992c0 19.2-12.8 32-32 32z m-224-64h192v-108.8c0-12.8 6.4-25.6 19.2-32 32-12.8 64-32 89.6-51.2 12.8-6.4 25.6-6.4 38.4 0l96 57.6 96-166.4-96-57.6c-12.8-12.8-19.2-25.6-12.8-38.4 0-19.2 6.4-32 6.4-51.2s0-32-6.4-51.2c0-12.8 6.4-25.6 12.8-32l96-57.6-96-166.4-96 57.6c-12.8 6.4-25.6 6.4-38.4 0-25.6-19.2-57.6-38.4-89.6-51.2-12.8-12.8-19.2-25.6-19.2-38.4V64H416.25928v108.8c0 12.8-6.4 25.6-19.2 32-32 12.8-64 32-89.6 51.2-12.8 6.4-25.6 6.4-38.4 0l-96-51.2-96 166.4 96 57.6c12.8 6.4 19.2 19.2 12.8 32 0 19.2-6.4 32-6.4 51.2 0 19.2 0 32 6.4 51.2 6.4 12.8 0 25.6-12.8 32l-96 57.6 96 166.4 96-57.6c12.8-6.4 25.6-6.4 38.4 0 25.6 19.2 57.6 38.4 89.6 51.2 12.8 6.4 19.2 19.2 19.2 32V960z"></path></svg><span>设置</span></div></template>
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
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
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
// ElMessageBox 由 unplugin-auto-import 自动引入
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
.add-section { display: flex; align-items: center; gap: 8px; }
.add-section .el-input { flex: 1; }
.error-msg { color: #f56c6c; font-size: 13px; }
</style>
