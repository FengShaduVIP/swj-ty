<!--
  BatteryMeter — 垂直电池图标 + SOC 填充 + 中心百分比
  props:
    - soc: 0–100
    - status: 'ok' | 'warning' | 'critical' (default 'ok')
-->
<template>
  <div class="battery-meter" :class="['sbm', `sbm--${status}`]">
    <svg viewBox="0 0 60 110" class="sbm-svg" aria-hidden="true">
      <defs>
        <linearGradient :id="`sbm-grad-${uid}`" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="var(--data-soc)" stop-opacity="0.85" />
          <stop offset="100%" stop-color="var(--data-voltage)" stop-opacity="1" />
        </linearGradient>
      </defs>
      <!-- 电池外框 -->
      <rect class="sbm-shell" x="6" y="6" width="48" height="98" rx="6" ry="6" />
      <!-- 顶部凸起 -->
      <rect class="sbm-cap" x="22" y="0" width="16" height="6" rx="1.5" ry="1.5" />
      <!-- 内部填充（高度 = SOC% × 内高 92，自下而上） -->
      <clipPath :id="`sbm-clip-${uid}`">
        <rect x="9" y="9" width="42" height="92" rx="3" ry="3" />
      </clipPath>
      <rect
        :x="9"
        :y="101 - (Math.max(0, Math.min(100, soc)) / 100) * 92"
        width="42"
        :height="(Math.max(0, Math.min(100, soc)) / 100) * 92"
        :fill="`url(#sbm-grad-${uid})`"
        :clip-path="`url(#sbm-clip-${uid})`"
      />
      <!-- 内部细分线（4 段） -->
      <line v-for="i in 3" :key="i" :x1="9" :x2="51" :y1="9 + (i * 23)" :y2="9 + (i * 23)" class="sbm-tick" />
    </svg>
    <div class="sbm-label">
      <span class="sbm-num">{{ Math.round(Math.max(0, Math.min(100, soc))) }}</span>
      <span class="sbm-percent">%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ soc: number; status?: 'ok' | 'warning' | 'critical' }>()
// 用随机/固定 id 区分同一页面多次引用时 SVG <defs> 重复
const uid = Math.random().toString(36).slice(2, 8)
</script>

<style scoped>
.battery-meter {
  position: relative;
  width: 80px;
  height: 120px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sbm-svg { width: 100%; height: 100%; }
.sbm-shell {
  fill: none;
  stroke: var(--info);
  stroke-width: 2;
}
.sbm-cap { fill: var(--info); }
.sbm-tick {
  stroke: var(--border-default);
  stroke-width: 0.5;
  opacity: 0.6;
}
.sbm--warning .sbm-shell { stroke: var(--warning); }
.sbm--warning .sbm-cap   { fill: var(--warning); }
.sbm--critical .sbm-shell { stroke: var(--critical); }
.sbm--critical .sbm-cap   { fill: var(--critical); }
.sbm-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}
.sbm-num {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
.sbm-percent {
  font-size: 14px;
  font-weight: var(--fw-semibold);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
  margin-top: 2px;
}
</style>
