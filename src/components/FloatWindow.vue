<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { jbdBus } from '@/jbd/jbd-bus'
import { useJbd } from '@/jbd/useJbd'

// 浮动窗口（横向仪表条）：串口字节由主进程广播进来，经 jbdBus → useJbd
// 单例订阅解析（与主窗口同一套代码），本组件只读取、不发送、不轮询。
// 「强制下发」经主进程转发给主窗口执行（参数状态与确认框都在主窗口）。
const j = useJbd()
const basicInfo = j.basicInfo

const conn = ref<SerialStatus>({ connected: false })

const fmt = (v: number | null | undefined, d = 2) =>
  (v == null || !Number.isFinite(v)) ? '--' : v.toFixed(d)

const totalV = computed(() => basicInfo.value ? basicInfo.value.totalVoltage_mV / 1000 : null)
const currentA = computed(() => basicInfo.value ? basicInfo.value.current_mA / 1000 : null)
const soc = computed(() => basicInfo.value ? basicInfo.value.rsoc : null)
const maxTempC = computed(() => {
  const t = basicInfo.value?.temperatures_C
  return t && t.length ? Math.max(...t) : null
})
const hasCells = computed(() => j.cellVoltages.value.length > 0)
const cellMaxV = computed(() => hasCells.value ? j.cellMax.value / 1000 : null)
const cellMinV = computed(() => hasCells.value ? j.cellMin.value / 1000 : null)
const cellDeltaMv = computed(() =>
  hasCells.value ? j.cellMax.value - j.cellMin.value : null
)

const alarmCount = computed(() => j.activeProtects.value.length + j.activeAlarms.value.length)
const hasAlarm = computed(() => alarmCount.value > 0)
// 头部内联显示的告警/保护明细（过长省略号截断，悬停看全量）
const alarmInfo = computed(() => {
  if (!hasAlarm.value) return ''
  const parts: string[] = []
  if (j.activeProtects.value.length) parts.push(`保护 ${j.activeProtects.value.length}`)
  if (j.activeAlarms.value.length) parts.push(`告警 ${j.activeAlarms.value.length}`)
  return `${parts.join(' · ')}:${alarmDetail.value}`
})
const alarmDetail = computed(() =>
  [...j.activeProtects.value, ...j.activeAlarms.value].join('、')
)

// ===== 当前导入的模板名（主窗口参数配置页推送，浮窗打开时主进程补发缓存值）=====
const templateName = ref('')

// ===== 串口连接（浮窗直接调用主进程串口 IPC；主窗口经状态广播保持同步）=====
const ports = ref<SerialPortInfo[]>([])
const selectedPort = ref('')
const baud = ref(9600)

const connPending = ref(false)
let pendingTimer: number | null = null
function clearPending() {
  connPending.value = false
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
}
function armPending() {
  connPending.value = true
  if (pendingTimer) clearTimeout(pendingTimer)
  // 状态广播/错误事件到达时提前清除；超时兜底防状态丢失卡死按钮
  pendingTimer = window.setTimeout(clearPending, 3000)
}

function portLabel(p: SerialPortInfo): string {
  return p.friendlyName ? `${p.path} · ${p.friendlyName}` : p.path
}

async function refreshPorts() {
  try {
    ports.value = await window.serialAPI?.listPorts() ?? []
    // 保留仍存在的选中项；否则优先当前连接的端口，再退到第一个可用口
    if (!ports.value.some((p) => p.path === selectedPort.value)) {
      selectedPort.value = conn.value.connected && conn.value.portPath
        ? conn.value.portPath
        : (ports.value[0]?.path ?? '')
    }
  } catch { /* 枚举失败保留现状，下次刷新重试 */ }
}

async function toggleConn() {
  if (connPending.value) return
  if (conn.value.connected) {
    armPending()
    try { await window.serialAPI?.disconnect() } catch { clearPending() }
    return
  }
  if (!selectedPort.value) return
  armPending()
  try {
    // 失败时 serialManager 广播 serial:error → onSerialError 清除 pending，原因进日志条
    await window.serialAPI?.connect({ path: selectedPort.value, baudRate: baud.value })
  } catch { clearPending() }
}

// ===== 通讯日志（与参数配置页 commStrip 同源同格式：主窗口 addLog 逐条转发）=====
const logs = ref<FloatLogEntry[]>([])
const logStrip = computed(() => logs.value.slice(-2))
function tagLabel(type: string): string {
  return { send: '发送', recv: '接收', error: '错误', info: '信息' }[type] ?? type
}

// ===== 置顶开关 =====
const alwaysOnTop = ref(true)
function toggleAlwaysOnTop() {
  alwaysOnTop.value = !alwaysOnTop.value
  void window.floatAPI.setAlwaysOnTop(alwaysOnTop.value)
}

const onSerialData = (bytes: number[]) => jbdBus.feed(bytes)
const onStatusChange = (s: SerialStatus) => {
  conn.value = s
  clearPending()
  if (s.connected) {
    // 同步端口显示与波特率（自动连接/其他窗口建立的连接也保持一致）
    if (s.portPath) selectedPort.value = s.portPath
    if (s.baudRate) baud.value = s.baudRate
  }
}
const onSerialError = () => clearPending()
const onLog = (entry: FloatLogEntry) => {
  logs.value.push(entry)
  // 浮窗只需展示最近若干条，截断防数组无限增长
  if (logs.value.length > 50) logs.value.splice(0, logs.value.length - 50)
}

function showMain() { void window.floatAPI.showMain() }
function close() { void window.floatAPI.close() }
function forceWrite() { void window.floatAPI.requestForceWrite() }

onMounted(() => {
  // 打开浮窗时连接可能已建立，先同步当前状态与端口/波特率，再订阅增量事件
  void window.serialAPI?.getStatus?.().then(async (s) => {
    conn.value = s
    if (s.portPath) selectedPort.value = s.portPath
    if (s.baudRate) baud.value = s.baudRate
    // 未连接时以自动连接配置的波特率为准（与主窗口「设置」一致）
    if (!s.connected) {
      const cfg = await window.serialAPI?.getAutoConnect?.()
      if (cfg?.baudRate) baud.value = cfg.baudRate
    }
    void refreshPorts()
  })
  window.serialAPI?.onData?.(onSerialData)
  window.serialAPI?.onStatusChange?.(onStatusChange)
  window.serialAPI?.onError?.(onSerialError)
  window.floatAPI?.onLog?.(onLog)
  window.floatAPI?.onTemplate?.((name) => { templateName.value = name })
})

onUnmounted(() => {
  // removeAllListeners 只作用于本窗口的 ipcRenderer，不影响主窗口
  window.serialAPI.removeAllListeners()
})
</script>

<template>
  <div class="float" :class="{ 'float--alarm': hasAlarm }">
    <header class="float-head">
      <span class="dot" :class="conn.connected ? 'dot--ok' : 'dot--off'" />
      <select
        v-model="selectedPort"
        class="port-select"
        :disabled="conn.connected"
        :title="conn.connected ? `${selectedPort} @ ${baud}（断开后可更换端口）` : '选择串口'"
      >
        <option value="" disabled>选择串口</option>
        <option v-for="p in ports" :key="p.path" :value="p.path">{{ portLabel(p) }}</option>
      </select>
      <button class="icon-btn" title="刷新串口列表" @click="refreshPorts">⟳</button>
      <span v-if="templateName" class="tpl" :title="`当前模板:${templateName}`">模板 {{ templateName }}</span>
      <span v-if="hasAlarm" class="alarm-info" :title="alarmDetail">⚠ {{ alarmInfo }}</span>
      <span class="head-spacer" />
      <span class="head-title">天一BMS</span>
      <span class="head-actions">
        <button
          class="conn-btn"
          :class="conn.connected ? 'conn-btn--on' : 'conn-btn--off'"
          :disabled="connPending"
          :title="conn.connected ? '断开串口（在主窗口执行）' : '连接串口（复用主窗口最近一次配置）'"
          @click="toggleConn"
        >
          {{ connPending ? '…' : (conn.connected ? '断开' : '连接') }}
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--active': alwaysOnTop }"
          :title="alwaysOnTop ? '已置顶，点击取消置顶' : '点击置顶'"
          @click="toggleAlwaysOnTop"
        >
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M9.5 1.5 14.5 6.5 12 9 10.8 7.8 7.2 11.4 8.1 12.3 6.4 14 2 9.6 3.7 7.9 4.6 8.8 8.2 5.2 7 4 9.5 1.5Z" fill="currentColor" />
          </svg>
        </button>
        <button class="icon-btn" title="回到主界面" @click="showMain">⌂</button>
        <button class="icon-btn" title="关闭浮窗" @click="close">✕</button>
      </span>
    </header>

    <main class="float-main">
      <!-- 核心四读数 -->
      <div class="metric">
        <span class="m-label">总压 V</span>
        <span class="m-num m-num--v">{{ fmt(totalV) }}</span>
      </div>
      <div class="metric">
        <span class="m-label">电流 A</span>
        <span class="m-num m-num--i" :class="{ 'm-num--neg': (currentA ?? 0) < 0 }">{{ fmt(currentA) }}</span>
      </div>
      <div class="metric">
        <span class="m-label">SOC %</span>
        <span class="m-num m-num--soc">{{ fmt(soc, 0) }}</span>
      </div>
      <div class="metric">
        <span class="m-label">最高温 ℃</span>
        <span class="m-num m-num--t">{{ fmt(maxTempC, 1) }}</span>
      </div>

      <div class="v-sep" />

      <!-- 单体概况：最高 / 最低 / 压差 -->
      <div class="cell-stat" title="单体电压概况">
        <span class="m-label">单体最高</span>
        <span class="c-num">{{ hasCells ? fmt(cellMaxV, 3) : '--' }}</span>
      </div>
      <div class="cell-stat">
        <span class="m-label">单体最低</span>
        <span class="c-num">{{ hasCells ? fmt(cellMinV, 3) : '--' }}</span>
      </div>
      <div class="cell-stat" :title="hasCells ? `共 ${j.cellVoltages.value.length} 节单体` : ''">
        <span class="m-label">压差 mV</span>
        <span class="c-num c-num--delta">{{ cellDeltaMv ?? '--' }}</span>
      </div>

      <div class="v-sep" />

      <!-- 右侧：两行通讯日志 + 强制下发 -->
      <div class="side">
        <div class="log-strip" title="实时通信日志（与参数配置页一致）">
          <div v-if="!logStrip.length" class="log-empty">暂无通信日志</div>
          <div v-for="l in logStrip" :key="l.id" class="log-line" :class="'log-' + l.type">
            <span class="l-time">{{ l.time }}</span>
            <span class="l-tag">{{ tagLabel(l.type) }}</span>
            <span class="l-text">{{ l.content }}</span>
          </div>
        </div>
        <button class="force-btn" :disabled="!conn.connected" title="把当前读取到的参数原样全部下发（在主窗口确认）" @click="forceWrite">
          ⚡ 强制下发
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.float {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  font-family: var(--font-sans);
  color: var(--text-primary);
  overflow: hidden;
  user-select: none;
}

/* 整条可拖动窗口，按钮区单独放行点击 */
.float {
  -webkit-app-region: drag;
}
.head-actions,
.force-btn,
.port-select,
.float-head .icon-btn {
  -webkit-app-region: no-drag;
}

/* 告警高亮：红色描边 + 微光 */
.float--alarm {
  border-color: var(--critical-border);
  box-shadow: var(--glow-critical);
}

/* ===== 标题行（28px，保持整条高度恒定；告警收进徽章不另占行）===== */
.float-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 28px;
  padding: 0 var(--space-3) 0 var(--space-5);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  flex: none;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex: none;
}
.dot--ok  { background: var(--ok-bright); box-shadow: 0 0 6px var(--ok-bright); }
.dot--off { background: var(--neutral-state); }

/* 端口下拉：暗色紧凑，连接中禁用换口 */
.port-select {
  flex: none;
  max-width: 170px;
  height: 20px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  outline: none;
  cursor: pointer;
}
.port-select:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.port-select option {
  background: var(--bg-raised);
  color: var(--text-primary);
}

/* 当前模板名：完整显示不截断；过长时告警明细先收缩、间距自适应 */
.tpl {
  flex: none;
  font-size: var(--fs-micro);
  color: var(--text-secondary);
  white-space: nowrap;
}

/* 告警/保护明细：内联展示全量文本，过长截断，悬停看完整 */
.alarm-info {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0 var(--space-4);
  height: 16px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--critical-bg);
  border: 1px solid var(--critical-border);
  color: var(--critical);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: chip-breathe var(--anim-pulse);
}
@keyframes chip-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}

.head-spacer { flex: 1; }

.head-title {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 连接/断开遥控按钮 */
.conn-btn {
  flex: none;
  height: 20px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out);
}
.conn-btn:active:not(:disabled) { transform: scale(0.94); }
.conn-btn:disabled { opacity: 0.5; cursor: wait; }
.conn-btn--off {
  border: 1px solid var(--brand-ring);
  background: var(--brand-bg-subtle);
  color: var(--brand-text);
}
.conn-btn--off:hover:not(:disabled) { background: var(--brand-bg-hover); }
.conn-btn--on {
  border: 1px solid var(--border-strong);
  background: var(--neutral-bg);
  color: var(--neutral-state);
}
.conn-btn--on:hover:not(:disabled) { background: var(--bg-active); }

.icon-btn {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out);
}
.icon-btn:active { transform: scale(0.92); }
.icon-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}
.icon-btn--active {
  color: var(--brand-text);
}

/* ===== 主行：核心读数 | 单体概况 | 日志+下发，横向单行排布 ===== */
.float-main {
  flex: 1;
  display: flex;
  align-items: stretch;
  min-height: 0;
  padding: var(--space-4);
  gap: 0;
}

.metric,
.cell-stat {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  min-width: 0;
}

/* 核心读数与单体概况平分剩余宽度 */
.metric { flex: 1 1 0; }
.cell-stat { flex: 0.82 1 0; }

.m-label {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.m-num {
  font-family: var(--font-display-num);
  font-size: var(--fs-num-lg);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  letter-spacing: -0.01em; /* 大号数字收紧字距 */
  white-space: nowrap;
}

/* 单体概况：次级字号，弱一档 */
.c-num {
  font-family: var(--font-display-num);
  font-size: var(--fs-num-md);
  font-weight: var(--fw-medium);
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  white-space: nowrap;
}

.m-num--v   { color: var(--data-voltage); }
.m-num--i   { color: var(--data-current); }
.m-num--soc { color: var(--data-soc); }
.m-num--t   { color: var(--data-temp); }
.m-num--neg { color: var(--warning); }
.c-num--delta { color: var(--data-delta); font-weight: var(--fw-semibold); }

.v-sep {
  flex: none;
  width: 1px;
  margin: var(--space-2) 0;
  background: var(--border-subtle);
}

/* ===== 右侧：两行日志（末尾对齐自动滚动）+ 强制下发 ===== */
.side {
  flex: none;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-left: var(--space-3);
}

.log-strip {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 1px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  overflow: hidden;
}

.log-empty {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  line-height: 100%;
}

.log-line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 14px;
  line-height: 14px;
  font-size: var(--fs-micro);
  white-space: nowrap;
  overflow: hidden;
}

.l-time {
  flex: none;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
}

.l-tag {
  flex: none;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  line-height: 13px;
}

.l-text {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-line.log-send .l-tag { background: var(--brand-bg-subtle); color: var(--brand-text); }
.log-line.log-recv .l-tag { background: var(--ok-bg);           color: var(--ok); }
.log-line.log-error .l-tag { background: var(--critical-bg);   color: var(--critical); }
.log-line.log-info .l-tag { background: var(--info-bg);        color: var(--info); }

.force-btn {
  flex: none;
  height: 26px;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.force-btn:active:not(:disabled) { transform: scale(0.97); }
.force-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--warning) 18%, transparent);
}
.force-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
