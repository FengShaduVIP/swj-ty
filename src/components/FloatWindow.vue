<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

// 浮动置顶小窗：串口由主窗口渲染进程独占（Web Serial 端口授权只在一个渲染进程），
// 浮窗不碰硬件、不解析帧。实时数据、串口状态、日志全部由主窗口经主进程推送过来；
// 「读取全部 / 强制下发 / 单参数下发」则是把指令回传给主窗口执行。
const conn = ref<SerialStatus>({ connected: false })

const fmt = (v: number | null | undefined, d = 2) =>
  (v == null || !Number.isFinite(v)) ? '--' : v.toFixed(d)

// ===== 实时数据快照（主窗口解析后推送，浮窗只显示）=====
const live = ref<FloatLiveSnapshot>({
  totalV: null, currentA: null, soc: null, maxTempC: null,
  cellMaxV: null, cellMinV: null, cellDeltaMv: null, cellCount: 0,
  protects: [], alarms: [],
})
const totalV = computed(() => live.value.totalV)
const currentA = computed(() => live.value.currentA)
const soc = computed(() => live.value.soc)
const maxTempC = computed(() => live.value.maxTempC)
const hasCells = computed(() => live.value.cellCount > 0)
const cellMaxV = computed(() => live.value.cellMaxV)
const cellMinV = computed(() => live.value.cellMinV)
const cellDeltaMv = computed(() => live.value.cellDeltaMv)

const alarmCount = computed(() => live.value.protects.length + live.value.alarms.length)
const hasAlarm = computed(() => alarmCount.value > 0)
// 头部内联显示的告警/保护明细（过长省略号截断，悬停看全量）
const alarmInfo = computed(() => {
  if (!hasAlarm.value) return ''
  const parts: string[] = []
  if (live.value.protects.length) parts.push(`保护 ${live.value.protects.length}`)
  if (live.value.alarms.length) parts.push(`告警 ${live.value.alarms.length}`)
  return `${parts.join(' · ')}:${alarmDetail.value}`
})
const alarmDetail = computed(() => [...live.value.protects, ...live.value.alarms].join('、'))

// ===== 当前导入的模板名（主窗口参数配置页推送，浮窗打开时主进程补发缓存值）=====
const templateName = ref('')

// ===== 串口连接（Web Serial 端口授权绑定在主窗口渲染进程，浮窗只发指令、收状态推送）=====
const ports = ref<FloatSerialPortEntry[]>([])
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
  // 主窗口执行后一定会推回串口状态（onSerialState 里清除）；超时兜底防状态丢失卡死按钮
  pendingTimer = window.setTimeout(clearPending, 3000)
}

function portLabel(p: FloatSerialPortEntry): string {
  return p.comName ? `${p.comName} · ${p.path}` : p.path
}

function refreshPorts() {
  window.floatAPI?.requestSerialAction({ action: 'list' })
}

function toggleConn() {
  if (connPending.value) return
  if (conn.value.connected) {
    armPending()
    window.floatAPI?.requestSerialAction({ action: 'disconnect' })
    return
  }
  armPending()
  window.floatAPI?.requestSerialAction({
    action: 'connect',
    path: selectedPort.value || undefined,
    baudRate: baud.value,
  })
}

// 主窗口推送的串口状态：连接态 + 已授权端口列表（端口由主窗口独占，这里只做展示与指令入口）
const onSerialState = (s: FloatSerialState) => {
  conn.value = { connected: s.connected, portPath: s.portLabel || s.comName, baudRate: s.baudRate }
  clearPending()
  ports.value = s.ports
  if (s.connected) {
    if (s.portLabel) selectedPort.value = s.portLabel
    if (s.baudRate) baud.value = s.baudRate
  } else if (s.ports.length && !s.ports.some((p) => p.path === selectedPort.value)) {
    selectedPort.value = s.ports[0].path
  }
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

// Web Serial 迁移后，浮窗不再直接接触串口：帧解析与轮询统一在主窗口进行，
// 浮窗依靠主窗口推送的字段值与串口状态显示；端口下拉/连接/断开均为指令入口。
const onLog = (entry: FloatLogEntry) => {
  logs.value.push(entry)
  // 浮窗只需展示最近若干条，截断防数组无限增长
  if (logs.value.length > 50) logs.value.splice(0, logs.value.length - 50)
}

// ===== 浮窗触发的读取/下发进度（主窗口推送；顶部进度条 + 对应按钮显示百分比） =====
const dispatch = ref<{ busy: boolean; progress: number; kind?: 'read' | 'write' }>({ busy: false, progress: 0 })
const onProgress = (p: { busy: boolean; progress: number; kind?: 'read' | 'write' }) => { dispatch.value = p }

function showMain() { void window.floatAPI.showMain() }
function close() { void window.floatAPI.close() }
// 强制下发：蓝牙名称/BMS编码以浮窗输入为准，其余参数按模板/页面值（浮窗弹窗确认后执行，不弹出主窗口）
function forceWrite() {
  void window.floatAPI.requestForceWrite({ btName: btName.value, bmsCode: bmsCode.value })
}
// 读取全部：经主进程静默转发主窗口执行（不弹主窗口），读取后蓝牙名称/BMS编码自动回填输入框
function readAll() {
  void window.floatAPI.requestReadAll()
}
function paramAction(action: 'bt-name' | 'bms-code' | 'reset-mcu', value?: string) {
  void window.floatAPI.requestParamAction(action, value)
}

// ===== 蓝牙名称 / BMS编码 输入框 =====
// 本地持久化（重启保留）；主窗口读取设备/导入模板后推送当前值回填（输入聚焦时不覆盖）
const btName = ref(localStorage.getItem('float_bt_name') ?? '')
const bmsCode = ref(localStorage.getItem('float_bms_code') ?? '')
const btInputEl = ref<HTMLInputElement | null>(null)
const bmsInputEl = ref<HTMLInputElement | null>(null)
watch(btName, (v) => localStorage.setItem('float_bt_name', v))
watch(bmsCode, (v) => localStorage.setItem('float_bms_code', v))

onMounted(() => {
  // 串口状态由主窗口经主进程推送（打开浮窗时主进程会补发最近一次缓存值），
  // 之后主窗口每次连接/断开/刷新都会推新状态过来
  window.floatAPI?.onSerialState?.(onSerialState)
  // 实时读数：主窗口解析出数据后逐次推送（本窗口不解析任何串口字节）
  window.floatAPI?.onLive?.((s) => { live.value = s })
  window.floatAPI?.onLog?.(onLog)
  window.floatAPI?.onTemplate?.((name) => { templateName.value = name })
  window.floatAPI?.onProgress?.(onProgress)
  window.floatAPI?.onFieldValues?.((v) => {
    // 仅当浮窗本身处于聚焦且输入框正被编辑时才跳过回填（避免打断正在输入的内容）。
    // 不能只看 activeElement：浮窗失焦后（如去主窗口操作时）它残留为最后一次聚焦的
    // 元素（比如 BMS编码输入框），会导致回填被误判为「正在输入」而永远不更新。
    const editing = (el: HTMLInputElement | null) =>
      el != null && document.hasFocus() && document.activeElement === el
    if (v.btName && !editing(btInputEl.value)) btName.value = v.btName
    if (v.bmsCode && !editing(bmsInputEl.value)) bmsCode.value = v.bmsCode
  })
})

// 浮窗的 IPC 监听随窗口销毁一并回收（ipcRenderer 绑在本窗口进程内，无需手动移除）
</script>

<template>
  <div class="float" :class="{ 'float--alarm': hasAlarm }">
    <!-- 浮窗触发的强制下发进度条（与参数配置页同款 el-progress：4px 品牌色细条），
         贴窗口顶边覆盖显示，不占布局、不挡点击 -->
    <div v-if="dispatch.busy" class="dispatch-progress">
      <el-progress :percentage="dispatch.progress" :stroke-width="4" color="#1F6FE0" :show-text="false" />
    </div>
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
      <div class="cell-stat" :title="hasCells ? `共 ${live.cellCount} 节单体` : ''">
        <span class="m-label">压差 mV</span>
        <span class="c-num c-num--delta">{{ cellDeltaMv ?? '--' }}</span>
      </div>

      <div class="v-sep" />

      <!-- 右侧：两行通讯日志 + 读取全部/强制下发 -->
      <div class="side">
        <div class="log-strip" title="实时通信日志（与参数配置页一致）">
          <div v-if="!logStrip.length" class="log-empty">暂无通信日志</div>
          <div v-for="l in logStrip" :key="l.id" class="log-line" :class="'log-' + l.type">
            <span class="l-time">{{ l.time }}</span>
            <span class="l-tag">{{ tagLabel(l.type) }}</span>
            <span class="l-text">{{ l.content }}</span>
          </div>
        </div>
        <div class="side-actions">
          <button
            class="read-btn"
            :disabled="!conn.connected || dispatch.busy"
            :title="dispatch.busy && dispatch.kind === 'read' ? `读取全部进行中 ${dispatch.progress}%` : '读取全部参数：读取后蓝牙名称/BMS编码自动回填本浮窗输入框（在主窗口执行，不弹出主窗口）'"
            @click="readAll"
          >
            {{ dispatch.busy && dispatch.kind === 'read' ? `读取 ${dispatch.progress}%` : '读取全部' }}
          </button>
          <button class="force-btn" :disabled="!conn.connected || dispatch.busy" :title="dispatch.busy && dispatch.kind === 'write' ? `强制下发进行中 ${dispatch.progress}%` : '强制下发参数：蓝牙名称/BMS编码以本浮窗输入为准，其余按页面值（本浮窗弹窗确认，不弹出主窗口；无值的参数会跳过）'" @click="forceWrite">
            {{ dispatch.busy && dispatch.kind === 'write' ? `⚡ ${dispatch.progress}%` : '⚡ 强制下发' }}
          </button>
        </div>
      </div>
    </main>

    <!-- 底部操作栏：蓝牙名称/BMS编码输入下发 + 复位，横向单行 -->
    <footer class="float-foot">
      <input
        ref="btInputEl"
        v-model="btName"
        class="val-input"
        placeholder="蓝牙名称"
        maxlength="16"
        title="蓝牙名称（最长 16 字符），下发走 0xA2 专用指令"
        spellcheck="false"
      >
      <button class="send-btn" :disabled="!conn.connected || !btName.trim()" title="下发蓝牙名称到设备（在主窗口执行）" @click="paramAction('bt-name', btName)">
        下发名称
      </button>
      <input
        ref="bmsInputEl"
        v-model="bmsCode"
        class="val-input"
        placeholder="BMS编码"
        maxlength="16"
        title="BMS编码信息（最长 16 字符）"
        spellcheck="false"
      >
      <button class="send-btn" :disabled="!conn.connected || !bmsCode.trim()" title="下发 BMS 编码信息到设备（在主窗口执行）" @click="paramAction('bms-code', bmsCode)">
        下发编码
      </button>
      <span class="foot-sep" />
      <button class="send-btn send-btn--crit" :disabled="!conn.connected || dispatch.busy" title="复位 MCU，设备将重启（本浮窗弹窗确认，不弹出主窗口；读取/下发进行中不可点）" @click="paramAction('reset-mcu')">
        复位MCU
      </button>
    </footer>
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
.read-btn,
.val-input,
.send-btn,
.port-select,
.float-head .icon-btn {
  -webkit-app-region: no-drag;
}

/* 告警高亮：红色描边 + 微光 */
.float--alarm {
  border-color: var(--critical-border);
  box-shadow: var(--glow-critical);
}

/* ===== 浮窗触发的强制下发进度条（贴顶边覆盖，不占布局不挡点击）===== */
.dispatch-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  line-height: 0;
  pointer-events: none;
  -webkit-app-region: no-drag;
}
/* 与参数配置页同款：4px 品牌色细条；顶边通栏不做圆角 */
.dispatch-progress :deep(.el-progress-bar__outer),
.dispatch-progress :deep(.el-progress-bar__inner) {
  border-radius: 0;
  transition: width 0.2s ease;
}
.dispatch-progress :deep(.el-progress-bar__outer) {
  background: var(--brand-bg-subtle);
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

/* 日志条下方按钮行：读取全部 + 强制下发 均分宽度 */
.side-actions {
  flex: none;
  display: flex;
  gap: var(--space-2);
}
.side-actions .read-btn,
.side-actions .force-btn {
  flex: 1;
  min-width: 0;
  padding: 0;
  white-space: nowrap;
}

.read-btn {
  height: 26px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  color: var(--text-secondary);
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out), background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.read-btn:hover:not(:disabled) {
  color: var(--brand-solid);
  border-color: var(--brand-ring);
  background: var(--brand-bg-subtle);
}
.read-btn:active:not(:disabled) { transform: scale(0.97); }
.read-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

/* ===== 底部操作栏：输入框 + 下发按钮 + 复位，横向单行 ===== */
.float-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-raised);
}

.val-input {
  flex: 1 1 150px;
  min-width: 0;
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--fs-body-sm);
  outline: none;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.val-input::placeholder {
  color: var(--text-disabled);
  font-size: var(--fs-caption);
}
.val-input:focus {
  border-color: var(--brand);
}

.send-btn {
  flex: none;
  height: 26px;
  padding: 0 var(--space-4);
  border: 1px solid var(--brand-ring);
  border-radius: var(--radius-sm);
  background: var(--brand-bg-subtle);
  color: var(--brand-text);
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition: transform var(--dur-instant) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.send-btn:active:not(:disabled) { transform: scale(0.95); }
.send-btn:hover:not(:disabled) { background: var(--brand-bg-hover); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.foot-sep {
  flex: none;
  width: 1px;
  height: 18px;
  margin: 0 var(--space-2);
  background: var(--border-strong);
}

.send-btn--crit {
  border-color: var(--critical-border);
  background: var(--critical-bg);
  color: var(--critical);
}
.send-btn--crit:hover:not(:disabled) {
  background: color-mix(in srgb, var(--critical) 18%, transparent);
}
</style>
