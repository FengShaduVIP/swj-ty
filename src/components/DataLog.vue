<template>
  <div class="datalog-panel">
    <div class="datalog-header">
      <h3 class="datalog-title">
        <el-icon><List /></el-icon>
        通信日志
      </h3>
      <div class="datalog-actions">
        <el-switch
          v-model="autoScroll"
          size="small"
          active-text="自动滚动"
        />
        <el-button text size="small" @click="$emit('clear')">清空</el-button>
      </div>
    </div>

    <div class="log-container" ref="logContainer">
      <div v-if="logs.length === 0" class="log-empty">
        <el-icon :size="32" color="#3a3e44"><Document /></el-icon>
        <span>暂无通信日志</span>
      </div>

      <div
        v-for="(log, idx) in logs"
        :key="idx"
        class="log-entry"
        :class="'log-' + log.type"
      >
        <span class="log-time">{{ log.time }}</span>
        <span class="log-tag">{{ tagLabel(log.type) }}</span>
        <span class="log-content mono-font">{{ log.content }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { List, Document } from '@element-plus/icons-vue'

interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  content: string
}

const props = defineProps<{ logs: LogEntry[] }>()
defineEmits<{ clear: [] }>()

const autoScroll = ref(true)
const logContainer = ref<HTMLElement>()

function tagLabel(type: string) {
  const map: Record<string, string> = {
    send: '发送',
    recv: '接收',
    error: '错误',
    info: '信息'
  }
  return map[type] || type
}

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

// 当日志变化时自动滚动
watch(() => props.logs.length, () => {
  if (autoScroll.value) {
    scrollToBottom()
  }
})
</script>

<style scoped>
.datalog-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #2a2e34;
  overflow: hidden;
  min-height: 0;
}

.datalog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  flex-shrink: 0;
}

.datalog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #f0f1f2;
}

.datalog-title .el-icon {
  color: #00BFA5;
}

.datalog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 8px;
  font-size: 12px;
}

.log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #4a4e54;
  gap: 8px;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid #1a1e24;
  line-height: 1.6;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #5a5e64;
  font-size: 11px;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  min-width: 80px;
}

.log-tag {
  display: inline-block;
  padding: 0 5px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 600;
  min-width: 30px;
  text-align: center;
  white-space: nowrap;
  line-height: 18px;
}

.log-send .log-tag {
  background: rgba(26, 115, 232, 0.2);
  color: #4a9eff;
}

.log-recv .log-tag {
  background: rgba(0, 191, 165, 0.2);
  color: #00BFA5;
}

.log-error .log-tag {
  background: rgba(245, 108, 108, 0.2);
  color: #f56c6c;
}

.log-info .log-tag {
  background: rgba(144, 147, 153, 0.2);
  color: #909399;
}

.log-content {
  color: #c0c4ca;
  word-break: break-all;
}
</style>
