<!--
  LogFloat — 通讯日志浮窗（替代原底部抽屉，2026-11-19）
  可拖拽（标题栏空白处按住）、可缩放（右下角手柄），默认停靠主窗口右侧贴边；
  窗口 resize 时自动夹回视口内；新日志到达自动滚到底。
-->
<template>
  <div class="logfloat" :style="panelStyle">
    <div class="lf-hd" @pointerdown="onDragStart">
      <span class="t">通讯日志</span>
      <span class="lf-chip num">{{ logs.length }} / {{ maxLines }}</span>
      <div class="sp" />
      <button class="lf-btn" @click="emit('clear')">清空</button>
      <button class="lf-btn" @click="emit('close')">关闭</button>
    </div>
    <div class="lf-logbox" ref="logboxEl">
      <div v-for="l in logs" :key="l.id" class="logline" :class="logCls(l.type)">
        <span class="tm num">{{ l.time }}</span>
        <span class="tag">{{ tagText(l.type) }}</span>
        <span class="tx2 num-l">{{ l.content }}</span>
      </div>
    </div>
    <div class="lf-df">TX 蓝色 · RX 绿色 · 错误红色 · 最多保留 {{ maxLines }} 条，超出丢弃最旧</div>
    <div class="rz" title="拖拽调整大小" @pointerdown="onResizeStart" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { LogEntry } from '@/store'

const props = defineProps<{
  logs: LogEntry[]
  maxLines: number
}>()
const emit = defineEmits<{ close: []; clear: [] }>()

// ===== 位置与尺寸（默认停靠主窗口右侧贴边：工具栏下沿 ~ 状态栏上沿） =====
const MIN_W = 320
const MIN_H = 180
const x = ref(0)
const y = ref(0)
const w = ref(420)
const h = ref(400)

function clampPos() {
  x.value = Math.min(Math.max(x.value, 8 - w.value), window.innerWidth - 60)
  x.value = Math.max(x.value, 8)
  y.value = Math.min(Math.max(y.value, 8), window.innerHeight - 60)
}
function fitDefault() {
  w.value = Math.min(460, Math.max(MIN_W, window.innerWidth - 220))
  h.value = Math.max(MIN_H, window.innerHeight - 56 - 36)
  x.value = window.innerWidth - w.value
  y.value = 56
}
onMounted(() => {
  fitDefault()
  window.addEventListener('resize', onWinResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointermove', onResizeMove)
})
function onWinResize() {
  w.value = Math.min(w.value, window.innerWidth - 16)
  h.value = Math.min(h.value, window.innerHeight - 16)
  clampPos()
}
const panelStyle = computed(() => ({
  left: x.value + 'px',
  top: y.value + 'px',
  width: w.value + 'px',
  height: h.value + 'px',
}))

// ===== 拖拽移动（标题栏；点在按钮上不触发） =====
let dragX = 0
let dragY = 0
function onDragStart(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  dragX = e.clientX - x.value
  dragY = e.clientY - y.value
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
}
function onDragMove(e: PointerEvent) {
  x.value = e.clientX - dragX
  y.value = e.clientY - dragY
  clampPos()
}
function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove)
}

// ===== 右下角手柄缩放 =====
let rzW = 0
let rzH = 0
function onResizeStart(e: PointerEvent) {
  e.preventDefault()
  rzW = w.value - e.clientX
  rzH = h.value - e.clientY
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd, { once: true })
}
function onResizeMove(e: PointerEvent) {
  w.value = Math.min(Math.max(rzW + e.clientX, MIN_W), window.innerWidth - x.value)
  h.value = Math.min(Math.max(rzH + e.clientY, MIN_H), window.innerHeight - y.value)
}
function onResizeEnd() {
  window.removeEventListener('pointermove', onResizeMove)
}

// ===== 新日志自动滚到底 =====
const logboxEl = ref<HTMLElement | null>(null)
watch(() => props.logs.length, async () => {
  await nextTick()
  if (logboxEl.value) logboxEl.value.scrollTop = logboxEl.value.scrollHeight
})

function tagText(type: LogEntry['type']): string {
  return { send: 'TX', recv: 'RX', error: 'ER', info: 'IN' }[type]
}
function logCls(type: LogEntry['type']): string {
  return type === 'send' ? 'tx' : type === 'recv' ? 'rx' : type === 'error' ? 'er' : ''
}
</script>

<style scoped>
.logfloat {
  position: fixed;
  z-index: var(--z-drawer);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ===== 标题栏（拖拽把手） ===== */
.lf-hd {
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
  touch-action: none;
}
.lf-hd .t { font-weight: 700; font-size: 13px; color: var(--t1); }
.lf-hd .sp { flex: 1; }
.lf-chip {
  background: var(--inset);
  color: var(--t2);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
.lf-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--t2);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.lf-btn:hover { color: var(--t1); border-color: var(--border-strong); }

/* ===== 日志内容区 ===== */
.lf-logbox {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.9;
  background: var(--inset);
}
.logline { display: flex; gap: 8px; white-space: nowrap; }
.logline .tm { color: var(--t3); flex: 0 0 74px; text-align: left; }
.logline .tag { flex: 0 0 26px; font-weight: 700; color: var(--t3); }
.tx2 { overflow: hidden; text-overflow: ellipsis; }
.logline.tx .tag { color: var(--brand); }
.logline.rx .tag { color: var(--ok); }
.logline.er .tag { color: var(--err); }
.logline.tx .tx2 { color: var(--t2); }
.logline.rx .tx2 { color: var(--t1); }
.logline.er .tx2 { color: var(--err); }

/* ===== 底部图例 ===== */
.lf-df {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  color: var(--t3);
  font-size: 11px;
}

/* ===== 右下角缩放手柄 ===== */
.rz {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
}
.rz::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--border-strong);
  border-bottom: 2px solid var(--border-strong);
  border-radius: 2px;
}
.rz:hover::after { border-color: var(--brand); }
</style>
