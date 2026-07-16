<template>
  <el-container class="app-container">
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
      </div>

      <!-- 手机连接 Dialog -->
      <el-dialog v-model="showQR" title="📱 手机扫码连接" width="360px" center destroy-on-close>
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

    <el-main class="app-main">
      <router-view />
    </el-main>

    <el-footer class="app-footer" height="32px">
      <span>LanDisk · 内网文件服务</span>
    </el-footer>
  </el-container>
</template>

<script setup>
import { ref, onMounted, provide } from 'vue'
import { Setting, Iphone } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import { fetchRoots, addRoot, removeRoot } from './api'
import api from './api'

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

onMounted(async () => {
  loadRoots()
  try {
    const res = await api.get('/server-info')
    serverUrl.value = res.data.url
    qrDataUrl.value = await QRCode.toDataURL(res.data.url, { width: 200, margin: 1 })
  } catch { /* ignore */ }
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
    settingsError.value = err.response?.data?.error || '添加失败'
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial,
    sans-serif;
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
</style>
