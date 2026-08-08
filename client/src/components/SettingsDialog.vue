<template>
  <el-dialog v-model="showSettings" width="520px" destroy-on-close append-to-body :show-close="false" class="settings-dialog-wrap">
    <template #title><div style="display:flex;align-items:center;gap:6px;font-size:18px;font-weight: 600;"><svg viewBox="0 0 1024 1024" width="18" height="18" fill="#000"><path d="M512.25928 704c-108.8 0-192-83.2-192-192s83.2-192 192-192 192 83.2 192 192-83.2 192-192 192z m0-320c-70.4 0-128 57.6-128 128s57.6 128 128 128 128-57.6 128-128-57.6-128-128-128z" p-id="3205"></path><path d="M640.25928 1024H384.25928c-19.2 0-32-12.8-32-32v-121.6c-25.6-12.8-51.2-25.6-70.4-38.4l-102.4 64c-12.8 6.4-32 6.4-44.8-12.8l-128-224C-6.14072 640 0.25928 620.8 19.45928 614.4l102.4-64v-76.8l-102.4-64C0.25928 403.2-6.14072 384 6.65928 364.8l128-224c6.4-12.8 25.6-19.2 44.8-6.4l102.4 64c19.2-12.8 44.8-32 70.4-38.4V32c0-19.2 12.8-32 32-32h256c19.2 0 32 12.8 32 32v121.6c25.6 12.8 51.2 25.6 70.4 38.4l102.4-64c12.8-6.4 32-6.4 44.8 12.8l128 224c12.8 19.2 6.4 38.4-12.8 44.8l-102.4 64v76.8l102.4 64c12.8 6.4 19.2 25.6 12.8 44.8l-128 224c-6.4 12.8-25.6 19.2-44.8 12.8l-102.4-64c-19.2 12.8-44.8 32-70.4 38.4V992c0 19.2-12.8 32-32 32z m-224-64h192v-108.8c0-12.8 6.4-25.6 19.2-32 32-12.8 64-32 89.6-51.2 12.8-6.4 25.6-6.4 38.4 0l96 57.6 96-166.4-96-57.6c-12.8-12.8-19.2-25.6-12.8-38.4 0-19.2 6.4-32 6.4-51.2s0-32-6.4-51.2c0-12.8 6.4-25.6 12.8-32l96-57.6-96-166.4-96 57.6c-12.8 6.4-25.6 6.4-38.4 0-25.6-19.2-57.6-38.4-89.6-51.2-12.8-12.8-19.2-25.6-19.2-38.4V64H416.25928v108.8c0 12.8-6.4 25.6-19.2 32-32 12.8-64 32-89.6 51.2-12.8 6.4-25.6 6.4-38.4 0l-96-51.2-96 166.4 96 57.6c12.8 6.4 19.2 19.2 12.8 32 0 19.2-6.4 32-6.4 51.2 0 19.2 0 32 6.4 51.2 6.4 12.8 0 25.6-12.8 32l-96 57.6 96 166.4 96-57.6c12.8-6.4 25.6-6.4 38.4 0 25.6 19.2 57.6 38.4 89.6 51.2 12.8 6.4 19.2 19.2 19.2 32V960z"></path></svg><span>设置</span></div></template>
    <div class="settings-body">
      <div class="settings-section">
        <div class="section-title">服务配置</div>
        <div class="setting-row">
          <span class="setting-label">最大上传 (MB)</span>
          <span class="setting-value" @click="openSubDialog">{{ configMaxSize }}</span>
        </div>
        <div class="setting-row">
          <span class="setting-label">显示隐藏文件</span>
          <el-switch v-model="configShowHidden" size="large" @change="handleHiddenChanged" />
        </div>
        <div v-if="isShell" class="setting-row">
          <span class="setting-label">开机自启</span>
          <el-switch v-model="autoStart" size="large" @change="handleAutoStart" />
        </div>
        <div class="setting-row">
          <span class="setting-label">日志目录</span>
          <span class="logdir-open" :title="logPath ? '点击打开：' + logPath : ''" @click="openLogDir">
            <svg class="logdir-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
            <span>{{ logDirName || '日志文件夹' }}</span>
          </span>
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
          <div class="root-actions">
            <el-button size="small" plain @click="openRenameDialog(root)">重命名</el-button>
            <el-button size="small" type="danger" plain @click="handleRemoveRoot(root.path)">移除</el-button>
          </div>
        </div>
        <div class="add-section">
          <el-input
            v-model="newRootPath"
            placeholder="输入绝对路径，如 D:\Share"
            clearable
            class="path-input"
            @keyup.enter="handleAddRoot"
            style="flex: 5"
          />
          <el-input
            v-model="newRootName"
            placeholder="名称（默认文件夹名）"
            clearable
            class="name-input"
            maxlength="50"
            @keyup.enter="handleAddRoot"
            style="flex: 4"
          />
          <el-button type="primary" @click="handleAddRoot" :loading="adding">
            添加
          </el-button>
        </div>
      </div>
    </div>

    <!-- 重命名共享目录弹窗（布局与「最大上传」子弹窗一致） -->
    <el-dialog v-model="showRenameDialog" width="360px" destroy-on-close append-to-body :show-close="false" class="sub-dialog-wrap">
      <template #title><span class="sub-dialog-title">重命名共享目录</span></template>
      <div class="sub-dialog-body">
        <div class="rename-row">
          <span class="rename-label">绝对路径</span>
          <span class="rename-value">{{ renameTarget?.path || '' }}</span>
        </div>
        <div class="rename-row">
          <span class="rename-label">原名</span>
          <span class="rename-value">{{ renameTarget?.name || '' }}</span>
        </div>
        <div class="rename-row">
          <span class="rename-label">新名称</span>
          <el-input v-model="renameValue" placeholder="输入新名称" maxlength="50" @keyup.enter="handleRename" />
        </div>
      </div>
      <template #footer>
        <div class="sub-dialog-footer">
          <el-button @click="showRenameDialog = false">取消</el-button>
          <el-button type="primary" @click="handleRename">保存</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 上传设置子弹窗 -->
    <el-dialog v-model="showSubDialog" width="360px" destroy-on-close append-to-body :show-close="false" class="sub-dialog-wrap">
      <template #title><span class="sub-dialog-title">上传设置</span></template>
      <div class="sub-dialog-body">
        <div class="sub-dialog-row">
          <span class="sub-dialog-label">最大上传 (MB)</span>
          <el-input v-model="subDialogValue" placeholder="1-9999" @keyup.enter="handleSubSave" />
        </div>
      </div>
      <template #footer>
        <div class="sub-dialog-footer">
          <el-button @click="showSubDialog = false">取消</el-button>
          <el-button type="primary" @click="handleSubSave">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue'
import { fetchRoots, addRoot, removeRoot, renameRoot, fetchConfig, updateConfig, openLogDir as openLogDirRequest } from '../api'
import api from '../api'
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart'
import { isShell } from '../utils/env'

const showSettings = ref(false)
const configMaxSize = ref(500)
const configShowHidden = ref(false)
const autoStart = ref(false)
const logPath = ref('')
const refreshFilesKey = inject('refreshFilesKey', ref(0))

// 只显示日志目录名（最后一段），完整路径放 tooltip
const logDirName = computed(() => {
  if (!logPath.value) return ''
  const parts = logPath.value.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || logPath.value
})

// 上传设置子弹窗
const showSubDialog = ref(false)
const subDialogValue = ref('')
const roots = inject('roots', ref([]))
const newRootPath = ref('')
const newRootName = ref('')
const adding = ref(false)

// 输入路径后自动填名称（取路径最后一段），用户可改
watch(newRootPath, (val) => {
  const parts = val.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  newRootName.value = parts[parts.length - 1] || ''
})


async function openLogDir() {
  if (!isShell.value) {
    ElMessage.info('请在桌面应用中打开日志目录')
    return
  }
  try {
    const res = await openLogDirRequest()
    if (!res.data.success) ElMessage.error(res.data.message || '打开失败')
    else ElMessage.success('已打开日志目录')
  } catch {
    ElMessage.error('打开失败')
  }
}

async function loadAutoStart() {
  if (!isShell.value) return
  try { autoStart.value = await isEnabled() }
  catch (e) { api.post('/logs', { level: 'error', message: '[自动启动] 检查状态失败: ' + (e.message || e) }) }
}

async function handleAutoStart(val) {
  try {
    if (val) await enable()
    else await disable()
    api.post('/logs', { level: 'info', type: 8, message: val ? '开启开机自启' : '关闭开机自启', data: { op: 1, field: 'autostart', now: val } })
    ElMessage.success(val ? '已开启开机自启' : '已关闭开机自启')
  } catch (e) {
    api.post('/logs', { level: 'error', message: '[自动启动] 操作失败: ' + (e.message || e) })
    ElMessage.error('操作失败')
    autoStart.value = !val
  }
}

function open() {
  newRootPath.value = ''
  showSettings.value = true
  loadConfig()
  loadRoots()
  loadAutoStart()
}

defineExpose({ open })

async function loadRoots() {
  try {
    const res = await fetchRoots()
    roots.value = res.data.data?.roots || []
  } catch (e) {
    console.error('loadRoots error:', e)
    roots.value = []
  }
}

async function loadConfig() {
  try {
    const res = await fetchConfig()
    configMaxSize.value = res.data.maxFileSizeMB
    configShowHidden.value = res.data.showHiddenFiles
    logPath.value = res.data.logPath || ''
  } catch {}
}

async function handleSaveConfig(restore) {
  try {
    const res = await updateConfig({
      maxFileSizeMB: Number(configMaxSize.value),
      showHiddenFiles: configShowHidden.value
    })
    if (!res.data.success) throw new Error(res.data.message)
    return true
  } catch (e) {
    ElMessage.error(e.message || '配置保存失败')
    if (restore) restore()
    return false
  }
}

async function handleMaxSizeSaved() {
  const old = configMaxSize.value
  if (await handleSaveConfig(() => { configMaxSize.value = old })) {
    ElMessage.success('最大上传配置已保存')
  }
}

async function handleHiddenChanged(val) {
  const old = !val
  if (await handleSaveConfig(() => { configShowHidden.value = old })) {
    ElMessage.success(val ? '已开启显示隐藏文件' : '已关闭显示隐藏文件')
    refreshFilesKey.value++
  }
}

function openSubDialog() {
  subDialogValue.value = String(configMaxSize.value)
  showSubDialog.value = true
}

async function handleSubSave() {
  const val = Number(subDialogValue.value)
  if (val < 1 || val > 9999) {
    ElMessage.warning('范围 1-9999 MB')
    return
  }
  configMaxSize.value = val
  showSubDialog.value = false
  await handleMaxSizeSaved()
}

async function handleAddRoot() {
  const p = newRootPath.value.trim()
  if (!p) return
  const name = newRootName.value.trim() || p.split(/[\\/]/).pop() || ''
  adding.value = true
  try {
    const res = await addRoot(p, newRootName.value.trim())
    if (!res.data.success) throw { response: { data: res.data } }
    roots.value = res.data.data?.roots || []
    newRootPath.value = ''
    newRootName.value = ''
    ElMessage.success(`已添加共享目录「${name}」`)
  } catch (err) {
    const msg = err.response?.data?.message || err.message || '添加失败'
    ElMessage.error(msg)
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
  } catch {
    // 用户取消移除 → 记「移除已取消」（type=7 op=5，前端写入）
    api.post('/logs', { level: 'info', type: 7, data: { op: 5, dir: targetPath, action: 'remove' } }).catch(() => {})
    return
  }
  try {
    const res = await removeRoot(targetPath)
    if (!res.data.success) throw { response: { data: res.data } }
    roots.value = res.data.data?.roots || []
    ElMessage.success(`已移除共享目录「${targetPath.split(/[\\/]/).pop() || targetPath}」`)
  } catch (err) {
    ElMessage.error(err.response?.data?.message || '移除失败')
  }
}

// 重命名共享目录
const showRenameDialog = ref(false)
const renameTarget = ref(null)
const renameValue = ref('')

function openRenameDialog(root) {
  renameTarget.value = root
  renameValue.value = root.name
  showRenameDialog.value = true
}

async function handleRename() {
  const name = renameValue.value.trim()
  if (!name) { ElMessage.warning('名称不能为空'); return }
  const oldName = renameTarget.value.name
  try {
    const res = await renameRoot(renameTarget.value.path, name)
    if (!res.data.success) throw new Error(res.data.message)
    roots.value = res.data.data?.roots || []
    ElMessage.success(`已重命名共享目录「${oldName}」→「${name}」`)
    showRenameDialog.value = false
  } catch (e) {
    ElMessage.error(e.message || '重命名失败')
  }
}
</script>

<style scoped>
.settings-body { padding-left: 0; }
:deep(.el-divider--horizontal) { margin: 3px 0; }
.settings-body { display: flex; flex-direction: column; gap: 12px; }
.settings-section { display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 16px; font-weight: 600; color: #303133; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
.setting-label { font-size: 14px; color: #000; font-weight: 500; }
.setting-value {
  font-size: 14px;
  color: #000;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  width: 80px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.setting-value:hover { border-color: #409eff; }
.logdir-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 6px;
  background: #f5f7fa;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s;
}
.logdir-open:hover { background: #ecf5ff; color: #409eff; }
.logdir-icon { width: 15px; height: 15px; flex-shrink: 0; }
.sub-dialog-body { padding: 8px 0; }
.sub-dialog-row { display: flex; align-items: center; }
.sub-dialog-row :deep(.el-input) { width: 80px; margin-left: auto; }
.sub-dialog-label { font-size: 14px; color: #000; font-weight: 500; white-space: nowrap; }
.sub-dialog-footer :deep(.el-button--default) { color: #000; }
.sub-dialog-footer { display: flex; justify-content: flex-end; }
.sub-dialog-title { font-size: 18px; font-weight: 600; }
.empty-hint { color: #909399; font-size: 14px; text-align: center; padding: 12px 0; }

.root-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.rename-row {
  display: flex;
  align-items: center;
  margin-top: 10px;
  gap: 8px;
}
.rename-row:first-child { margin-top: 0; }
.rename-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
  flex-shrink: 0;
}
.rename-value {
  font-size: 14px;
  font-weight: 500;
  color: #909399;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rename-row :deep(.el-input) { margin-left: auto; width: 100px; }
.root-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}
.root-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.root-info svg { flex-shrink: 0; }
.root-name { font-weight: 600; white-space: nowrap; }
.root-path { color: #909399; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-section { display: flex; align-items: center; gap: 8px; }
.add-section .el-input { flex: 1; }
/* 路径/名称输入框 placeholder 较长：收紧左右内边距，让文字显示更多 */
.add-section :deep(.path-input .el-input__inner),
.add-section :deep(.name-input .el-input__inner) {
  padding-left: 0px !important;
  padding-right: 0px !important;
  font-size: 13px;
}
.error-msg { color: #f56c6c; font-size: 13px; }
</style>
<style>
.settings-dialog-wrap .el-dialog__body { padding-top: 0; padding-bottom: 0; }
.sub-dialog-wrap { padding: 30px; }
.sub-dialog-wrap .el-dialog__body { padding: 0; }
</style>
