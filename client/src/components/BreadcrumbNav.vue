<template>
  <div class="breadcrumb-wrapper">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>
        <a href="#" @click.prevent="navigate('/')" :class="{ 'root-only': isRootOnly }">
          <el-icon><HomeFilled /></el-icon>
          <span class="breadcrumb-label">Home</span>
        </a>
      </el-breadcrumb-item>
      <el-breadcrumb-item v-for="(part, index) in pathParts" :key="index">
        <a
          v-if="index < pathParts.length - 1"
          href="#"
          @click.prevent="navigate(part.path)"
        >
          {{ part.name }}
        </a>
        <span v-else class="current-path">{{ part.name }}</span>
      </el-breadcrumb-item>
    </el-breadcrumb>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentPath: { type: String, default: '/' }
})

const emit = defineEmits(['navigate'])

const isRootOnly = computed(() => pathParts.value.length === 0)

const pathParts = computed(() => {
  const segments = props.currentPath.split('/').filter(Boolean)
  let accumulated = ''
  return segments.map(name => {
    accumulated += '/' + name
    return { name, path: accumulated }
  })
})

function navigate(path) {
  emit('navigate', path)
}
</script>

<style scoped>
.breadcrumb-wrapper {
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 12px;
  border: 1px solid #ebeef5;
  overflow-x: auto;
  white-space: nowrap;
  display: flex;
  align-items: center;
}

:deep(.el-breadcrumb__item) { vertical-align: middle; }

.breadcrumb-wrapper a,
.breadcrumb-wrapper .current-path {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
  font-size: 16px;
}

.breadcrumb-wrapper a {
  color: #409eff;
  text-decoration: none;
}

.breadcrumb-wrapper a:hover {
  color: #337ecc;
}

.current-path {
  color: #303133;
  font-weight: 500;
}

.breadcrumb-label {
  margin-left: 2px;
}

.root-only .breadcrumb-label {
  color: rgb(0, 0, 0);
  font-weight: 500;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .breadcrumb-wrapper {
    padding: 10px 12px;
    font-size: 14px;
  }
}
</style>
