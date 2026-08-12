<!--
  DonutTemp — SVG 圆环温度计
  props:
    - value: 温度（℃）
    - label: 中心副标题（默认 'MOS'）
  映射温度区间 -10℃ ~ 80℃ 到 0 ~ 360°
-->
<template>
  <div class="donut-temp">
    <svg viewBox="0 0 100 100" class="dn-svg" aria-hidden="true">
      <!-- 轨道 -->
      <circle class="dn-track" cx="50" cy="50" r="40" />
      <!-- 进度（旋转 -90° 让起点在 12 点钟方向） -->
      <circle
        class="dn-arc"
        cx="50" cy="50" r="40"
        :stroke-dasharray="`${arcLen} ${CIRC}`"
        transform="rotate(-90 50 50)"
      />
    </svg>
    <div class="dn-center">
      <div class="dn-val num">{{ fmtValue(value) }}<span class="dn-unit">℃</span></div>
      <div class="dn-divider" />
      <div class="dn-label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ value: number; label?: string }>(), { label: 'MOS' })

const TEMP_MIN = -10
const TEMP_MAX = 80
const R = 40
const CIRC = 2 * Math.PI * R

const pct = computed(() =>
  Number.isFinite(props.value)
    ? Math.max(0, Math.min(1, (props.value - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
    : 0,
)
const arcLen = computed(() => CIRC * pct.value)

function fmtValue(v: number) {
  return Number.isFinite(v) ? v.toFixed(1) : '--'
}
</script>

<style scoped>
.donut-temp {
  position: relative;
  width: 132px;
  height: 132px;
  flex-shrink: 0;
}
.dn-svg { width: 100%; height: 100%; display: block; }
.dn-track {
  fill: none;
  stroke: var(--bg-inset);
  stroke-width: 9;
}
.dn-arc {
  fill: none;
  stroke: var(--data-temp);
  stroke-width: 9;
  stroke-linecap: round;
  transition: stroke-dasharray 600ms var(--ease-standard);
}
.dn-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}
.dn-val {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: var(--fw-bold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  display: inline-flex;
  align-items: baseline;
}
.dn-unit {
  font-size: 14px;
  color: var(--text-secondary);
  margin-left: 2px;
}
.dn-divider {
  width: 18px;
  height: 1px;
  background: var(--border-default);
  margin: 4px 0;
}
.dn-label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
