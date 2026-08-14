<template>
  <div class="tianyi-panel">
    <!-- 顶部子标题栏 -->
    <div class="tp-header">
      <div class="tp-title">
        <span class="tp-dot" :class="{ ok: connected && !commFault, fault: commFault }"></span>
        <span class="tp-name">天一 BMS 实时监测</span>
        <span class="tp-chip">Modbus-RTU · 从机 0x{{ slaveAddr.toString(16).padStart(2, '0').toUpperCase() }}</span>
      </div>
      <div class="tp-meta">
        <span class="tp-link" :class="{ ok: connected && !commFault }">
          {{ connected ? (commFault ? '通讯故障' : '已连接') : '未连接' }}
        </span>
        <span class="tp-poll">轮询 1.5s</span>
        <span class="tp-time num">更新 {{ lastUpdateAt }}</span>
      </div>
    </div>

    <!-- 第一行：SOC + 指标 + 趋势 -->
    <div class="tp-dashboard">
      <!-- SOC 大电池 -->
      <div class="card soc-card">
        <div class="card-h">
          <span class="card-title">电量 SOC</span>
          <span class="card-hint">A000 · 由 Status1 解析状态</span>
        </div>
        <div class="soc-body">
          <div class="battery-shell" :class="{ charging: isCharging, discharging: isDischarging }">
            <div class="battery-fill" :style="{ height: socPercent + '%' }"></div>
            <div class="battery-text">
              <span class="soc-num">{{ socPercent }}%</span>
            </div>
          </div>
          <div class="soc-state">
            <span class="state-chip" :class="stateClass">{{ stateText }}</span>
          </div>
          <div class="soc-legend">
            <span>静置</span><span>/</span><span>充电中</span><span>/</span><span>放电中</span><span>/</span><span>充满</span><span>/</span><span>欠压</span><span>/</span><span>保护</span><span>/</span><span>故障</span>
          </div>
        </div>
      </div>

      <!-- 核心指标与趋势 -->
      <div class="metrics-col">
        <div class="metrics-row">
          <div class="metric-card">
            <div class="metric-label">总电压</div>
            <div class="metric-value num" style="color: var(--data-voltage)">{{ fmt(packInfo?.voltage_V, 2) }}</div>
            <div class="metric-unit">V</div>
            <svg class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
              <path class="spark-path" :d="sparkVoltage" fill="none" stroke="var(--data-voltage)" stroke-width="1.5" />
            </svg>
          </div>
          <div class="metric-card">
            <div class="metric-label">电流</div>
            <div class="metric-value num" :style="{ color: packInfo && packInfo.current_A < 0 ? 'var(--data-temp)' : 'var(--data-current)' }">
              {{ fmt(packInfo?.current_A, 1) }}
            </div>
            <div class="metric-unit">A</div>
            <svg class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
              <path class="spark-path" :d="sparkCurrent" fill="none" stroke="var(--data-current)" stroke-width="1.5" />
            </svg>
          </div>
          <div class="metric-card">
            <div class="metric-label">功率</div>
            <div class="metric-value num" style="color: var(--data-delta)">{{ fmt(packInfo?.power_W, 0) }}</div>
            <div class="metric-unit">W</div>
            <svg class="sparkline" viewBox="0 0 120 30" preserveAspectRatio="none">
              <path class="spark-path" :d="sparkPower" fill="none" stroke="var(--data-delta)" stroke-width="1.5" />
            </svg>
          </div>
        </div>
        <div class="metrics-row">
          <div class="metric-card compact">
            <div class="metric-label">循环次数</div>
            <div class="metric-value num" style="color: var(--text-primary)">{{ packInfo?.cycleCount ?? '--' }}</div>
            <div class="metric-unit">次</div>
          </div>
          <div class="metric-card compact">
            <div class="metric-label">SOH</div>
            <div class="metric-value num" style="color: var(--ok)">{{ fmt(packInfo?.soh, 0) }}</div>
            <div class="metric-unit">%</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 第二行：单体电压 + 温度 -->
    <div class="tp-row">
      <div class="card cell-card">
        <div class="card-h">
          <span class="card-title">单体电压 ({{ cellVoltages.length }}S)</span>
          <span class="card-hint">
            最高 {{ fmt(cellMax / 1000, 3) }} (C{{ vMaxIdx + 1 }}) · 最低 {{ fmt(cellMin / 1000, 3) }} (C{{ vMinIdx + 1 }})
          </span>
        </div>
        <div class="cell-grid">
          <div
            v-for="(v, i) in cellVoltages"
            :key="i"
            class="cell-item"
            :class="{ max: v === cellMax && cellMax !== cellMin, min: v === cellMin && cellMax !== cellMin }"
          >
            <div class="cell-name">C{{ i + 1 }}</div>
            <div class="cell-val num">{{ (v / 1000).toFixed(3) }}</div>
          </div>
        </div>
      </div>

      <div class="card temp-card">
        <div class="card-h">
          <span class="card-title">温度 ({{ temperatures.length }}T)</span>
          <span class="card-hint">
            最高 {{ fmt(tempMax, 1) }} · 最低 {{ fmt(tempMin, 1) }}
          </span>
        </div>
        <div class="temp-list">
          <div
            v-for="(t, i) in temperatures"
            :key="i"
            class="temp-item"
            :class="{ max: t === tempMax && tempMax !== tempMin, min: t === tempMin && tempMax !== tempMin }"
          >
            <div class="temp-name">T{{ i + 1 }}<span v-if="t === tempMax" class="temp-tag">最高</span><span v-else-if="t === tempMin" class="temp-tag">最低</span></div>
            <div class="temp-val num">{{ t.toFixed(1) }} °C</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 第三行：开关与状态 -->
    <div class="card switch-card">
      <div class="card-h">
        <span class="card-title">开关与状态 (Status1)</span>
        <span class="card-hint">充电/放电/加热回路使能 + 低电量 + 失效标志</span>
      </div>
      <div class="switch-row">
        <div class="switch-item" :class="{ on: statusFlags.chargeSwitch }">
          <span class="switch-label">充电回路</span>
          <span class="switch-state">{{ statusFlags.chargeSwitch ? '开' : '关' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item" :class="{ on: statusFlags.dischargeSwitch }">
          <span class="switch-label">放电</span>
          <span class="switch-state">{{ statusFlags.dischargeSwitch ? '开' : '关' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item" :class="{ on: statusFlags.heatSwitch }">
          <span class="switch-label">加热</span>
          <span class="switch-state">{{ statusFlags.heatSwitch ? '开' : '关' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item flag" :class="{ active: statusFlags.lowPower }">
          <span class="switch-label">低电量</span>
          <span class="switch-state">{{ statusFlags.lowPower ? '是' : '否' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item fail" :class="{ active: statusFlags.chargeFail }">
          <span class="switch-label">充电失效</span>
          <span class="switch-state">{{ statusFlags.chargeFail ? '失效' : '正常' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item fail" :class="{ active: statusFlags.dischargeFail }">
          <span class="switch-label">放电失效</span>
          <span class="switch-state">{{ statusFlags.dischargeFail ? '失效' : '正常' }}</span>
          <span class="switch-dot"></span>
        </div>
        <div class="switch-item fail" :class="{ active: statusFlags.heatFail }">
          <span class="switch-label">加热失效</span>
          <span class="switch-state">{{ statusFlags.heatFail ? '失效' : '正常' }}</span>
          <span class="switch-dot"></span>
        </div>
      </div>
    </div>

    <!-- 第四行：保护 + 告警 -->
    <div class="tp-row">
      <div class="card flag-card">
        <div class="card-h">
          <span class="card-title">保护状态 (Protect1)</span>
          <span class="card-hint">触发={{ activeProtects.length }}/16</span>
        </div>
        <div class="flag-grid">
          <div
            v-for="bit in 16"
            :key="bit - 1"
            class="flag-item"
            :class="{ active: isProtectActive(bit - 1) }"
          >
            <span class="flag-bit">bit{{ bit - 1 }}</span>
            <span class="flag-name">{{ protectName(bit - 1) }}</span>
          </div>
        </div>
      </div>

      <div class="card flag-card alarm">
        <div class="card-h">
          <span class="card-title">告警状态 (Alarm1/2)</span>
          <span class="card-hint">告警={{ activeAlarms.length }}/16</span>
        </div>
        <div class="flag-grid">
          <div
            v-for="(item, idx) in alarmDisplay"
            :key="idx"
            class="flag-item"
            :class="{ active: item.level > 0, l1: item.level === 1, l2: item.level === 2, l3: item.level === 3 }"
          >
            <span class="flag-bit">bit{{ item.bit }}</span>
            <span class="flag-name">{{ item.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 第五行：设备信息 -->
    <div class="card devinfo-card">
      <div class="card-h">
        <span class="card-title">设备信息 (A400)</span>
      </div>
      <div class="devinfo-grid">
        <div class="devinfo-item"><span class="devinfo-k">名称</span><span class="devinfo-v num">{{ deviceInfo?.name ?? '--' }}</span></div>
        <div class="devinfo-item"><span class="devinfo-k">软件版本</span><span class="devinfo-v num">{{ deviceInfo?.bmsSw ?? '--' }}</span></div>
        <div class="devinfo-item"><span class="devinfo-k">硬件版本</span><span class="devinfo-v num">{{ deviceInfo?.bmsHw ?? '--' }}</span></div>
        <div class="devinfo-item"><span class="devinfo-k">IMEI</span><span class="devinfo-v num">{{ deviceInfo?.imei ?? '--' }}</span></div>
        <div class="devinfo-item"><span class="devinfo-k">IMSI</span><span class="devinfo-v num">{{ deviceInfo?.imsi ?? '--' }}</span></div>
        <div class="devinfo-item"><span class="devinfo-k">CCID</span><span class="devinfo-v num">{{ deviceInfo?.ccid ?? '--' }}</span></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTianyi } from '../tianyi/useTianyi'
import { PROTECT_BIT, ALARM1_BIT, ALARM2_BIT, BATTERY_STATE_TEXT } from '../tianyi/tianyi-protocol'

const props = defineProps<{ connected: boolean }>()

const {
  packInfo, cellVoltages, temperatures, deviceInfo,
  lastUpdateAt, commFault, slaveAddr, history,
  cellMax, cellMin, tempMax, tempMin,
  statusFlags, activeProtects, activeAlarms,
  fmt,
} = useTianyi()

const socPercent = computed(() => Math.max(0, Math.min(100, packInfo.value?.soc ?? 0)))
const isCharging = computed(() => statusFlags.value.batteryState === 2)
const isDischarging = computed(() => statusFlags.value.batteryState === 1)

const stateText = computed(() => BATTERY_STATE_TEXT[statusFlags.value.batteryState] || '未知')
const stateClass = computed(() => {
  const s = statusFlags.value.batteryState
  if (s === 0) return 'neutral'
  if (s === 2 || s === 3) return 'info'
  if (s === 1) return 'ok'
  if (s === 4 || s === 5 || s === 6) return 'critical'
  return 'neutral'
})

const vMaxIdx = computed(() => {
  if (!cellVoltages.value.length) return -1
  return cellVoltages.value.indexOf(cellMax.value)
})
const vMinIdx = computed(() => {
  if (!cellVoltages.value.length) return -1
  return cellVoltages.value.indexOf(cellMin.value)
})

function isProtectActive(bit: number): boolean {
  return activeProtects.value.some((p) => p.bit === bit)
}
function protectName(bit: number): string {
  return PROTECT_BIT[bit] || `bit${bit}`
}

interface AlarmDisp { bit: number; name: string; level: number }
const alarmDisplay = computed<AlarmDisp[]>(() => {
  const out: AlarmDisp[] = []
  for (let bit = 0; bit < 16; bit += 2) {
    const name = ALARM1_BIT[bit] || `bit${bit}`
    const level = (packInfo.value?.alarm1 ?? 0) >> bit & 0x03
    out.push({ bit, name, level })
  }
  for (let bit = 0; bit < 16; bit += 2) {
    const name = ALARM2_BIT[bit] || `bit${bit}`
    const level = (packInfo.value?.alarm2 ?? 0) >> bit & 0x03
    out.push({ bit: bit + 16, name, level })
  }
  return out
})

import type { Sample } from '../tianyi/useTianyi'

// Sparkline 生成
function makeSpark(data: Sample[], key: 'voltage' | 'current' | 'power'): string {
  if (!data.length) return ''
  const recent = data.slice(-60)
  const values = recent.map((s) => s[key])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 120
  const h = 30
  const pad = 2
  const step = w / (values.length - 1 || 1)
  return values.map((v, i) => {
    const x = i * step
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const sparkVoltage = computed(() => makeSpark(history.value, 'voltage'))
const sparkCurrent = computed(() => makeSpark(history.value, 'current'))
const sparkPower = computed(() => makeSpark(history.value, 'power'))
</script>

<style scoped>
.tianyi-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-6);
  min-height: 0;
  overflow-y: auto;
}

.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.tp-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.tp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-disabled);
}
.tp-dot.ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
.tp-dot.fault { background: var(--critical); box-shadow: 0 0 8px var(--critical); }
.tp-name {
  font-size: var(--fs-h2);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.tp-chip {
  font-size: var(--fs-caption);
  color: var(--brand-text);
  background: var(--brand-bg-subtle);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}
.tp-meta {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}
.tp-link { color: var(--text-tertiary); }
.tp-link.ok { color: var(--ok); }
.tp-poll { color: var(--text-tertiary); }
.tp-time { color: var(--text-secondary); }

.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}
.card-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}
.card-title {
  font-size: var(--fs-h3);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.card-hint {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}

/* SOC 卡片 */
.tp-dashboard {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--space-5);
}
.soc-card { min-height: 280px; }
.soc-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  height: calc(100% - 30px);
}
.battery-shell {
  position: relative;
  width: 64px;
  height: 140px;
  border: 2px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-inset);
  overflow: hidden;
}
.battery-shell::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 6px;
  background: var(--border-strong);
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
}
.battery-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  background: linear-gradient(180deg, var(--ok-bright), var(--ok));
  transition: height var(--dur-base) var(--ease-standard);
}
.battery-shell.charging .battery-fill {
  animation: chargeFlow 2s linear infinite;
  background: linear-gradient(180deg, var(--ok-bright) 0%, var(--ok) 50%, var(--ok-bright) 100%);
  background-size: 100% 200%;
}
.battery-shell.discharging .battery-fill {
  animation: dischargeFlow 2s linear infinite;
}
@keyframes chargeFlow {
  0% { background-position: 0% 0%; }
  100% { background-position: 0% 200%; }
}
@keyframes dischargeFlow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.75; }
}
.battery-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.soc-num {
  font-size: 26px;
  font-weight: var(--fw-bold);
  color: var(--text-inverse);
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  font-family: var(--font-mono);
}
.soc-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-body-sm);
}
.state-chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-weight: var(--fw-semibold);
}
.state-chip.neutral { background: var(--neutral-bg); color: var(--neutral-state); }
.state-chip.info { background: var(--info-bg); color: var(--info); }
.state-chip.ok { background: var(--ok-bg); color: var(--ok); }
.state-chip.critical { background: var(--critical-bg); color: var(--critical); }
.soc-legend {
  display: flex;
  gap: var(--space-2);
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  flex-wrap: wrap;
  justify-content: center;
}

/* 指标区 */
.metrics-col { display: flex; flex-direction: column; gap: var(--space-5); }
.metrics-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-5); }
.metrics-row:last-child { grid-template-columns: repeat(2, 1fr); }
.metric-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  min-height: 100px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.metric-card.compact { min-height: 72px; }
.metric-label {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  font-weight: var(--fw-semibold);
}
.metric-value {
  font-size: var(--fs-num-lg);
  font-weight: var(--fw-bold);
  font-family: var(--font-mono);
  margin-top: var(--space-2);
}
.metric-unit {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.sparkline {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
  height: 30px;
  opacity: 0.55;
}
.spark-path { vector-effect: non-scaling-stroke; }

/* 单体电压 */
.tp-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: var(--space-5);
}
.cell-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--space-3);
}
.cell-item {
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-2);
  text-align: center;
}
.cell-item.max {
  border-color: var(--critical-border);
  background: var(--critical-bg);
}
.cell-item.min {
  border-color: var(--warning-border);
  background: var(--warning-bg);
}
.cell-name {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  margin-bottom: 2px;
}
.cell-val {
  font-size: var(--fs-num-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.cell-item.max .cell-val { color: var(--critical); }
.cell-item.min .cell-val { color: var(--warning); }

/* 温度 */
.temp-list { display: flex; flex-direction: column; gap: var(--space-3); }
.temp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
.temp-item.max {
  border-color: var(--critical-border);
  background: var(--critical-bg);
}
.temp-item.min {
  border-color: var(--warning-border);
  background: var(--warning-bg);
}
.temp-name {
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.temp-tag {
  font-size: var(--fs-micro);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--text-tertiary);
  color: var(--text-inverse);
}
.temp-item.max .temp-tag { background: var(--critical); }
.temp-item.min .temp-tag { background: var(--warning); }
.temp-val {
  font-size: var(--fs-num-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.temp-item.max .temp-val { color: var(--critical); }
.temp-item.min .temp-val { color: var(--warning); }

/* 开关 */
.switch-row {
  display: flex;
  gap: var(--space-5);
}
.switch-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  min-width: 140px;
}
.switch-item.on {
  background: var(--ok-bg);
  border-color: rgba(47, 191, 113, 0.35);
}
.switch-label {
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
}
.switch-state {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-left: auto;
}
.switch-item.on .switch-state { color: var(--ok); font-weight: var(--fw-semibold); }
.switch-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-disabled);
}
.switch-item.on .switch-dot {
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}
/* 低电量：置 1 = 低电量，琥珀提示 */
.switch-item.flag.active {
  background: var(--warning-bg);
  border-color: var(--warning-border);
}
.switch-item.flag.active .switch-state {
  color: var(--warning);
  font-weight: var(--fw-semibold);
}
.switch-item.flag.active .switch-dot {
  background: var(--warning);
  box-shadow: 0 0 8px var(--warning);
}
/* 失效标志：置 1 = 故障，红色警示 */
.switch-item.fail.active {
  background: var(--critical-bg);
  border-color: var(--critical-border);
}
.switch-item.fail.active .switch-state {
  color: var(--critical);
  font-weight: var(--fw-semibold);
}
.switch-item.fail.active .switch-dot {
  background: var(--critical);
  box-shadow: 0 0 8px var(--critical);
}

/* 保护与告警 */
.flag-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}
.flag-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3);
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  text-align: center;
  opacity: 0.65;
}
.flag-item.active {
  opacity: 1;
  background: var(--critical-bg);
  border-color: var(--critical-border);
}
.flag-item.active .flag-name { color: var(--critical); font-weight: var(--fw-semibold); }
.flag-bit {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
}
.flag-name {
  font-size: var(--fs-caption);
  color: var(--text-secondary);
}

.flag-card.alarm .flag-item.active { background: var(--warning-bg); border-color: var(--warning-border); }
.flag-card.alarm .flag-item.active .flag-name { color: var(--warning); }
.flag-card.alarm .flag-item.l3 { background: var(--critical-bg); border-color: var(--critical-border); }
.flag-card.alarm .flag-item.l3 .flag-name { color: var(--critical); }
.flag-card.alarm .flag-item.l2 { background: rgba(239, 179, 60, 0.22); border-color: rgba(239, 179, 60, 0.55); }
.flag-card.alarm .flag-item.l2 .flag-name { color: #f5c15e; }
.flag-card.alarm .flag-item.l1 { background: rgba(239, 179, 60, 0.1); border-color: rgba(239, 179, 60, 0.35); }
.flag-card.alarm .flag-item.l1 .flag-name { color: var(--warning); }

/* 设备信息 */
.devinfo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
.devinfo-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}
.devinfo-k {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
}
.devinfo-v {
  font-size: var(--fs-body-sm);
  color: var(--text-primary);
  word-break: break-all;
}

/* 响应式 */
@media (max-width: 1280px) {
  .tp-dashboard { grid-template-columns: 1fr; }
  .soc-card { min-height: 220px; }
  .metrics-row { grid-template-columns: repeat(2, 1fr); }
  .tp-row { grid-template-columns: 1fr; }
  .cell-grid { grid-template-columns: repeat(6, 1fr); }
  .flag-grid { grid-template-columns: repeat(3, 1fr); }
  .devinfo-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 860px) {
  .metrics-row { grid-template-columns: 1fr; }
  .cell-grid { grid-template-columns: repeat(4, 1fr); }
  .flag-grid { grid-template-columns: repeat(2, 1fr); }
  .devinfo-grid { grid-template-columns: 1fr; }
}
</style>
