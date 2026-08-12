<template>
  <div class="datalog-panel">
    <div class="datalog-header">
      <h3 class="datalog-title">
        <el-icon><List /></el-icon>
        通信日志
      </h3>
      <div class="datalog-actions">
        <el-switch v-model="autoScroll" size="small" active-text="自动滚动" />
        <el-button text size="small" @click="$emit('clear')">清空</el-button>
      </div>
    </div>

    <div class="log-container" ref="logContainer">
      <div v-if="logs.length === 0" class="log-empty">
        <el-icon :size="32" color="var(--text-tertiary)"><Document /></el-icon>
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
    send: '发送', recv: '接收', error: '错误', info: '信息',
  }
  return map[type] || type
}

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
  })
}
watch(() => props.logs.length, () => { if (autoScroll.value) scrollToBottom() })
</script>

<style scoped>
.datalog-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  overflow: hidden;
  min-height: 0;
}

.datalog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-default);
}
.datalog-title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.datalog-title .el-icon { color: var(--brand); }
.datalog-actions { display: flex; align-items: center; gap: var(--space-4); }

.log-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-5) var(--space-4);
  font-size: var(--fs-body-sm);
}

.log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: var(--space-4);
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  line-height: 1.6;
}
.log-entry:last-child { border-bottom: none; }

.log-time {
  color: var(--text-tertiary);
  font-size: var(--fs-num-xs);
  white-space: nowrap;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  min-width: 84px;
  padding-top: 2px;
}

.log-tag {
  display: inline-block;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  min-width: 32px;
  text-align: center;
  white-space: nowrap;
  line-height: 18px;
  flex-shrink: 0;
}
.log-send .log-tag  { background: var(--brand-bg-subtle); color: var(--brand-text); }
.log-recv .log-tag  { background: var(--ok-bg);           color: var(--ok); }
.log-error .log-tag { background: var(--critical-bg);     color: var(--critical); }
.log-info .log-tag  { background: var(--neutral-bg);      color: var(--neutral-state); }

.log-content { color: var(--text-secondary); word-break: break-all; }
.log-error .log-content { color: var(--critical); }
</style>
