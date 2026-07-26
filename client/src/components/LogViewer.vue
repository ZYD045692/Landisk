<template>
  <el-dialog v-model="showLogs" width="750px" top="5vh" destroy-on-close @close="onLogsClose" append-to-body>
    <template #title><div style="display:flex;align-items:center;gap:6px;font-size:18px"><svg viewBox="0 0 1024 1024" width="18" height="18" fill="#000"><path d="M608.402286 325.924571H302.592c-25.6 0-46.592 19.163429-46.592 42.642286 0 23.478857 20.992 42.715429 46.592 42.715429h305.883429c25.6 0 46.518857-19.236571 46.518857-42.715429 0-23.405714-20.918857-42.642286-46.592-42.642286z m-119.588572 420.278858H302.592c-25.6 0-46.592 19.236571-46.592 42.715428 0 23.405714 20.992 42.642286 46.592 42.642286h186.221714c25.6 0 46.592-19.236571 46.592-42.642286 0-23.478857-20.992-42.715429-46.592-42.715428zM675.108571 536.649143H302.592c-25.6 0-46.592 19.163429-46.592 42.642286 0 23.478857 20.992 42.642286 46.592 42.642285H675.108571c25.6 0 46.518857-19.163429 46.518858-42.642285 0-23.405714-20.918857-42.642286-46.518858-42.642286z m235.52 350.281143c0 21.284571-24.649143 44.470857-45.714285 44.470857H159.305143c-21.211429 0-45.056-23.186286-45.056-44.470857V215.332571c0-21.284571 23.844571-44.617143 45.056-44.617142H256.731429v37.741714c0 26.038857 21.138286 47.323429 46.957714 47.323428a47.323429 47.323429 0 0 0 47.030857-47.323428v-37.741714h324.022857v37.741714c0 26.038857 21.211429 47.323429 47.104 47.323428a47.323429 47.323429 0 0 0 46.957714-47.323428v-37.741714h96.036572c21.211429 0 45.714286 23.405714 45.714286 44.617142v671.597715zM855.552 78.262857h-86.674286V47.542857A47.323429 47.323429 0 0 0 721.92 0.073143a47.323429 47.323429 0 0 0-47.030857 47.323428v30.793143h-324.022857V47.542857a47.323429 47.323429 0 0 0-47.104-47.396571 47.323429 47.323429 0 0 0-46.957715 47.323428v30.793143H168.667429c-78.848 0-145.554286 67.145143-145.554286 146.578286v652.653714c0 79.36 66.706286 146.505143 145.554286 146.505143h686.811428c78.921143 0 145.554286-67.145143 145.554286-146.505143V224.841143c0-79.433143-66.633143-146.578286-145.554286-146.578286z"></path></svg><span>服务器日志</span></div></template>
    <div class="logs-body">
      <div class="logs-toolbar">
        <div class="log-level-filters">
          <el-button size="small" :type="logLevelFilter === '' ? 'primary' : 'default'" @click="logLevelFilter = ''">全部</el-button>
          <el-button size="small" :type="logLevelFilter === 'INFO' ? 'primary' : 'default'" @click="logLevelFilter = 'INFO'">INFO</el-button>
          <el-button size="small" :type="logLevelFilter === 'WARN' ? 'warning' : 'default'" @click="logLevelFilter = 'WARN'">WARN</el-button>
          <el-button size="small" :type="logLevelFilter === 'ERROR' ? 'danger' : 'default'" @click="logLevelFilter = 'ERROR'">ERROR</el-button>
        </div>
        <el-input v-model="logFilter" placeholder="过滤日志..." clearable size="small" style="width:180px" />
        <div style="margin-left:auto; display:flex; gap:12px">
          <el-button size="small" type="danger" @click="handleClearLogs">清除本地</el-button>
          <el-button size="small" @click="handleClearDisplay">清除显示</el-button>
        </div>
      </div>
      <div class="logs-list" ref="logsListRef" @scroll="onLogsScroll">
        <div v-if="logsLoading && logEntries.length === 0" class="logs-status">加载中...</div>
        <div v-else-if="filteredLogs.length === 0" class="logs-status">暂无日志</div>
        <template v-else>
          <div v-for="(entry, i) in filteredLogs" :key="i" class="log-entry">
            <span class="log-ts">{{ entry.timestamp }}</span>
            <span class="log-level" :class="'log-level-' + entry.level.toLowerCase()">{{ entry.level }}</span>
            <div class="log-msg">
              <template v-if="showSummary(entry)">
                <div class="log-summary">
                  <template v-if="showSummary(entry) && typeof showSummary(entry) === 'object'">
                    <span class="log-summary-op">{{ showSummary(entry).op }}</span><span class="log-prefix-transparent">&nbsp;</span>{{ showSummary(entry).text }}
                  </template>
                  <template v-else>{{ showSummary(entry) }}</template>
                </div>
                <div v-for="(f, j) in showFiles(entry)" :key="j" class="log-file">
                  <template v-if="typeof f === 'object' && 'name' in f">
                    <span class="log-prefix log-prefix-transparent">{{ f.prefix }}</span><span class="log-prefix log-prefix-transparent">&nbsp;</span><span class="log-name">{{ f.name }}</span><span v-if="f.pad" class="log-pad log-pad-hidden">{{ f.pad }}</span><template v-if="f.size">({{ f.size }})</template>
                  </template>
                  <template v-else-if="typeof f === 'object'">
                    <span class="log-prefix log-prefix-transparent">{{ f.prefix }}</span><span class="log-prefix log-prefix-transparent">&nbsp;</span><span class="log-text">{{ f.text }}</span>
                  </template>
                  <template v-else>{{ f }}</template>
                </div>
              </template>
              <template v-else>
                {{ (entry.message || '').trimStart() }}
              </template>
            </div>
          </div>
        </template>
      </div>
      <transition name="fade">
        <button
          v-if="showLogs && !logsAtBottom && filteredLogs.length > 0"
          class="scroll-bottom-btn"
          @click="scrollToBottom"
        >▼ 回到底部</button>
      </transition>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { fetchLogs, clearLogs, clearLogDisplay } from '../api'
import { showSummary, showFiles, logMatchesFilter } from '../utils/logFormat'

const showLogs = ref(false)
const logEntries = ref([])
const logsLoading = ref(false)
const logFilter = ref('')
const logLevelFilter = ref('')
const logsListRef = ref(null)
const logsAtBottom = ref(true)
let eventSource = null

const filteredLogs = computed(() => {
  let result = logEntries.value
  if (logLevelFilter.value) {
    result = result.filter(e => e.level === logLevelFilter.value)
  }
  if (logFilter.value) {
    const s = logFilter.value.toLowerCase()
    result = result.filter(e => logMatchesFilter(e, s))
  }
  return result
})

async function open() {
  showLogs.value = true
  logsAtBottom.value = true
  await loadLogs()
  startEventSource()
}

defineExpose({ open })

async function loadLogs() {
  logsLoading.value = true
  const wasAtBottom = logsAtBottom.value
  try {
    const res = await fetchLogs(500)
    logEntries.value = res.data || []
    await nextTick()
    if (wasAtBottom) scrollToBottom()
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
  if (el) el.scrollTop = el.scrollHeight
}

function startEventSource() {
  stopEventSource()
  eventSource = new EventSource('/api/logs/stream')
  eventSource.onmessage = (e) => {
    try {
      const entry = JSON.parse(e.data)
      logEntries.value.push(entry)
      if (logEntries.value.length > 1000) {
        logEntries.value = logEntries.value.slice(-1000)
      }
      if (logsAtBottom.value) nextTick(() => scrollToBottom())
    } catch { /* 忽略解析错误 */ }
  }
  eventSource.onerror = () => {
    // EventSource 自动重连
  }
}

function stopEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

async function handleClearDisplay() {
  try { await clearLogDisplay() } catch {}
  logEntries.value = []
}

async function handleClearLogs() {
  try {
    await ElMessageBox.confirm('确定清空所有日志？', '确认', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch { return }
  try {
    await clearLogs()
    logEntries.value = []
  } catch {}
}

function onLogsClose() {
  stopEventSource()
}
</script>

<style scoped>
.logs-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 60vh;
  position: relative;
}
.logs-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  flex-shrink: 0;
}
.logs-toolbar .el-button,
.logs-toolbar .el-input__inner {
  font-size: 12px !important;
  margin: 0 !important;
}
.log-level-filters {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}
.log-level-filters .el-button {
  margin: 0 !important;
}

.logs-list {
  flex: 1;
  overflow: auto;
  background: #1a1a2e;
  border-radius: 6px;
  padding: 8px 0;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.15;
}
.logs-list::-webkit-scrollbar { width: 6px; }
.logs-list::-webkit-scrollbar-track { background: transparent; }
.logs-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
.logs-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

.log-entry {
  display: flex;
  gap: 8px;
  padding: 1px 12px;
  white-space: pre-wrap;
  align-items: flex-start;
}
.log-entry:hover { background: rgba(255,255,255,0.05); }
.log-ts { color: #6b7280; flex-shrink: 0; width: 160px; }
.log-level { flex-shrink: 0; width: 52px; text-align: center; border-radius: 2px; font-size: 11px; font-weight: 600; }
.log-msg { color: #d1d5db; flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.25; }
.log-summary { line-height: 1.25; }

.log-level-info { color: #60a5fa; background: rgba(96,165,250,0.12); }
.log-level-warn { color: #fbbf24; background: rgba(251,191,36,0.12); }
.log-level-error { color: #f87171; background: rgba(248,113,113,0.12); }

.logs-status { color: #6b7280; text-align: center; padding: 24px; }

.scroll-bottom-btn {
  position: absolute;
  bottom: 12px;
  right: 12px;
  z-index: 10;
  padding: 6px 14px;
  border: none;
  border-radius: 20px;
  background: rgba(64, 158, 255, 0.9);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.scroll-bottom-btn:hover { background: #409eff; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
