<template>
  <div class="metric-card" :class="[`mc--${status}`, { 'mc--hero': hero }]">
    <div class="mc-top">
      <span class="mc-label">{{ label }}</span>
      <span class="mc-top-right"><slot name="top-right" /></span>
    </div>
    <div class="mc-value">
      <span class="mc-num" :class="{ 'mc-num--na': na }">{{ display }}</span>
      <span v-if="unit && !na" class="mc-unit">{{ unit }}</span>
    </div>
    <div class="mc-sub">
      <slot name="sub">
        <span v-if="sub" class="mc-sub-text">{{ sub }}</span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type McStatus = 'normal' | 'ok' | 'warning' | 'critical'

const props = withDefaults(defineProps<{
  label: string
  /** 主数值（已格式化字符串） */
  value?: string | number | null
  unit?: string
  status?: McStatus
  sub?: string
  /** 巨型读数（总压 / SOC） */
  hero?: boolean
  /** 无数据时显 --（DESIGN 3.4） */
  na?: boolean
}>(), {
  value: null,
  unit: '',
  status: 'normal',
  sub: '',
  hero: false,
  na: false,
})

const display = computed(() => {
  if (props.na || props.value === null || props.value === undefined || props.value === '') return '--'
  return String(props.value)
})
</script>

<style scoped>
.metric-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-5) var(--space-5);
  overflow: hidden;
  /* 左侧 2px 状态色条（DESIGN 4.1） */
  box-shadow: inset 2px 0 0 var(--border-default);
}
.metric-card.mc--ok      { box-shadow: inset 2px 0 0 var(--ok); }
.metric-card.mc--warning { box-shadow: inset 2px 0 0 var(--warning); }
.metric-card.mc--critical {
  box-shadow: inset 2px 0 0 var(--critical);
  border-color: var(--critical-border);
}

.mc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 16px;
}
.mc-label {
  font-size: var(--fs-label);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  text-transform: uppercase;
}
.mc-top-right { display: inline-flex; align-items: center; }

.mc-value {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.mc-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  font-feature-settings: var(--font-numeric-features);
  font-size: var(--fs-num-lg);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  line-height: 1.1;
  letter-spacing: 0;
}
.mc-num--na { color: var(--text-disabled); }
.mc--hero .mc-num { font-size: var(--fs-num-hero); font-weight: var(--fw-bold); }

.mc-unit {
  font-size: var(--fs-micro);
  color: var(--text-secondary);
  font-family: var(--font-sans);
}
.mc--hero .mc-unit { font-size: var(--fs-caption); }

.mc-sub { margin-top: var(--space-3); }
.mc-sub-text {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
}
</style>
