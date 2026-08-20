import { ref, computed, watch, effectScope } from 'vue'
import { ElMessage } from 'element-plus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadHardwareVersion,
  buildReadProtectCounts, buildReadChipType, buildReadInternalRes,
  buildControlMOS, MOS_TYPE, MOS_ACTION,
  buildControlCommand, CONTROL_FUNC,
  buildEnterFactory, buildExitFactory, buildReadParam, buildWriteParam,
  buildFactoryPwdModify, buildFactoryPwdClear,
  buildBtPair, buildBtPwdModify, buildHeating,
  parseBasicInfo, parseCellVoltages, parseHardwareVersion, parseProtectCounts, parseInternalRes,
  PROTECT_BIT, ALARM_BIT, type BasicInfo, type Frame,
} from '@/jbd/jbd-protocol'
import { jbdBus } from '@/jbd/jbd-bus'
import { PARAM_TABLE, paramFormat, paramDispUnit, CHIP_TYPES } from '@/jbd/jbd-params'
import { ui, pushSample } from '@/store'
import { POLL_INTERVAL_MS } from '@/constants'

// ============================================================
// 模块级单例状态：实时监测页与设备控制页共享同一份数据与串口会话
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
const paramResult = ref<{ reg: number; values: number[] } | null>(null)
const ackHistory = ref<string[]>([])
const inFactory = ref(false)
const autoPollProxy = ref(false)

const paramReg = ref(0)
const paramCount = ref(1)
const paramWriteReg = ref(2)
const paramWriteVal = ref(0)

const oldPwd = ref(0x5678)
const newPwd = ref(0)
const btOld = ref('')
const btNew = ref('')

const heatStartTemp = ref(5)
const heatStopTemp = ref(15)

// ===== 趋势历史 =====
const MAX_HISTORY = 600
const history = ref<Sample[]>([])
const recordTrend = ref(true)
const trendMetric = ref<'overview' | 'pack' | 'cells' | 'temps'>('overview')

interface Sample { t: number; total: number; current: number; cells: number[]; temps: number[]; minC: number; maxC: number; diffC: number }

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
const writableParams = computed(() => PARAM_TABLE.filter((p) => !p.ascii))

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

// 0xFA 读取结果格式化
const paramRegText = computed(() => paramResult.value?.reg ?? 0)
const paramNameText = computed(() => paramResult.value ? paramName(paramResult.value.reg) : '')
const paramRawHex = computed(() =>
  paramResult.value ? paramResult.value.values.map((v) => '0x' + v.toString(16).padStart(4, '0').toUpperCase()).join(' ') : '')
const paramDisplayText = computed(() => {
  if (!paramResult.value || paramIsAscii(paramResult.value.reg)) return ''
  return paramResult.value.values.map((v, i) => paramFormat(paramResult.value!.reg + i, v)).join(', ')
})
const paramAsciiText = computed(() =>
  paramResult.value && paramIsAscii(paramResult.value.reg) ? paramAscii(paramResult.value.values) : '')
const paramUnitText = computed(() => paramResult.value ? paramDispUnit(paramResult.value.reg) : '')

function paramName(reg: number) { return PARAM_TABLE.find((p) => p.index === reg)?.name || '未知' }
function paramIsAscii(reg: number) { return !!PARAM_TABLE.find((p) => p.index === reg)?.ascii }
function paramAscii(values: number[]): string {
  const bytes: number[] = []
  values.forEach((v) => { bytes.push((v >> 8) & 0xff, v & 0xff) })
  return bytes.filter((b) => b > 0 && b < 128).map((b) => String.fromCharCode(b)).join('')
}

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
const pollSuspended = ref(false)
function startPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (connected.value && autoPollProxy.value && !pollSuspended.value) {
    pollTimer = window.setInterval(() => {
      pollSend(buildReadBasicInfo()); pollSend(buildReadCellVoltages())
    }, POLL_INTERVAL_MS)
  }
}
// 方案2：参数读取/下发期间临时挂起自动轮询，避免轮询帧插入参数操作序列
function suspendPoll() {
  pollSuspended.value = true
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
function resumePoll() {
  pollSuspended.value = false
  startPoll()
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
        { name: 'SOC(%)', color: C.soc, data: h.map((s) => basicInfo.value?.rsoc ?? 0) },
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

function setMos(type: number, open: boolean) { send(buildControlMOS(type, open ? MOS_ACTION.RELEASE : MOS_ACTION.CLOSE)) }
function setMosBoth(open: boolean) { send(buildControlMOS(MOS_TYPE.CHARGE_DISCHARGE, open ? MOS_ACTION.RELEASE : MOS_ACTION.CLOSE)) }

const controlButtons: { label: string; fn: readonly number[] }[] = [
  { label: '重置容量', fn: CONTROL_FUNC.RESET_CAPACITY },
  { label: '清除记录', fn: CONTROL_FUNC.CLEAR_RECORD },
  { label: '复位MCU', fn: CONTROL_FUNC.RESET_MCU },
  { label: '清除保护', fn: CONTROL_FUNC.CLEAR_PROTECT },
  { label: '进入休眠', fn: CONTROL_FUNC.SLEEP },
  { label: '掉电模式', fn: CONTROL_FUNC.POWER_DOWN },
  { label: '自动均衡', fn: CONTROL_FUNC.AUTO_BALANCE },
  { label: '储运模式', fn: CONTROL_FUNC.STORAGE },
  { label: 'SOC20%开关', fn: CONTROL_FUNC.SOC20_SWITCH },
  { label: 'SOC20%强开', fn: CONTROL_FUNC.SOC20_FORCE },
  { label: '强制启动', fn: CONTROL_FUNC.FORCE_START },
  { label: '强制加热', fn: CONTROL_FUNC.FORCE_HEAT },
]
function runControl(fn: readonly number[]) { send(buildControlCommand(fn)) }

function enterFactory() { send(buildEnterFactory()); inFactory.value = true }
function exitFactory() { send(buildExitFactory()); inFactory.value = false }

// BMS 状态字 → 中文（与 jbdBus 响应处理保持一致）
function statusText(s: number): string {
  const map: Record<number, string> = {
    0x80: '命令码不存在', 0x81: '操作无效/未进工厂模式', 0x82: '校验错误',
    0x83: '密码配对错误', 0x84: '密码修改失败',
  }
  return map[s] || `状态0x${s.toString(16)}`
}

// 方案3：参数读取经 sendAck 等待应答；读取期间挂起轮询（方案2）避免帧交叠
async function readParam() {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return }
  suspendPoll()
  try {
    const f = await jbdBus.sendAck(buildReadParam(paramReg.value, paramCount.value))
    if (f.timeout) ElMessage.warning('读取参数超时，未收到应答')
    // 非零状态由 jbdBus 广播 handleFrame 已弹警告，此处不重复
  } finally {
    resumePoll()
  }
}

// 方案3：参数下发严格串行（进工厂 → 写 → 出工厂），每帧等待应答后再发下一帧；
// 下发期间挂起轮询（方案2）确保总线不被抢占。
async function writeParam() {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return }
  suspendPoll()
  try {
    const ef = await jbdBus.sendAck(buildEnterFactory())
    if (ef.timeout) { ElMessage.error('进入工厂模式超时，未收到应答'); return }
    if (ef.status !== 0x00) { ElMessage.error('进入工厂模式失败：' + statusText(ef.status)); return }
    inFactory.value = true
    const wf = await jbdBus.sendAck(buildWriteParam(paramWriteReg.value, [(paramWriteVal.value >> 8) & 0xff, paramWriteVal.value & 0xff]))
    await jbdBus.sendAck(buildExitFactory())
    inFactory.value = false
    if (wf.timeout) ElMessage.error('参数下发超时，未收到应答（可能未生效，请重试）')
    else if (wf.status !== 0x00) ElMessage.error('参数下发失败：' + statusText(wf.status))
    else ElMessage.success('参数已下发')
  } finally {
    resumePoll()
  }
}

function modifyFactoryPwd() { send(buildFactoryPwdModify(oldPwd.value, newPwd.value)) }
function clearFactoryPwd() { send(buildFactoryPwdClear()) }
function digits(s: string): number[] {
  return s.split('').map((c) => parseInt(c, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 9)
}
function btPair() {
  const d = digits(btNew.value)
  if (d.length !== 6) { ElMessage.warning('请填写 6 位蓝牙密码'); return }
  send(buildBtPair(d))
}
function btModify() {
  const o = digits(btOld.value), n = digits(btNew.value)
  if (o.length !== 6 || n.length !== 6) { ElMessage.warning('请填写 6 位蓝牙密码'); return }
  send(buildBtPwdModify(o, n))
}

function heatStart() { send(buildHeating(0x01, 0, 0, heatStartTemp.value, heatStopTemp.value)) }
function heatStop() { send(buildHeating(0x02, 0, 0, 0, 0)) }

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
    case 0xfa:
      if (f.data.length >= 3) {
        const reg = (f.data[0] << 8) | f.data[1]
        const count = f.data[2]
        const values: number[] = []
        for (let i = 0; i < count; i++) values.push(((f.data[3 + i * 2] << 8) | f.data[4 + i * 2]) & 0xffff)
        paramResult.value = { reg, values }
      }
      break
    default:
      pushAck(`[0x${f.cmd.toString(16).padStart(2, '0')}] 成功`)
  }
}

let busSub: (() => void) | null = null
if (!busSub) busSub = jbdBus.onFrame((f) => handleFrame(f))

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
    paramResult, ackHistory, inFactory, autoPollProxy,
    paramReg, paramCount, paramWriteReg, paramWriteVal,
    oldPwd, newPwd, btOld, btNew,
    heatStartTemp, heatStopTemp,
    history, recordTrend, trendMetric,
    // 派生
    cellMax, cellMin, maxTemp, activeProtects, activeAlarms, writableParams,
    socStatus, socLabel, tempStatus,
    paramRegText, paramNameText, paramRawHex, paramDisplayText, paramAsciiText, paramUnitText,
    protectList, trendSeries, trendUnit, chipTypeName,
    // 工具
    fmt, pad, cellClass, isBalancing, paramName,
    // 动作
    send, pollSend,
    readBasic, readCells, readHw, readProtect, readChip, readRes,
    onPollChange,
    restartPoll: startPoll,
    recordSample, clearTrend,
    setMos, setMosBoth,
    controlButtons, runControl,
    enterFactory, exitFactory, readParam, writeParam,
    modifyFactoryPwd, clearFactoryPwd, btPair, btModify,
    heatStart, heatStop,
  }
}
