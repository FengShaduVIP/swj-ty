<template>
  <div class="conn-ind" :class="`conn--${state}`" :aria-label="text">
    <span class="conn-dot" />
    <span class="conn-text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConnState } from '@/store'

const props = withDefaults(defineProps<{
  state: ConnState
  portPath?: string
  baudRate?: number
  /** 异常时附加信息，如「重试 2/3」 */
  detail?: string
}>(), {
  portPath: '',
  baudRate: 0,
  detail: '',
})

const text = computed(() => {
  switch (props.state) {
    case 'connected':
      return props.portPath
        ? `已连接 · ${props.portPath} · ${props.baudRate}`
        : '已连接'
    case 'connecting':
      return '正在连接…'
    case 'error':
      return props.detail ? `通信异常 · ${props.detail}` : '通信异常'
    default:
      return '未连接'
  }
})
</script>

<style scoped>
.conn-ind {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  position: relative;
}
.conn-text {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  letter-spacing: 0;
}

/* 已连接：稳定常亮 + 光晕（DESIGN 4.6） */
.conn--connected .conn-dot {
  background: var(--ok-bright);
  box-shadow: 0 0 0 3px rgba(62, 216, 138, 0.18);
}
.conn--connected .conn-text { color: var(--text-primary); }

/* 连接中：呼吸动画 */
.conn--connecting .conn-dot {
  background: var(--warning);
  animation: var(--anim-breathe);
}
.conn--connecting .conn-text { color: var(--warning); }

/* 通信异常：闪烁 + 外扩光环 */
.conn--error .conn-dot {
  background: var(--critical);
  animation: var(--anim-blink);
  box-shadow: 0 0 0 3px rgba(245, 84, 78, 0.20);
}
.conn--error .conn-text { color: var(--critical); }

/* 未连接：静态中性 */
.conn--disconnected .conn-dot {
  background: var(--neutral-state);
  box-shadow: 0 0 0 3px rgba(139, 152, 172, 0.15);
}
</style>
