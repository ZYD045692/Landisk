<template>
  <el-container
    class="app-container"
    :class="{ 'global-dragover': globalDragover }"
    @dragover.prevent="globalDragover = true"
    @drop.prevent="onGlobalDrop"
  >
    <el-header class="app-header" height="56px">
      <div class="header-left">
        <el-icon :size="24"><FolderOpened /></el-icon>
        <span class="app-title">LanDisk</span>
      </div>
      <div class="header-right">
        <el-tag v-if="roots.length > 0" type="info" size="small">
          {{ roots.length }} 个目录
        </el-tag>
        <el-button circle :icon="Iphone" size="small" @click="showQR = true" />
        <el-button circle :icon="Setting" size="small" @click="showSettings = true" />
        <el-button circle :icon="Reading" size="small" @click="openLogs" />
      </div>

      <!-- 手机连接 Dialog -->
      <el-dialog v-model="showQR" title="📱 手机扫码访问" width="360px" center destroy-on-close>
        <div class="qr-body">
          <img v-if="qrDataUrl" :src="qrDataUrl" class="qr-image" alt="QR Code" />
          <el-skeleton v-else :rows="1" animated style="width:200px;height:200px;margin:0 auto" />
          <div class="qr-url">{{ serverUrl }}</div>
          <el-button size="small" @click="copyUrl" :type="copied ? 'success' : 'default'">
            {{ copied ? '已复制 ✓' : '复制链接' }}
          </el-button>
          <p class="qr-hint">手机和电脑需在同一 WiFi 下</p>
        </div>
      </el-dialog>
    </el-header>

    <!-- 目录管理 Dialog -->
    <el-dialog v-model="showSettings" title="管理共享目录" width="520px" destroy-on-close>
      <div class="settings-body">
        <!-- 现有目录列表 -->
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

        <!-- 添加新目录 -->
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
        <div v-if="settingsError" class="error-msg">{{ settingsError }}</div>
      </div>
    </el-dialog>

    <!-- 日志查看 Dialog -->
    <el-dialog v-model="showLogs" title="服务器日志" width="750px" top="2vh" destroy-on-close @close="onLogsClose">
      <div class="logs-body">
        <div class="logs-toolbar">
          <div class="log-level-filters">
            <el-button size="small" :type="logLevelFilter === '' ? 'primary' : 'default'" @click="logLevelFilter = ''">全部</el-button>
            <el-button size="small" :type="logLevelFilter === 'INFO' ? 'primary' : 'default'" @click="logLevelFilter = 'INFO'">INFO</el-button>
            <el-button size="small" :type="logLevelFilter === 'WARN' ? 'warning' : 'default'" @click="logLevelFilter = 'WARN'">WARN</el-button>
            <el-button size="small" :type="logLevelFilter === 'ERROR' ? 'danger' : 'default'" @click="logLevelFilter = 'ERROR'">ERROR</el-button>
          </div>
          <el-input v-model="logFilter" placeholder="过滤日志..." clearable size="small" style="width:180px" />
          <el-button size="small" :icon="Refresh" @click="loadLogs" :loading="logsLoading" />
          <span class="log-auto-label">
            <el-switch v-model="logAutoRefresh" size="small" /> 自动刷新
          </span>
        </div>
        <div class="logs-list" ref="logsListRef" @scroll="onLogsScroll">
          <div v-if="logsLoading && filteredLogs.length === 0" class="logs-status">加载中...</div>
          <div v-else-if="filteredLogs.length === 0" class="logs-status">暂无日志</div>
          <div v-else v-for="(entry, i) in filteredLogs" :key="i" class="log-entry">
            <span class="log-ts">{{ entry.timestamp }}</span>
            <span class="log-level" :class="'log-level-' + entry.level.toLowerCase()">{{ entry.level }}</span>
            <span class="log-msg">{{ entry.message }}</span>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 全局拖拽提示 -->
    <div v-if="globalDragover" class="global-drop-overlay">
      <div class="drop-icons">
        <img class="drop-icon-excel" :src="xIcon" />
        <div class="drop-icon-word"><span></span></div>
        <img class="drop-icon-chart" :src="picIcon" />
      </div>
      <p class="drop-text">拖拽文件到此处上传</p>
    </div>

    <el-main class="app-main">
      <el-alert
        v-if="serverRetrying"
        title="正在连接服务..."
        type="info"
        description="等待后端启动中，请稍候"
        show-icon
        :closable="false"
        style="margin-bottom:12px"
      />
      <el-alert
        v-if="serverDown"
        title="无法连接到后端服务"
        type="error"
        description="请确认已安装 Node.js 并且 node 命令在系统 PATH 中。安装地址: https://nodejs.org"
        show-icon
        :closable="false"
        style="margin-bottom:12px"
      />
      <router-view />
    </el-main>

    <el-footer class="app-footer" height="32px">
      <span>LanDisk · 内网文件服务</span>
    </el-footer>
  </el-container>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { Setting, Iphone, Reading, Refresh } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import { fetchRoots, addRoot, removeRoot, fetchLogs } from './api'
import api from './api'
import xIcon from './assets/letter-x.svg'
import picIcon from './assets/picture.svg'

const roots = ref([])
const showSettings = ref(false)
const showQR = ref(false)
const newRootPath = ref('')
const adding = ref(false)
const settingsError = ref('')
const serverUrl = ref('')
const qrDataUrl = ref('')
const copied = ref(false)

async function loadRoots() {
  try {
    const res = await fetchRoots()
    roots.value = res.data.roots || []
  } catch {
    roots.value = []
  }
}

const globalDragover = ref(false)
const droppedFiles = ref(null)

function onGlobalDrop(e) {
  globalDragover.value = false
  droppedFiles.value = e.dataTransfer.files
}
provide('droppedFiles', droppedFiles)

const serverDown = ref(false)
const serverRetrying = ref(false)
let retryTimer = null

async function tryConnect(retries = 5) {
  serverRetrying.value = retries < 5
  try {
    const res = await api.get('/server-info')
    serverUrl.value = res.data.url
    qrDataUrl.value = await QRCode.toDataURL(res.data.url, { width: 200, margin: 1 })
    serverDown.value = false
    serverRetrying.value = false
    loadRoots()  // 重新加载根目录
  } catch {
    if (retries > 0) {
      retryTimer = setTimeout(() => tryConnect(retries - 1), 1000)
    } else {
      serverDown.value = true
      serverRetrying.value = false
    }
  }
}

onMounted(() => {
  tryConnect()  // 连接成功后会回调 loadRoots()，无需重复调用
  // 窗口级 dragleave：拖出窗口时清除提示（dragover 会停止触发）
  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) {
      globalDragover.value = false
    }
  })
})

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
})
provide('roots', roots)

function copyUrl() {
  navigator.clipboard.writeText(serverUrl.value).then(() => {
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  }).catch(() => {})
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
    console.error('[添加目录] 失败:', err)
    if (err.response) {
      console.error('[添加目录] 状态码:', err.response.status)
      console.error('[添加目录] 响应:', err.response.data)
      settingsError.value = err.response.data?.error || `服务器错误 (${err.response.status})`
    } else if (err.request) {
      console.error('[添加目录] 无响应，请确认 Express 服务是否启动')
      settingsError.value = '无法连接到服务，请重启应用'
    } else {
      settingsError.value = err.message || '添加失败'
    }
  } finally {
    adding.value = false
  }
}

async function handleRemoveRoot(targetPath) {
  settingsError.value = ''
  try {
    const res = await removeRoot(targetPath)
    roots.value = res.data.roots || []
  } catch (err) {
    settingsError.value = err.response?.data?.error || '移除失败'
  }
}

// ============ 日志查看 ============

const showLogs = ref(false)
const logEntries = ref([])
const logsLoading = ref(false)
const logFilter = ref('')
const logLevelFilter = ref('')
const logAutoRefresh = ref(true)
const logsListRef = ref(null)
const logsAtBottom = ref(true)
let logTimer = null

// 客户端过滤：等级 + 文本
const filteredLogs = computed(() => {
  let result = logEntries.value
  if (logLevelFilter.value) {
    result = result.filter(e => e.level === logLevelFilter.value)
  }
  if (logFilter.value) {
    const s = logFilter.value.toLowerCase()
    result = result.filter(e => e.message.toLowerCase().includes(s))
  }
  return result
})

function openLogs() {
  showLogs.value = true
  loadLogs()
  startAutoRefresh()
}

async function loadLogs() {
  logsLoading.value = true
  try {
    const res = await fetchLogs(500)
    logEntries.value = res.data || []
    await nextTick()
    if (logsAtBottom.value) {
      scrollToBottom()
    }
  } catch (e) {
    console.error('[日志] 加载失败:', e)
  } finally {
    logsLoading.value = false
  }
}

function onLogsScroll() {
  const el = logsListRef.value
  if (!el) return
  const threshold = 30
  logsAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function scrollToBottom() {
  const el = logsListRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

function startAutoRefresh() {
  if (logTimer) clearInterval(logTimer)
  if (logAutoRefresh.value) {
    logTimer = setInterval(loadLogs, 3000)
  }
}

function onLogsClose() {
  if (logTimer) {
    clearInterval(logTimer)
    logTimer = null
  }
}

// 自动刷新开关变化时启停定时器
watch(logAutoRefresh, (val) => {
  if (showLogs.value) {
    if (val) {
      startAutoRefresh()
    } else {
      if (logTimer) {
        clearInterval(logTimer)
        logTimer = null
      }
    }
  }
})
</script>

<style>
/* 全局重置 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  font-family: Inter, system-ui, sans-serif;
  font-weight: 500;
  font-size: 14px;
  background: #f5f7fa;
  -webkit-font-smoothing: antialiased;
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  color: #fff;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  color: #e0e6ed;
}

.app-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  width: 100%;
  margin: 0 auto;
}

.app-footer {
  background: #fff;
  border-top: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .app-header {
    padding: 0 12px;
  }
  .app-title {
    font-size: 16px;
  }
  .app-main {
    padding: 8px;
  }
}

/* 设置面板 */
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-hint {
  color: #909399;
  font-size: 14px;
  text-align: center;
  padding: 12px 0;
}

.root-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.root-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.root-name {
  font-weight: 600;
  white-space: nowrap;
}

.root-path {
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-section {
  display: flex;
  gap: 8px;
}

.add-section .el-input {
  flex: 1;
}

.error-msg {
  color: #f56c6c;
  font-size: 13px;
}

/* 二维码 */
.qr-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-image {
  width: 200px;
  height: 200px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}

.qr-url {
  font-size: 13px;
  color: #409eff;
  word-break: break-all;
  text-align: center;
}

.qr-hint {
  font-size: 12px;
  color: #c0c4cc;
  margin: 0;
}

/* Element Plus 字体统一 */
.el-button,
.el-input__inner,
.el-table,
.el-table th,
.el-table td,
.el-pagination,
.el-tag,
.el-select,
.el-select-dropdown__item,
.el-dropdown-menu__item,
.el-radio__label,
.el-checkbox__label {
  font-family: Inter, system-ui, sans-serif;
  font-weight: 500;
  font-size: 14px;
}

.global-drop-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(8px);
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.drop-icons {
  width: 140px;
  height: 95px;
  margin: 0 auto;
  position: relative;
  margin-bottom: 24px;
}

.drop-icon-excel {
  position: absolute;
  width: 48px;
  height: 48px;
  left: 16px;
  top: 14px;
  border-radius: 10px;
  transform: rotate(-16deg);
  box-shadow: 0 8px 20px rgba(0,0,0,.05);
  z-index: 1;
}

.drop-icon-word {
  position: absolute;
  width: 48px; height: 54px; right: 16px; top: 8px;
  background: #73a8f0; border-radius: 10px; transform: rotate(16deg);
  box-shadow: 0 8px 20px rgba(90,120,255,.15); z-index: 1;
}
.drop-icon-word::before, .drop-icon-word::after, .drop-icon-word span {
  content: ""; position: absolute; left: 10px; width: 26px; height: 3px;
  border-radius: 2px; background: white;
}
.drop-icon-word::before { top: 14px; }
.drop-icon-word span { top: 24px; }
.drop-icon-word::after { top: 34px; width: 18px; }

.drop-icon-chart {
  position: absolute;
  width: 48px; height: 48px; left: 50%; bottom: 0; transform: translateX(-50%);
  border-radius: 10px; z-index: 3;
  box-shadow: 0 8px 20px rgba(79,112,255,.2);
}

.drop-text {
  font-size: 20px;
  color: #222;
  margin: 0;
}

/* 日志查看器 */
.logs-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 60vh;
}

.logs-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.log-auto-label {
  font-size: 13px;
  color: #606266;
  display: flex;
  align-items: center;
  gap: 4px;
}

.logs-list {
  flex: 1;
  overflow-y: auto;
  background: #1a1a2e;
  border-radius: 6px;
  padding: 8px 0;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-entry {
  display: flex;
  gap: 8px;
  padding: 1px 12px;
}

.log-entry:hover {
  background: rgba(255,255,255,0.05);
}

.log-ts {
  color: #6b7280;
  flex-shrink: 0;
}

.log-level {
  flex-shrink: 0;
  width: 44px;
  text-align: center;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 600;
}

.log-msg {
  color: #d1d5db;
  word-break: break-all;
  white-space: pre-wrap;
}

.log-level-filters {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.logs-status {
  color: #6b7280;
  text-align: center;
  padding: 24px;
}

/* 日志等级颜色 */
.log-level-info {
  color: #60a5fa;
  background: rgba(96,165,250,0.12);
}
.log-level-warn {
  color: #fbbf24;
  background: rgba(251,191,36,0.12);
}
.log-level-error {
  color: #f87171;
  background: rgba(248,113,113,0.12);
}
</style>
