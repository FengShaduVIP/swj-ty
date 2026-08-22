import { ref, computed, watch, effectScope } from 'vue'
import { ElMessage } from 'element-plus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadHardwareVersion,
  buildReadProtectCounts, buildReadChipType, buildReadInternalRes,
  parseBasicInfo, parseCellVoltages, parseHardwareVersion, parseProtectCounts, parseInternalRes,
  PROTECT_BIT, ALARM_BIT, type BasicInfo, type Frame,
} from '@/jbd/jbd-protocol'
import { jbdBus } from '@/jbd/jbd-bus'
import { CHIP_TYPES } from '@/jbd/jbd-params'
import { ui, pushSample } from '@/store'
import { POLL_INTERVAL_MS } from '@/constants'

// ============================================================
// 模块级单例状态：实时监测页 / 参数配置页共享同一份数据与串口会话
// ============================================================
const connected = computed(() => ui.conn === 'connected')

const basicInfo = ref<BasicInfo | null>(null)
const cellVoltages = ref<number[]>([])
const internalRes = ref<number[]>([])
const hwVersion = ref('')
const protectCounts = ref<Record<string, number>>({})
const chipType = ref<number | null>(null)
const chipTypeName = computed(() => {
  if (chipType.value == null) return '—'
  const name = CHIP_TYPES[chipType.value] ?? '未知方案'
  return `${name} (0x${chipType.value.toString(16).padStart(2, '0')})`
})
const ackHistory = ref<string[]>([])
const autoPollProxy = ref(false)

// ===== 趋势历史 =====
const MAX_HISTORY = 600
const history = ref<Sample[]>([])
const recordTrend = ref(true)
const trendMetric = ref<'overview' | 'pack' | 'cells' | 'temps'>('overview')

interface Sample { t: number; total: number; current: number; soc: number; cells: number[]; temps: number[]; minC: number; maxC: number; diffC: number }

// ===== 派生 =====
const cellMax = computed(() => (cellVoltages.value.length ? Math.max(...cellVoltages.value) : 0))
const cellMin = computed(() => (cellVoltages.value.length ? Math.min(...cellVoltages.value) : 0))
const maxTemp = computed(() => (basicInfo.value && basicInfo.value.temperatures_C.length ? Math.max(...basicInfo.value.temperatures_C) : 0))
const activeProtects = computed(() => {
  if (!basicInfo.value) return []
  const out: string[] = []
  for (let bit = 0; bit <= 15; bit++) {
    if (basicInfo.value.protectStatus & (1 << bit)) out.push(PROTECT_BIT[bit] || `bit${bit}`)
  }
  return out
})
const activeAlarms = computed(() => {
  const status = basicInfo.value?.alarmStatus
  if (status === undefined) return []
  const out: string[] = []
  // 仅低 12 bit 有效（与 ALARM_BIT 字典对齐）；预留位忽略
  for (let bit = 0; bit <= 11; bit++) {
    if (status & (1 << bit)) out.push(ALARM_BIT[bit] || `bit${bit}`)
  }
  return out
})
const socStatus = computed<'ok' | 'warning' | 'critical'>(() => {
  const s = basicInfo.value?.rsoc ?? 100
  if (s < 30) return 'critical'
  if (s < 60) return 'warning'
  return 'ok'
})
const socLabel = computed(() => {
  const s = basicInfo.value?.rsoc ?? 100
  if (s < 30) return '严重不足'
  if (s < 60) return '偏低'
  return '充足'
})
const tempStatus = computed<'ok' | 'warning' | 'critical'>(() => {
  const t = maxTemp.value
  if (t > 55) return 'critical'
  if (t > 45) return 'warning'
  return 'ok'
})

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '--')
const pad = (n: number) => String(n).padStart(2, '0')

function cellClass(v: number, i = -1): string {
  const volt = v / 1000
  const classes: string[] = []
  if (volt < 3.0) classes.push('cell--crit')
  else if (volt > 4.25) classes.push('cell--warn')
  if (cellVoltages.value.length && v === cellMax.value) classes.push('cell--max')
  if (cellVoltages.value.length && v === cellMin.value && cellMax.value !== cellMin.value) classes.push('cell--min')
  if (i >= 0 && isBalancing(i)) classes.push('cell--eq')
  return classes.join(' ')
}
function isBalancing(i: number): boolean {
  const bi = basicInfo.value
  if (!bi) return false
  if (i < 16) return (bi.balanceLow & (1 << i)) !== 0
  return (bi.balanceHigh & (1 << (i - 16))) !== 0
}

// 保护事件按 UI 展示顺序（含短路次数）
const protectList = computed(() => [
  { key: 'single_ov',  label: '单体过压', count: protectCounts.value['单体过压'] },
  { key: 'single_uv',  label: '单体欠压', count: protectCounts.value['单体欠压'] },
  { key: 'pack_ov',    label: '整组过压', count: protectCounts.value['整体过压'] },
  { key: 'pack_uv',    label: '整组欠压', count: protectCounts.value['整体欠压'] },
  { key: 'chg_ot',     label: '充电高温', count: protectCounts.value['充电高温'] },
  { key: 'chg_ut',     label: '充电低温', count: protectCounts.value['充电低温'] },
  { key: 'disch_ot',   label: '放电高温', count: protectCounts.value['放电高温'] },
  { key: 'disch_ut',   label: '放电低温', count: protectCounts.value['放电低温'] },
  { key: 'chg_oc',     label: '充电过流', count: protectCounts.value['充电过流'] },
  { key: 'disch_oc',   label: '放电过流', count: protectCounts.value['放电过流'] },
  { key: 'short',      label: '短路次数', count: protectCounts.value['短路保护'] },
])

// ===== 发送 / 帧分发（单例订阅）=====
function send(frame: number[]) {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return }
  jbdBus.send(frame)
}
function pollSend(frame: number[]) { if (connected.value) jbdBus.send(frame) }

function readBasic() { send(buildReadBasicInfo()) }
function readCells() { send(buildReadCellVoltages()) }
function readHw() { send(buildReadHardwareVersion()) }
function readProtect() { send(buildReadProtectCounts()) }
// 芯片类型决定二级过流/短路保护下拉框的档位物理量，必须可靠读到。
// 嘉百达等设备在串口刚打开后首帧常被丢弃，且连接初期发送器未必就绪
// （jbdBus.setConnected(true) 由主进程 onStatusChange 异步触发，晚于 ui.conn 置位），
// 故读取失败需补发重试（与 startVerify 同源策略），避免首帧/竞态丢帧导致
// 下拉框始终拿不到芯片方案而误显示 0A。
async function readChip() {
  if (!connected.value) return
  for (let attempt = 0; attempt < 3; attempt++) {
    if (chipType.value != null || !connected.value) return
    const f = await jbdBus.sendAck(buildReadChipType())
    if (!f.timeout && f.valid && f.status === 0x00) return
    await new Promise((r) => setTimeout(r, 400))
  }
}
function readRes() { send(buildReadInternalRes()) }

let pollTimer: number | null = null
function startPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (connected.value && autoPollProxy.value) {
    pollTimer = window.setInterval(() => {
      pollSend(buildReadBasicInfo()); pollSend(buildReadCellVoltages())
    }, POLL_INTERVAL_MS)
  }
}
function onPollChange(v: boolean) {
  autoPollProxy.value = v
  startPoll()
}

function recordSample() {
  if (!recordTrend.value || !basicInfo.value) return
  pushSample()
  const cells = cellVoltages.value
  history.value.push({
    t: Date.now(),
    total: basicInfo.value.totalVoltage_mV / 1000,
    current: basicInfo.value.current_mA / 1000,
    soc: basicInfo.value.rsoc,
    cells: [...cells],
    temps: [...basicInfo.value.temperatures_C],
    minC: cells.length ? Math.min(...cells) / 1000 : 0,
    maxC: cells.length ? Math.max(...cells) / 1000 : 0,
    diffC: cells.length ? (Math.max(...cells) - Math.min(...cells)) / 1000 : 0,
  })
  if (history.value.length > MAX_HISTORY) history.value = history.value.slice(-MAX_HISTORY)
}
function clearTrend() { history.value = [] }

// 数据色板（仅 data-* 命名空间，DESIGN 2.6）
const C = { voltage: '#2DD4E8', current: '#A78BFA', temp: '#FF8A5B', soc: '#34D399', delta: '#F472B6' }
const trendSeries = computed(() => {
  const h = history.value
  if (!h.length) return []
  switch (trendMetric.value) {
    case 'overview':
      return [
        { name: '总压(V)', color: C.voltage, data: h.map((s) => s.total) },
        { name: '电流(A)', color: C.current, data: h.map((s) => s.current) },
        { name: '温度(℃)', color: C.temp, data: h.map((s) => s.maxC) },
        { name: 'SOC(%)', color: C.soc, data: h.map((s) => s.soc) },
      ]
    case 'pack':
      return [
        { name: '总压(V)', color: C.voltage, data: h.map((s) => s.total) },
        { name: '电流(A)', color: C.current, data: h.map((s) => s.current) },
      ]
    case 'cells': {
      const n = h[0].cells.length
      return Array.from({ length: n }, (_, i) => ({
        name: `C${i + 1}`,
        color: C.voltage,
        data: h.map((s) => (s.cells[i] ? s.cells[i] / 1000 : 0)),
      }))
    }
    case 'temps': {
      const n = h[0].temps.length
      return Array.from({ length: n }, (_, i) => ({
        name: `NTC${i + 1}`,
        color: C.temp,
        data: h.map((s) => s.temps[i] ?? 0),
      }))
    }
  }
  return []
})
const trendUnit = computed(() => (trendMetric.value === 'overview' ? 'V / A / ℃ / %' : trendMetric.value === 'pack' ? 'V / A' : trendMetric.value === 'temps' ? '℃' : 'V'))

// ===== 单例帧分发（仅订阅一次，避免重复处理 / 重复 ack）=====
function pushAck(text: string) {
  ackHistory.value.unshift(text)
  if (ackHistory.value.length > 50) ackHistory.value = ackHistory.value.slice(0, 50)
}
function handleFrame(f: Frame) {
  if (!f.valid) { pushAck(`[0x${f.cmd.toString(16).padStart(2, '0')}] 校验失败`); return }
  if (f.status !== 0x00) {
    const map: Record<number, string> = {
      0x80: '命令码不存在', 0x81: '操作无效/未进工厂模式', 0x82: '校验错误',
      0x83: '密码配对错误', 0x84: '密码修改失败',
    }
    const msg = map[f.status] || `状态0x${f.status.toString(16)}`
    pushAck(`[0x${f.cmd.toString(16).padStart(2, '0')}] ${msg}`)
    ElMessage.warning(`指令 0x${f.cmd.toString(16).padStart(2, '0')} 返回: ${msg}`)
    return
  }
  switch (f.cmd) {
    case 0x03: {
      basicInfo.value = parseBasicInfo(f.data)
      const bi = basicInfo.value
      ui.live.totalVoltage_V = bi.totalVoltage_mV / 1000
      ui.live.current_A = bi.current_mA / 1000
      ui.live.soc = bi.rsoc
      ui.live.maxTemp_C = bi.temperatures_C.length ? Math.max(...bi.temperatures_C) : null
      ui.live.cellCount = bi.cellCount
      ui.alarmCount = activeProtects.value.length + activeAlarms.value.length
      recordSample()
      break
    }
    case 0x04: cellVoltages.value = parseCellVoltages(f.data); recordSample(); break
    case 0x05: hwVersion.value = parseHardwareVersion(f.data); break
    case 0xaa: protectCounts.value = parseProtectCounts(f.data); break
    case 0xf6: internalRes.value = parseInternalRes(f.data); break
    // 芯片类型：命令字 0x00 被「读芯片类型」与「进厂指令(写 0x00)」共用。
    // 读响应携带数据字节（1~2 字节，取最后一个为真实类型）；进厂写指令的 ACK 无数据载荷。
    // 因此绝不能以"收到 0x00 帧"来清空 chipType——否则强制下发等进厂动作会把芯片类型误清空，
    // 导致二级过流/短路保护下拉框被禁用。只有带数据的 0x00 帧才更新 chipType。
    case 0x00: if (f.data.length) chipType.value = f.data[f.data.length - 1]; break
    default:
      pushAck(`[0x${f.cmd.toString(16).padStart(2, '0')}] 成功`)
  }
}

// 模块级单例帧订阅：useJbd 被多处调用也只注册一次，避免重复处理 / 重复 ack
const busSub = jbdBus.onFrame((f) => handleFrame(f))
void busSub

// 连接建立且尚未识别芯片方案时，自动读取芯片类型。
// 芯片方案决定二级过流/短路保护下拉框的物理量档位，缺它会导致下拉全显示 0.00A 而误导用户。
// 用 detached effectScope 在模块级建立一次永久 watch，不依赖任何组件生命周期，
// 从而参数配置页也能可靠拿到芯片类型（不必依赖监控页的 refreshAll 触发）。
effectScope(true).run(() => {
  watch(connected, (isConnected) => {
    if (isConnected && chipType.value == null) readChip()
  })
})

export function useJbd() {
  return {
    // 状态
    connected,
    basicInfo,
    cellVoltages, internalRes, hwVersion, protectCounts, chipType,
    ackHistory, autoPollProxy,
    history, recordTrend, trendMetric,
    // 派生
    cellMax, cellMin, maxTemp, activeProtects, activeAlarms,
    socStatus, socLabel, tempStatus,
    protectList, trendSeries, trendUnit, chipTypeName,
    // 工具
    fmt, pad, cellClass, isBalancing,
    // 动作
    send, pollSend,
    readBasic, readCells, readHw, readProtect, readChip, readRes,
    onPollChange,
    restartPoll: startPoll,
    recordSample, clearTrend,
  }
}
