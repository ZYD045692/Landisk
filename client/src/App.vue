<template>
  <el-container
    class="app-container"
    :class="{ 'global-dragover': globalDragover }"
    @dragover.prevent="globalDragover = true"
    @drop.prevent="onGlobalDrop"
  >
    <el-header class="app-header" height="56px">
      <div class="header-left">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#e0e6ed" stroke-width="2"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
        <span class="app-title">LanDisk</span>
      </div>
      <div class="header-right">
        <el-tag v-if="roots.length > 0" type="info" size="small">
          {{ roots.length }} 个目录
        </el-tag>
        <el-button circle size="small" title="扫码访问" @click="showQR = true">
          <svg viewBox="0 0 1024 1024" width="14" height="14" fill="#000"><path d="M411 71.3c13.6 0 25 11.5 25 25v317.3c0 13.6-11.5 25-25 25H78c-13.6 0-25-11.5-25-25V96.3c0-13.6 11.5-25 25-25h333m0-50H78c-41.3 0-75 33.8-75 75v317.3c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V96.3c0-41.3-33.8-75-75-75z m0 567.4c13.6 0 25 11.5 25 25V931c0 13.6-11.5 25-25 25H78c-13.6 0-25-11.5-25-25V613.7c0-13.6 11.5-25 25-25h333m0-50.1H78c-41.3 0-75 33.8-75 75V931c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V613.7c0-41.3-33.8-75.1-75-75.1zM944 71.3c13.6 0 25 11.5 25 25v317.3c0 13.6-11.5 25-25 25H611c-13.6 0-25-11.5-25-25V96.3c0-13.6 11.5-25 25-25h333m0-50H611c-41.3 0-75 33.8-75 75v317.3c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V96.3c0-41.3-33.8-75-75-75zM631.7 605.9c-13.8 0-25 11.3-25 25v50c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25v-50c0.1-13.8-11.2-25-25-25z m147 0c-13.8 0-25 11.3-25 25v147.5c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V630.9c0-13.8-11.3-25-25-25z m144.6 0c-13.8 0-25 11.3-25 25v82.4c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25v-82.4c0-13.8-11.3-25-25-25z m0 198.3c-13.8 0-25 11.3-25 25v114.3c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V829.2c0-13.7-11.3-25-25-25z m-291.6-31.9c-13.8 0-25 11.3-25 25v146.3c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V797.3c0.1-13.7-11.2-25-25-25z m147 66.6c-13.8 0-25 11.3-25 25v79.7c0 13.8 11.3 25 25 25s25-11.3 25-25v-79.7c0-13.8-11.3-25-25-25z"/></svg>
        </el-button>
        <el-button circle size="small" title="设置" @click="$refs.settings.open()">
          <svg viewBox="0 0 1024 1024" width="14" height="14" fill="#000"><path d="M512.25928 704c-108.8 0-192-83.2-192-192s83.2-192 192-192 192 83.2 192 192-83.2 192-192 192z m0-320c-70.4 0-128 57.6-128 128s57.6 128 128 128 128-57.6 128-128-57.6-128-128-128z"/><path d="M640.25928 1024H384.25928c-19.2 0-32-12.8-32-32v-121.6c-25.6-12.8-51.2-25.6-70.4-38.4l-102.4 64c-12.8 6.4-32 6.4-44.8-12.8l-128-224C-6.14072 640 0.25928 620.8 19.45928 614.4l102.4-64v-76.8l-102.4-64C0.25928 403.2-6.14072 384 6.65928 364.8l128-224c6.4-12.8 25.6-19.2 44.8-6.4l102.4 64c19.2-12.8 44.8-32 70.4-38.4V32c0-19.2 12.8-32 32-32h256c19.2 0 32 12.8 32 32v121.6c25.6 12.8 51.2 25.6 70.4 38.4l102.4-64c12.8-6.4 32-6.4 44.8 12.8l128 224c12.8 19.2 6.4 38.4-12.8 44.8l-102.4 64v76.8l102.4 64c12.8 6.4 19.2 25.6 12.8 44.8l-128 224c-6.4 12.8-25.6 19.2-44.8 12.8l-102.4-64c-19.2 12.8-44.8 32-70.4 38.4V992c0 19.2-12.8 32-32 32z m-224-64h192v-108.8c0-12.8 6.4-25.6 19.2-32 32-12.8 64-32 89.6-51.2 12.8-6.4 25.6-6.4 38.4 0l96 57.6 96-166.4-96-57.6c-12.8-12.8-19.2-25.6-12.8-38.4 0-19.2 6.4-32 6.4-51.2s0-32-6.4-51.2c0-12.8 6.4-25.6 12.8-32l96-57.6-96-166.4-96 57.6c-12.8 6.4-25.6 6.4-38.4 0-25.6-19.2-57.6-38.4-89.6-51.2-12.8-12.8-19.2-25.6-19.2-38.4V64H416.25928v108.8c0 12.8-6.4 25.6-19.2 32-32 12.8-64 32-89.6 51.2-12.8 6.4-25.6 6.4-38.4 0l-96-51.2-96 166.4 96 57.6c12.8 6.4 19.2 19.2 12.8 32 0 19.2-6.4 32-6.4 51.2 0 19.2 0 32 6.4 51.2 6.4 12.8 0 25.6-12.8 32l-96 57.6 96 166.4 96-57.6c12.8-6.4 25.6-6.4 38.4 0 25.6 19.2 57.6 38.4 89.6 51.2 12.8 6.4 19.2 19.2 19.2 32V960z"/></svg>
        </el-button>
        <el-button circle size="small" title="服务器日志" @click="$refs.logViewer.open()">
          <svg viewBox="0 0 1024 1024" width="14" height="14" fill="#000"><path d="M608.402286 325.924571H302.592c-25.6 0-46.592 19.163429-46.592 42.642286 0 23.478857 20.992 42.715429 46.592 42.715429h305.883429c25.6 0 46.518857-19.236571 46.518857-42.715429 0-23.405714-20.918857-42.642286-46.592-42.642286z m-119.588572 420.278858H302.592c-25.6 0-46.592 19.236571-46.592 42.715428 0 23.405714 20.992 42.642286 46.592 42.642286h186.221714c25.6 0 46.592-19.236571 46.592-42.642286 0-23.478857-20.992-42.715429-46.592-42.715428zM675.108571 536.649143H302.592c-25.6 0-46.592 19.163429-46.592 42.642286 0 23.478857 20.992 42.642286 46.592 42.642285H675.108571c25.6 0 46.518857-19.163429 46.518858-42.642285 0-23.405714-20.918857-42.642286-46.518858-42.642286z m235.52 350.281143c0 21.284571-24.649143 44.470857-45.714285 44.470857H159.305143c-21.211429 0-45.056-23.186286-45.056-44.470857V215.332571c0-21.284571 23.844571-44.617143 45.056-44.617142H256.731429v37.741714c0 26.038857 21.138286 47.323429 46.957714 47.323428a47.323429 47.323429 0 0 0 47.030857-47.323428v-37.741714h324.022857v37.741714c0 26.038857 21.211429 47.323429 47.104 47.323428a47.323429 47.323429 0 0 0 46.957714-47.323428v-37.741714h96.036572c21.211429 0 45.714286 23.405714 45.714286 44.617142v671.597715zM855.552 78.262857h-86.674286V47.542857A47.323429 47.323429 0 0 0 721.92 0.073143a47.323429 47.323429 0 0 0-47.030857 47.323428v30.793143h-324.022857V47.542857a47.323429 47.323429 0 0 0-47.104-47.396571 47.323429 47.323429 0 0 0-46.957715 47.323428v30.793143H168.667429c-78.848 0-145.554286 67.145143-145.554286 146.578286v652.653714c0 79.36 66.706286 146.505143 145.554286 146.505143h686.811428c78.921143 0 145.554286-67.145143 145.554286-146.505143V224.841143c0-79.433143-66.633143-146.578286-145.554286-146.578286z"/></svg>
        </el-button>
      </div>

      <!-- 扫码 Dialog -->
      <el-dialog v-model="showQR" width="360px" center destroy-on-close class="qr-dialog" append-to-body :show-close="false">
        <template #title><div style="display:flex;align-items:center;gap:6px;font-size:18px;font-weight: 600;"><svg t="1785071639942" viewBox="0 0 1024 1024" width="18" height="18" fill="#000"><path d="M411 71.3c13.6 0 25 11.5 25 25v317.3c0 13.6-11.5 25-25 25H78c-13.6 0-25-11.5-25-25V96.3c0-13.6 11.5-25 25-25h333m0-50H78c-41.3 0-75 33.8-75 75v317.3c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V96.3c0-41.3-33.8-75-75-75z m0 567.4c13.6 0 25 11.5 25 25V931c0 13.6-11.5 25-25 25H78c-13.6 0-25-11.5-25-25V613.7c0-13.6 11.5-25 25-25h333m0-50.1H78c-41.3 0-75 33.8-75 75V931c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V613.7c0-41.3-33.8-75.1-75-75.1zM944 71.3c13.6 0 25 11.5 25 25v317.3c0 13.6-11.5 25-25 25H611c-13.6 0-25-11.5-25-25V96.3c0-13.6 11.5-25 25-25h333m0-50H611c-41.3 0-75 33.8-75 75v317.3c0 41.3 33.8 75 75 75h333c41.3 0 75-33.8 75-75V96.3c0-41.3-33.8-75-75-75zM631.7 605.9c-13.8 0-25 11.3-25 25v50c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25v-50c0.1-13.8-11.2-25-25-25z m147 0c-13.8 0-25 11.3-25 25v147.5c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V630.9c0-13.8-11.3-25-25-25z m144.6 0c-13.8 0-25 11.3-25 25v82.4c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25v-82.4c0-13.8-11.3-25-25-25z m0 198.3c-13.8 0-25 11.3-25 25v114.3c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V829.2c0-13.7-11.3-25-25-25z m-291.6-31.9c-13.8 0-25 11.3-25 25v146.3c0 13.8 11.3 25 25 25 13.8 0 25-11.3 25-25V797.3c0.1-13.7-11.2-25-25-25z m147 66.6c-13.8 0-25 11.3-25 25v79.7c0 13.8 11.3 25 25 25s25-11.3 25-25v-79.7c0-13.8-11.3-25-25-25z"/></svg><span>扫码访问</span></div></template>
        <div class="qr-body">
          <img v-if="qrDataUrl" :src="qrDataUrl" class="qr-image" alt="QR Code" />
          <el-skeleton v-else :rows="1" animated style="width:200px;height:200px;margin:0 auto" />
          <a :href="serverUrl" target="_blank" rel="noopener noreferrer" class="qr-url">{{ serverUrl }}</a>
          <el-button size="small" @click="copyUrl">
            复制链接
          </el-button>
          <p class="qr-hint">设备和电脑需在同一局域网下</p>
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
        description="后端服务未启动，请重启应用"
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
// 图标全部使用自定义 SVG，不再从 element-plus/icons-vue 导入
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
// 本机判断：先用壳/localhost 猜，server-info 返回后按后端来源 IP 精确校正
const isLocal = ref(
  (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) ||
  (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'))
)
const settings = ref(null)
const logViewer = ref(null)

async function loadRoots() {
  try {
    const res = await fetchRoots()
    roots.value = res.data.data?.roots || []
  } catch { roots.value = [] }
}
provide('roots', roots)
provide('isLocal', isLocal)

const globalDragover = ref(false)
const droppedFiles = ref(null)

function onGlobalDrop(e) {
  globalDragover.value = false
  droppedFiles.value = e.dataTransfer.files
}
provide('droppedFiles', droppedFiles)
const refreshFilesKey = ref(0)
provide('refreshFilesKey', refreshFilesKey)

const serverDown = ref(false)
const serverRetrying = ref(false)
let retryTimer = null

async function tryConnect(retries = 5) {
  serverRetrying.value = retries < 5
  try {
    const res = await api.get('/server-info')
    serverUrl.value = res.data.url
    qrDataUrl.value = await QRCode.toDataURL(res.data.url, { width: 200, margin: 1 })
    isLocal.value = res.data.local === true
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
  window.addEventListener('dragover', (e) => { e.preventDefault(); globalDragover.value = true })
  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) globalDragover.value = false
  })
  window.addEventListener('drop', (e) => { globalDragover.value = false })
})

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
})

function copyUrl() {
  navigator.clipboard.writeText(serverUrl.value).then(() => {
    ElMessage.success('已复制')
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
.qr-dialog.el-dialog--center .el-dialog__header { display: flex; justify-content: center; align-items: center; padding: 12px 0; position: relative; }
.qr-dialog .el-dialog__title { display: flex; align-items: center; }
.qr-dialog .el-dialog__headerbtn { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }

.qr-body { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.qr-image { width: 200px; height: 200px; border: 1px solid #ebeef5; border-radius: 4px; }
.qr-url { font-size: 14px; color: #409eff; word-break: break-all; text-align: center; cursor: pointer; }
.qr-url:hover { text-decoration: underline; }
.qr-hint { font-size: 12px; color: #606266; margin: 0; }

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
.drop-text { font-size: 20px; color: #000; margin: 0; font-weight: 600;}

/* 日志文件列表对齐 */
.log-prefix-transparent { visibility: hidden; }
.log-pad-hidden { visibility: hidden; }
.log-text { white-space: pre-wrap; }
</style>
