<script setup lang="ts">
import { onMounted, ref } from 'vue'

// 屏幕级通知窗内容：独立透明置顶小窗（固定屏幕右上角），只渲染一张通知卡片。
// 不自动关闭，必须点击关闭按钮；数据来自主进程（notify:data）。
const title = ref('')
const message = ref('')
const type = ref<'success' | 'warning'>('success')
const visible = ref(false)

function close() {
  visible.value = false
  window.notifyAPI?.close()
}

onMounted(() => {
  window.notifyAPI?.onShow?.((p) => {
    title.value = p.title
    message.value = p.message
    type.value = p.type === 'warning' ? 'warning' : 'success'
    visible.value = true
  })
})
</script>

<template>
  <div v-if="visible" class="toast" :class="'toast--' + type">
    <span class="toast-icon">{{ type === 'success' ? '✓' : '⚠' }}</span>
    <div class="toast-body">
      <div class="toast-title">{{ title }}</div>
      <div class="toast-msg" :title="message">{{ message }}</div>
      <div class="toast-actions">
        <button class="toast-btn" title="关闭通知" @click="close">关闭</button>
      </div>
    </div>
    <button class="toast-close" title="关闭通知" @click="close">✕</button>
  </div>
</template>

<style>
/* 通知窗透明底：盖掉全局样式的画布底色，卡片圆角外完全透明（透明区域鼠标点击穿透） */
html, body, #app {
  background: transparent !important;
  overflow: hidden;
}
</style>

<style scoped>
.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  margin: 6px;
  padding: var(--space-5) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  box-shadow: var(--elev-3);
  font-family: var(--font-sans);
  color: var(--text-primary);
  user-select: none;
  animation: toast-in var(--dur-base) var(--ease-out);
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.toast--success { border-color: var(--ok-border, var(--border-default)); }
.toast--warning { border-color: var(--warning-border); }

.toast-icon {
  flex: none;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
}
.toast--success .toast-icon {
  background: var(--ok-bg);
  color: var(--ok);
}
.toast--warning .toast-icon {
  background: var(--warning-bg);
  color: var(--warning);
}

.toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: 2px;
}

.toast-title {
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
}

.toast-msg {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 底部明确的「关闭」按钮（右上角 ✕ 之外的第二关闭入口） */
.toast-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.toast-btn {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  font-family: inherit;
  line-height: 1;
  padding: 5px 12px;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out), background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.toast-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
  border-color: var(--border-strong, var(--border-default));
}
.toast-btn:active { transform: scale(0.96); }

.toast-close {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.toast-close:active { transform: scale(0.9); }
.toast-close:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
</style>
