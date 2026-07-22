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
        <el-button circle :icon="Iphone" size="small" title="手机扫码" @click="showQR = true" />
        <el-button circle :icon="Setting" size="small" title="设置" @click="$refs.settings.open()" />
        <el-button circle :icon="Reading" size="small" title="服务器日志" @click="$refs.logViewer.open()" />
      </div>

      <!-- 手机连接 Dialog -->
      <el-dialog v-model="showQR" title="📱 手机扫码访问" width="360px" center destroy-on-close>
        <div class="qr-body">
          <img v-if="qrDataUrl" :src="qrDataUrl" class="qr-image" alt="QR Code" />
          <el-skeleton v-else :rows="1" animated style="width:200px;height:200px;margin:0 auto" />
          <a :href="serverUrl" target="_blank" rel="noopener noreferrer" class="qr-url">{{ serverUrl }}</a>
          <el-button size="small" @click="copyUrl" :type="copied ? 'success' : 'default'">
            {{ copied ? '已复制 ✓' : '复制链接' }}
          </el-button>
          <p class="qr-hint">手机和电脑需在同一 WiFi 下</p>
        </div>
      </el-dialog>

      <SettingsDialog ref="settings" />
      <LogViewer ref="logViewer" />
    </el-header>

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
import { ref, onMounted, onUnmounted, provide } from 'vue'
import { Setting, Iphone, Reading, FolderOpened } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import api from './api'
import { fetchRoots } from './api'
import xIcon from './assets/letter-x.svg'
import picIcon from './assets/picture.svg'
import SettingsDialog from './components/SettingsDialog.vue'
import LogViewer from './components/LogViewer.vue'

const roots = ref([])
const showQR = ref(false)
const serverUrl = ref('')
const qrDataUrl = ref('')
const copied = ref(false)
const settings = ref(null)
const logViewer = ref(null)

async function loadRoots() {
  try {
    const res = await fetchRoots()
    roots.value = res.data.roots || []
  } catch { roots.value = [] }
}
provide('roots', roots)

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
    loadRoots()
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
  tryConnect()
  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) globalDragover.value = false
  })
})

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
})

function copyUrl() {
  navigator.clipboard.writeText(serverUrl.value).then(() => {
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  }).catch(() => {})
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; font-family: Inter, system-ui, sans-serif; font-weight: 500; font-size: 14px; background: #f5f7fa; -webkit-font-smoothing: antialiased; }

.app-container { height: 100%; display: flex; flex-direction: column; }
.app-header { background: #1a1a2e; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; color: #fff; flex-shrink: 0; }
.header-left { display: flex; align-items: center; gap: 10px; }
.app-title { font-size: 18px; font-weight: 600; color: #e0e6ed; }
.app-main { flex: 1; overflow-y: auto; padding: 16px; width: 100%; margin: 0 auto; }
.app-footer { background: #fff; border-top: 1px solid #ebeef5; display: flex; align-items: center; justify-content: center; color: #909399; font-size: 12px; flex-shrink: 0; }

@media (max-width: 768px) {
  .app-header { padding: 0 12px; }
  .app-title { font-size: 16px; }
  .app-main { padding: 8px; }
  .el-dialog { width: 92vw !important; max-width: none !important; }
}

.header-right { display: flex; align-items: center; gap: 18px; }
.header-right > * { margin: 0 !important; }
.header-right .el-tag { padding: 0 4px; }

.el-dialog__body { padding: 20px; }

.qr-body { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.qr-image { width: 200px; height: 200px; border: 1px solid #ebeef5; border-radius: 4px; }
.qr-url { font-size: 13px; color: #409eff; word-break: break-all; text-align: center; cursor: pointer; }
.qr-url:hover { text-decoration: underline; }
.qr-hint { font-size: 12px; color: #c0c4cc; margin: 0; }

.el-button, .el-input__inner, .el-table, .el-table th, .el-table td, .el-pagination, .el-tag, .el-select, .el-select-dropdown__item, .el-dropdown-menu__item, .el-radio__label, .el-checkbox__label { font-family: Inter, system-ui, sans-serif; font-weight: 500; font-size: 14px; }

.global-drop-overlay { position: fixed; inset: 0; background: rgba(255,255,255,0.6); backdrop-filter: blur(8px); z-index: 9999; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.drop-icons { width: 140px; height: 95px; margin: 0 auto; position: relative; margin-bottom: 24px; }
.drop-icon-excel { position: absolute; width: 48px; height: 48px; left: 16px; top: 14px; border-radius: 10px; transform: rotate(-16deg); box-shadow: 0 8px 20px rgba(0,0,0,.05); z-index: 1; }
.drop-icon-word { position: absolute; width: 48px; height: 54px; right: 16px; top: 8px; background: #73a8f0; border-radius: 10px; transform: rotate(16deg); box-shadow: 0 8px 20px rgba(90,120,255,.15); z-index: 1; }
.drop-icon-word::before, .drop-icon-word::after, .drop-icon-word span { content: ""; position: absolute; left: 10px; width: 26px; height: 3px; border-radius: 2px; background: white; }
.drop-icon-word::before { top: 14px; }
.drop-icon-word span { top: 24px; }
.drop-icon-word::after { top: 34px; width: 18px; }
.drop-icon-chart { position: absolute; width: 48px; height: 48px; left: 50%; bottom: 0; transform: translateX(-50%); border-radius: 10px; z-index: 3; box-shadow: 0 8px 20px rgba(79,112,255,.2); }
.drop-text { font-size: 20px; color: #222; margin: 0; }

/* 日志文件列表对齐 */
.log-prefix-transparent { visibility: hidden; }
.log-pad-hidden { visibility: hidden; }
.log-text { white-space: pre-wrap; }
</style>
