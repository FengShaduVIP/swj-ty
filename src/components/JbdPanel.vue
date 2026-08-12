<!--
  JbdPanel — 实时监测（只读）
  布局严格对齐参考图：
    左列：电池概览（图标 + 7 项读数 + 保护/均衡状态）+ 保护事件表
    右列：单体电压栅格（4×6，24 cell）+ 温度（圆环 + 温度条）
-->
<template>
  <div class="jbd-panel monitor">
    <!-- ===== 顶部工具栏 ===== -->
    <div class="vp-toolbar">
      <el-checkbox v-model="autoPollProxy" @change="onPollChange">自动轮询 (2s)</el-checkbox>
      <el-checkbox v-model="readProtectOnPoll" @change="scheduleProtectRead" />
      <span class="vp-meta">同步保护事件</span>
      <span class="vp-spacer" />
      <span class="vp-meta num" v-if="lastPoll">{{ lastPoll }} 已拉取</span>
      <el-button @click="refreshAll" :icon="Refresh">读取全部</el-button>
    </div>

    <!-- ===== 双列主内容 ===== -->
    <div class="monitor-grid">
      <!-- ============== 左列 ============== -->
      <div class="col">
        <!-- 电池概览卡 -->
        <section class="sec battery-sec">
          <div class="battery-row">
            <BatteryMeter :soc="rsoc" :status="socStatus" />
            <div class="battery-info">
              <div class="info-grid">
                <div class="kv">
                  <span class="kv-label">总电压</span>
                  <span class="kv-num">
                    <span class="num">{{ fmt(totalV, 2) }}</span>
                    <span class="kv-unit">V</span>
                  </span>
                </div>
                <div class="kv">
                  <span class="kv-label">循环次数</span>
                  <span class="kv-num">
                    <span class="num">{{ cycleCount }}</span>
                    <span class="kv-unit">次</span>
                  </span>
                </div>
                <div class="kv">
                  <span class="kv-label">电流</span>
                  <span class="kv-num" :class="{ 'kv--neg': currentA < 0 }">
                    <span class="num">{{ fmt(currentA, 2) }}</span>
                    <span class="kv-unit">A</span>
                  </span>
                </div>
                <div class="kv">
                  <span class="kv-label">剩余容量</span>
                  <span class="kv-num">
                    <span class="num">{{ fmt(remainAh, 2) }}</span>
                    <span class="kv-unit">AH</span>
                  </span>
                </div>
                <div class="kv">
                  <span class="kv-label">负载功率</span>
                  <span class="kv-num">
                    <span class="num">{{ fmt(powerW, 2) }}</span>
                    <span class="kv-unit">W</span>
                  </span>
                </div>
                <div class="kv kv--empty" />
                <div class="kv kv--toggle">
                  <span class="kv-label">充电开关</span>
                  <el-switch :model-value="chargeSwitch" disabled size="default" />
                </div>
                <div class="kv kv--toggle">
                  <span class="kv-label">放电开关</span>
                  <el-switch :model-value="dischargeSwitch" disabled size="default" />
                </div>
              </div>
            </div>
          </div>
          <div class="battery-foot">
            <div class="bf-item bf-item--stack">
              <div class="bf-label-row">
                <span class="bf-label">保护状态</span>
                <span :class="['bf-val', allNormal ? 'state--ok' : 'state--critical']">
                  {{ allNormal ? '系统正常' : `${activeProtects.length + activeAlarms.length} 条触发` }}
                </span>
              </div>
              <div v-if="allNormal" class="bf-empty">无保护 / 告警事件</div>
              <div v-else class="chip-row">
                <span
                  v-for="p in activeProtects"
                  :key="`p-${p}`"
                  class="evt-chip evt-chip--crit"
                  :title="`protectStatus bit`"
                >{{ p }}</span>
                <span
                  v-for="a in activeAlarms"
                  :key="`a-${a}`"
                  class="evt-chip evt-chip--warn"
                  :title="`alarmStatus bit`"
                >{{ a }}</span>
              </div>
            </div>
            <div class="bf-item bf-item--inline">
              <span class="bf-label">均衡状态：</span>
              <span :class="['bf-val', balanceClass]">{{ balanceText }}</span>
            </div>
          </div>
        </section>

        <!-- 设备信息 -->
        <section class="sec dev-sec">
          <header class="sec-head">
            <h3 class="sec-title">设备信息</h3>
          </header>
          <div class="dev-grid">
            <div class="kv">
              <span class="kv-label">芯片类型</span>
              <span class="kv-val mono">{{ chipTypeName }}</span>
            </div>
            <div class="kv">
              <span class="kv-label">硬件版本</span>
              <span class="kv-val mono">{{ hwVersion || '—' }}</span>
            </div>
          </div>
        </section>

        <!-- 保护事件表 -->
        <section class="sec events-sec">
          <header class="sec-head">
            <h3 class="sec-title">保护事件次数</h3>
            <button class="refresh-mini" :title="protecting ? '点击刷新' : '拉取保护事件'" @click="readProtect">
              <svg viewBox="0 0 12 12"><path d="M2 6a4 4 0 1 1 1.2 2.83M3 9 2 6 5 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </header>
          <div class="events-grid">
            <div v-for="e in protectList" :key="e.key" class="evt-row">
              <span class="evt-name">{{ e.label }}</span>
              <span class="evt-count">
                <span class="num">{{ e.count ?? '-' }}</span>
                <span class="evt-unit">次</span>
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- ============== 右列 ============== -->
      <div class="col">
        <!-- 单体电压 -->
        <section class="sec cells-sec">
          <header class="sec-head">
            <h3 class="sec-title">单体电压</h3>
            <div class="cells-legend">
              <span class="leg"><i class="leg-dot leg-dot--eq" />均衡</span>
              <span class="leg-meta">压差 <span class="num">{{ fmt(pressureDiff, 0) }}</span> mV</span>
              <span class="leg"><i class="leg-dot leg-dot--max" />最高</span>
              <span class="leg"><i class="leg-dot leg-dot--min" />最低</span>
            </div>
          </header>
          <div class="cells-grid">
            <div
              v-for="(v, i) in cellVoltages"
              :key="i"
              :class="['cell-box', cellClass(v, i)]"
            >
              <span class="cell-num">{{ pad(i + 1) }}</span>
              <span class="cell-v num">{{ fmt(v / 1000, 3) }}<span class="cell-unit">V</span></span>
            </div>
          </div>
        </section>

        <!-- 温度 -->
        <section class="sec temp-sec">
          <h3 class="sec-title">温度</h3>
          <div class="temp-body">
            <DonutTemp :value="mosTemp" label="MOS" />
            <div class="temp-bars">
              <div v-for="(t, i) in temperatures" :key="i" class="temp-bar" :class="tempBarClass(t)">
                <span class="tb-name">温度{{ i + 1 }}</span>
                <div class="tb-track">
                  <div class="tb-fill" :style="{ width: tempPct(t) + '%' }" />
                </div>
                <span class="tb-val">
                  <span class="num">{{ Number.isFinite(t) ? t.toFixed(1) : '--' }}</span>
                  <span class="tb-unit">℃</span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { useJbd } from '@/jbd/useJbd'
import BatteryMeter from './BatteryMeter.vue'
import DonutTemp from './DonutTemp.vue'

const j = useJbd()
const {
  connected, basicInfo, cellVoltages, protectList, cellMax, cellMin,
  maxTemp, socStatus, tempStatus, autoPollProxy, cellClass, fmt, pad,
  chipTypeName, hwVersion,
  activeProtects, activeAlarms,
  readBasic, readCells, readProtect, readChip, readHw,
} = j

// ===== 派生读数 =====
const totalV   = computed(() => basicInfo.value ? basicInfo.value.totalVoltage_mV / 1000 : NaN)
const currentA = computed(() => basicInfo.value ? basicInfo.value.current_mA / 1000 : NaN)
const remainAh = computed(() => basicInfo.value ? basicInfo.value.remainingCapacity_mAh / 1000 : NaN)
const cycleCount = computed(() => basicInfo.value?.cycleCount ?? 0)
const powerW   = computed(() => (Number.isFinite(totalV.value) && Number.isFinite(currentA.value)) ? totalV.value * currentA.value : NaN)
const rsoc     = computed(() => basicInfo.value?.rsoc ?? 0)
const chargeSwitch    = computed(() => basicInfo.value?.fet.charge ?? false)
const dischargeSwitch = computed(() => basicInfo.value?.fet.discharge ?? false)
const temperatures    = computed(() => basicInfo.value?.temperatures_C ?? [])
// MOS 默认取第一个 NTC（典型布局）；若没有 NTC 则回退到 maxTemp
const mosTemp = computed(() => {
  const t = temperatures.value
  if (!t.length) return maxTemp.value
  return t[0]
})
const protecting      = computed(() => !!(activeProtects.value.length + activeAlarms.value.length))
const pressureDiff    = computed(() => cellMax.value && cellMin.value ? cellMax.value - cellMin.value : 0)

// 保护 / 告警 / 均衡整体状态：全空 → 正常；任一存在 → 异常
const allNormal      = computed(() => !activeProtects.value.length && !activeAlarms.value.length)
const balanceText = computed(() => {
  const b = basicInfo.value
  if (!b) return '未启动'
  return (b.balanceLow || b.balanceHigh) ? '启动中' : '未启动'
})
const balanceClass = computed(() => {
  const b = basicInfo.value
  return (b && (b.balanceLow || b.balanceHigh)) ? 'state--info' : 'state--neutral'
})

// ===== 温度条 =====
const TEMP_MIN = -10
const TEMP_MAX = 80
function tempPct(t: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.min(100, ((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100))
}
function tempBarClass(t: number): string {
  if (!Number.isFinite(t)) return 'tb--na'
  if (t > 55) return 'tb--crit'
  if (t > 45) return 'tb--warn'
  return 'tb--ok'
}

// ===== 自动轮询（沿用 store 单例 interval）=====
j.onPollChange(false) // 默认未开启
function onPollChange(v: boolean | string | number) {
  j.onPollChange(!!v)
}

// 附加：自动轮询开启时，同步拉取保护事件（最多每 5s 一次）
const readProtectOnPoll = ref(true)
let protTimer: number | null = null
function scheduleProtectRead() {
  if (protTimer) { clearInterval(protTimer); protTimer = null }
  if (autoPollProxy.value && readProtectOnPoll.value) {
    protTimer = window.setInterval(() => {
      if (!connected.value) return
      readProtect()
    }, 5000)
  }
}
watch(autoPollProxy, scheduleProtectRead)

// ===== 全部读取 =====
const lastPoll = ref('')
function refreshAll() {
  if (!connected.value) return
  readBasic(); readCells(); readProtect()
  readChip(); readHw()
  const now = new Date()
  lastPoll.value = now.toLocaleTimeString('zh-CN', { hour12: false })
}

// 启动时拉一帧（连接好的话）；挂载/卸载接管 interval 监听
const now = new Date()
let mountedAt = ''
mountedAt = now.toLocaleTimeString('zh-CN', { hour12: false })
function onConnChange() {
  if (connected.value) refreshAll()
}
let connWatcher: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  refreshAll()
  connWatcher = setInterval(onConnChange, 1500)
})
onUnmounted(() => {
  j.onPollChange(false)
  if (connWatcher) clearInterval(connWatcher)
  if (protTimer) clearInterval(protTimer)
})
</script>

<style scoped>
.jbd-panel {
  padding: var(--space-6);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.app-compact .jbd-panel { gap: var(--space-4); }

/* ---------- 顶部工具栏 ---------- */
.vp-toolbar {
  display: flex; align-items: center; gap: var(--space-4);
  height: 36px;
  flex-shrink: 0;
}
.vp-meta { font-size: var(--fs-caption); color: var(--text-tertiary); }
.vp-spacer { flex: 1; }
.vp-toolbar :deep(.el-checkbox) { color: var(--text-secondary); }

/* ---------- 双列布局 ---------- */
.monitor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-5);
}
@media (max-width: 1100px) {
  .monitor-grid { grid-template-columns: 1fr; }
}
.col { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }

/* ---------- 通用 sec ---------- */
.sec {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}
.sec-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: var(--space-4);
}
.sec-title {
  position: relative;
  padding-left: 10px;
  margin: 0;
  font-size: var(--fs-title);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.sec-title::before {
  content: '';
  position: absolute; left: 0; top: 4px; bottom: 4px;
  width: 3px; border-radius: 2px;
  background: var(--info);
}

/* ============ 电池概览 ============ */
.battery-sec { padding: var(--space-5); }
.battery-row {
  display: flex; align-items: stretch; gap: var(--space-5);
}
.battery-info { flex: 1; min-width: 0; }

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: auto;
  row-gap: var(--space-4);
  column-gap: var(--space-6);
}
.kv {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3);
  border-bottom: 1px dashed var(--border-subtle);
  padding-bottom: 6px;
}
.kv--empty { visibility: hidden; }
.kv--toggle { gap: var(--space-2); }

.kv-label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}
.kv-num {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums slashed-zero;
  color: var(--text-primary);
  display: inline-flex; align-items: baseline; gap: 2px;
}
.kv-unit {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-left: 2px;
}
.kv--neg .num { color: var(--data-temp); }

/* 底部保护 / 均衡状态行 */
.battery-foot {
  display: flex; align-items: flex-start; gap: var(--space-8);
  padding-top: var(--space-4);
  margin-top: var(--space-4);
  border-top: 1px dashed var(--border-subtle);
  flex-wrap: wrap;
}
.bf-item { display: flex; align-items: center; gap: 4px; font-size: var(--fs-caption); color: var(--text-secondary); }
.bf-item--stack  { flex-direction: column; align-items: flex-start; gap: 4px; flex: 1 1 360px; min-width: 0; }
.bf-item--inline { flex: 0 0 auto; }
.bf-label        { color: var(--text-tertiary); }
.bf-label-row    { display: flex; align-items: center; gap: var(--space-3); }
.bf-val          { font-family: var(--font-mono); font-weight: var(--fw-semibold); }
.bf-empty        { font-size: var(--fs-caption); color: var(--text-tertiary); }
.state--ok      { color: var(--ok); }
.state--warning { color: var(--warning); }
.state--critical{ color: var(--critical); }
.state--info    { color: var(--info); }
.state--neutral { color: var(--text-tertiary); }

/* 保护 / 告警 chip 列表（电池底部状态） */
.chip-row    { display: flex; flex-wrap: wrap; gap: 4px; }
.evt-chip    {
  display: inline-flex; align-items: center;
  height: 18px; padding: 0 6px;
  font-size: var(--fs-micro); line-height: 1;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  white-space: nowrap;
}
.evt-chip--crit {
  color: var(--critical);
  background: var(--critical-bg);
  border-color: var(--critical-border);
}
.evt-chip--warn {
  color: var(--warning);
  background: var(--warning-bg);
  border-color: var(--warning-border);
}

/* ============ 设备信息 ============ */
.dev-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  row-gap: var(--space-4);
  column-gap: var(--space-6);
}
.kv-val {
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  text-align: right;
  word-break: break-all;
}

/* 刷新小按钮 */
.refresh-mini {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  cursor: pointer;
}
.refresh-mini:hover { background: var(--bg-hover); color: var(--info); border-color: var(--info); }
.refresh-mini svg { width: 12px; height: 12px; }

/* ============ 保护事件 ============ */
.events-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.evt-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  font-size: var(--fs-body-sm);
}
.evt-row:nth-child(2n) { border-right: none; }
.evt-row:nth-last-child(-n+2) { border-bottom: none; }    /* 倒数 2 行移除底边 */
.evt-row:nth-last-child(2):nth-child(odd) {
  /* 最后一行仅 1 项（11 个），用 ::after 占位隐藏 */
}
.evt-row:nth-child(11) { /* 短路次数单独一行左侧 */ }
.evt-name { color: var(--text-secondary); }
.evt-count {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.evt-unit { font-size: var(--fs-caption); color: var(--text-tertiary); margin-left: 4px; }

/* ============ 单体电压 ============ */
.cells-legend {
  display: flex; align-items: center; gap: var(--space-4);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.leg, .leg-meta { display: inline-flex; align-items: center; gap: 6px; }
.leg-meta { color: var(--text-tertiary); }
.leg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.leg-dot--eq  { background: var(--ok); }
.leg-dot--max { background: var(--data-voltage); }
.leg-dot--min { background: var(--data-current); opacity: 0.7; }

.cells-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.cell-box {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3);
  padding: 8px var(--space-3);
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption);
  min-height: 32px;
}
.cell-num { color: var(--text-tertiary); font-size: var(--fs-micro); }
.cell-v {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  display: inline-flex; align-items: baseline;
}
.cell-unit { color: var(--text-tertiary); margin-left: 2px; font-size: var(--fs-micro); }

.cell--max  { border-color: var(--data-voltage); background: color-mix(in srgb, var(--data-voltage) 14%, transparent); }
.cell--min  { border-color: var(--data-current); background: color-mix(in srgb, var(--data-current) 10%, transparent); }
.cell--crit { border-color: var(--critical); background: var(--critical-bg); color: var(--critical); }
.cell--warn { border-color: var(--warning); background: var(--warning-bg); }
.cell--eq   { box-shadow: inset 0 0 0 1px var(--ok); border-color: color-mix(in srgb, var(--ok) 60%, var(--border-default)); }

/* ============ 温度 ============ */
.temp-body {
  display: flex; align-items: center; gap: var(--space-6);
}
.temp-bars {
  flex: 1;
  display: flex; flex-direction: column; gap: var(--space-5);
}
.temp-bar {
  display: flex; align-items: center; gap: var(--space-4);
}
.tb-name {
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
  width: 56px;
  flex-shrink: 0;
}
.tb-track {
  flex: 1;
  height: 8px;
  background: var(--bg-inset);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.tb-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--data-voltage), var(--data-current));
  border-radius: 4px;
  transition: width 600ms var(--ease-standard);
}
.tb-val {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  display: inline-flex; align-items: baseline;
  min-width: 64px; justify-content: flex-end;
}
.tb-unit { color: var(--text-tertiary); margin-left: 2px; font-size: var(--fs-caption); }

.tb--warn .tb-fill { background: linear-gradient(90deg, var(--warning), var(--data-temp)); }
.tb--crit .tb-fill { background: linear-gradient(90deg, var(--critical), var(--data-temp)); }
</style>
