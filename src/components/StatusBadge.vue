<template>
  <span class="badge" :class="`badge--${status}`">
    <!-- 图标通道（冗余编码，与颜色/文字并存） -->
    <svg v-if="showIcon" class="badge-ico" :viewBox="viewBox" aria-hidden="true">
      <path :d="iconPath" />
    </svg>
    <span class="badge-text"><slot>{{ label }}</slot></span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type BadgeStatus = 'critical' | 'warning' | 'info' | 'ok' | 'neutral' | 'brand'

const props = withDefaults(defineProps<{
  status?: BadgeStatus
  label?: string
  /** 用状态点代替图标（更紧凑） */
  dot?: boolean
}>(), {
  status: 'neutral',
  label: '',
  dot: false,
})

const showIcon = computed(() => props.status !== 'brand' && !props.dot)

// 图标形状：每个状态一种独特几何，确保色盲/灰度下仍可辨（DESIGN 2.5 冗余通道）
const ICONS: Record<Exclude<BadgeStatus, 'brand'>, { vb: string; d: string }> = {
  critical: { vb: '0 0 12 12', d: 'M3 3 L9 9 M9 3 L3 9' },                 // ✕
  warning:  { vb: '0 0 12 12', d: 'M6 2 L11 10 L1 10 Z M6 5 L6 8 M6 9.4 L6.1 9.4' }, // △ !
  info:     { vb: '0 0 12 12', d: 'M6 2 A4 4 0 1 0 6 10 A4 4 0 1 0 6 2 M6 5 L6 8 M6 9.4 L6.1 9.4' }, // ● i（圆+点）
  ok:       { vb: '0 0 12 12', d: 'M2.5 6.5 L5 9 L9.5 3.5' },              // ✓
  neutral:  { vb: '0 0 12 12', d: 'M6 2 A4 4 0 1 0 6 10 A4 4 0 1 0 6 2' }, // ○
}
const iconPath = computed(() => ICONS[props.status as Exclude<BadgeStatus, 'brand'>]?.d ?? '')
const viewBox = computed(() => ICONS[props.status as Exclude<BadgeStatus, 'brand'>]?.vb ?? '0 0 12 12')
</script>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 7px;
  border-radius: var(--radius-xs);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  line-height: 1;
  white-space: nowrap;
  border: 1px solid transparent;
}
.badge-ico {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  fill: none;
  stroke-width: 1.6;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.badge-text { letter-spacing: 0.01em; }

.badge--critical { background: var(--critical-bg); color: var(--critical); border-color: var(--critical-border); }
.badge--warning  { background: var(--warning-bg);  color: var(--warning);  border-color: var(--warning-border); }
.badge--info     { background: var(--info-bg);     color: var(--info);     border-color: var(--info-border); }
.badge--ok       { background: var(--ok-bg);       color: var(--ok);       border-color: rgba(47,191,113,0.4); }
.badge--neutral  { background: var(--neutral-bg);  color: var(--neutral-state); border-color: rgba(139,152,172,0.35); }
.badge--brand    { background: var(--brand-bg-subtle); color: var(--brand-text); border-color: var(--border-brand); }
</style>
