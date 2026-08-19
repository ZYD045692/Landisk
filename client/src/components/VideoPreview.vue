<template>
  <div>
    <div class="video-wrap">
      <video
        ref="videoRef"
        controls
        autoplay
        playsinline
        preload="metadata"
        :src="videoUrl"
        class="preview-video"
        @error="onVideoError"
      ></video>
    </div>
    <el-alert
      v-if="videoError"
      type="warning"
      :title="videoError"
      :closable="false"
      show-icon
      class="preview-alert"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { apiUrl } from '../api'

const videoUrl = ref('')
const videoError = ref('')
const videoRef = ref(null)

/** 由 PreviewDialog 打开时调用（视频已挂载） */
function open(vpath) {
  videoUrl.value = `${apiUrl('/download')}?path=${encodeURIComponent(vpath)}&inline=1`
  videoError.value = ''
}

/** 弹窗关闭时释放视频资源 */
function onClose() {
  if (videoRef.value) {
    try { videoRef.value.pause() } catch {}
    videoRef.value.removeAttribute('src')
    videoRef.value.load?.()
  }
}

function onVideoError() {
  videoError.value = '该视频格式浏览器无法播放，请下载后观看'
}

defineExpose({ open, onClose })
</script>

<style scoped>
.video-wrap {
  display: flex;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}
.preview-video {
  width: 100%;
  max-height: 72vh;
  outline: none;
}
.preview-alert {
  margin-top: 12px;
}
</style>
