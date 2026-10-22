import { ref, computed, watch, effectScope } from 'vue'
import { ElMessage } from 'element-plus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadHardwareVersion,
  buildReadProtectCounts, buildReadChipType,
  parseBasicInfo, parseCellVoltages, parseHardwareVersion, parseProtectCounts,
  PROTECT_BIT, ALARM_BIT, type BasicInfo, type Frame,
} from '@/jbd/jbd-protocol'
import { serialBus } from '@/jbd/serial-bus'
import { paramState } from '@/jbd/param-state'
import { CHIP_TYPES } from '@/jbd/jbd-params'
import { ui, pushSample } from '@/store'
import { POLL_INTERVAL_MS } from '@/constants'

// ============================================================
// 模块级单例状态：实时监测页 / 参数配置页共享同一份数据与串口会话
// ============================================================
const connected = computed(() => ui.conn === 'connected')

const basicInfo = ref<BasicInfo | null>(null)
const cellVoltages = ref<number[]>([])
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

// ===== 批量参数操作期间暂停自动轮询 =====
// 参数配置页的批量读/写共用此状态：避免轮询帧与批量帧交错排队，
// 拉长批量耗时并推高批量帧排队超时的概率。
const batchBusy = ref(false)

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
/** 一问一答：失败/超时返回 null（调用方按无应答处理） */
async function request(frame: number[], cmd: number, timeoutMs = 1500): Promise<Frame | null> {
  try {
    return await serialBus.transact(frame, cmd, timeoutMs, 1)
  } catch {
    return null
  }
}

function send(frame: number[]) {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return }
  void serialBus.sendRaw(frame).catch(() => {})
}
function pollSend(frame: number[]) {
  if (connected.value && !paramState.busy) void serialBus.sendRaw(frame).catch(() => {})
}

function readBasic() { send(buildReadBasicInfo()) }
function readCells() { send(buildReadCellVoltages()) }
function readHw() { send(buildReadHardwareVersion()) }
function readProtect() { send(buildReadProtectCounts()) }
// 芯片类型决定二级过流/短路保护下拉框的档位物理量，必须可靠读到。
// 嘉百达等设备在串口刚打开后首帧常被丢弃，故读取失败需补发重试。
async function readChip() {
  if (!connected.value) return
  for (let attempt = 0; attempt < 3; attempt++) {
    if (chipType.value != null || !connected.value) return
    const f = await request(buildReadChipType(), 0x00)
    if (f && f.valid && f.status === 0x00) return
    await new Promise((r) => setTimeout(r, 400))
  }
}

let pollTimer: number | null = null
function startPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (connected.value && autoPollProxy.value && !batchBusy.value) {
    pollTimer = window.setInterval(() => {
      pollSend(buildReadBasicInfo()); pollSend(buildReadCellVoltages())
    }, POLL_INTERVAL_MS)
  }
}
function onPollChange(v: boolean) {
  autoPollProxy.value = v
  startPoll()
}

// 批量参数操作期间暂停自动轮询；结束后恢复
watch(batchBusy, (busy) => {
  if (busy) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  } else {
    startPoll()
  }
})

// 链路熔断已随 jbdBus 退役：serialBus 采用一问一答 + 超时重试，不再维护连续超时熔断状态。

// ===== 连接后统一初始化序列（串行，避免多路并发涌队列）=====
// 此前连接建立瞬间有三路并发：App.startVerify 3×readBasic、JbdPanel.refreshAll
// 5 条、useJbd.readChip 3 次重试——同一时刻最多 11 条命令抢串行队列。
// 统一为：验证链路(读基本信息, 首帧丢弃补发) → 读芯片类型 → 拉取其余遥测。
let initRunning = false
async function initAfterConnect(): Promise<void> {
  if (initRunning) return
  initRunning = true
  try {
    // 1) 链路验证 + 首帧基本信息（sendAck 成功时 handleFrame 已更新 basicInfo，
    //    App.startVerify 的 watch(basicInfo) 据此判定「连接成功」）
    for (let i = 0; i < 3; i++) {
      if (!connected.value) return
      const f = await request(buildReadBasicInfo(), 0x03)
      if (f && f.valid && f.status === 0x00) break
      await new Promise((r) => setTimeout(r, 400))
    }
    // 2) 芯片类型（若未知；决定二级过流/短路档位物理量）
    if (chipType.value == null) await readChip()
    // 3) 其余遥测
    if (connected.value) {
      void serialBus.sendRaw(buildReadCellVoltages()).catch(() => {})
      void serialBus.sendRaw(buildReadHardwareVersion()).catch(() => {})
      void serialBus.sendRaw(buildReadProtectCounts()).catch(() => {})
    }
  } finally {
    initRunning = false
  }
}

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
      pushSample()
      break
    }
    case 0x04: cellVoltages.value = parseCellVoltages(f.data); break
    case 0x05: hwVersion.value = parseHardwareVersion(f.data); break
    case 0xaa: protectCounts.value = parseProtectCounts(f.data); break
    // 芯片类型：命令字 0x00 被「读芯片类型」与「进厂指令(写 0x00)」共用。
    // 读响应携带数据字节（1~2 字节，取最后一个为真实类型）；进厂写指令的 ACK 无数据载荷。
    // 因此绝不能以"收到 0x00 帧"来清空 chipType——否则强制下发等进厂动作会把芯片类型误清空，
    // 导致二级过流/短路保护下拉框被禁用。只有带数据的 0x00 帧才更新 chipType。
    case 0x00: if (f.data.length) chipType.value = f.data[f.data.length - 1]; break
    default:
      pushAck(`[0x${f.cmd.toString(16).padStart(2, '0')}] 成功`)
  }
}

// 参数层 busy 变化时暂停/恢复轮询（整包读写期间不与轮询抢总线）
watch(() => paramState.busy, (busy) => {
  if (busy) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  } else {
    startPoll()
  }
})

serialBus.onFrame((f) => handleFrame(f))

// 连接建立后执行统一初始化序列（含读芯片类型）。
// 芯片方案决定二级过流/短路保护下拉框的物理量档位，缺它会导致下拉全显示 0.00A 而误导用户。
// 用 detached effectScope 在模块级建立一次永久 watch，不依赖任何组件生命周期，
// 从而参数配置页也能可靠拿到芯片类型（不必依赖监控页的 refreshAll 触发）。
effectScope(true).run(() => {
  watch(connected, (isConnected) => {
    if (isConnected) void initAfterConnect()
  })
})

export function useJbd() {
  return {
    // 状态
    connected,
    basicInfo,
    cellVoltages, hwVersion, protectCounts, chipType,
    ackHistory, autoPollProxy, batchBusy,
    // 派生
    cellMax, cellMin, maxTemp, activeProtects, activeAlarms,
    socStatus, socLabel, tempStatus,
    protectList, chipTypeName,
    // 工具
    fmt, pad, cellClass, isBalancing,
    // 动作
    send, pollSend,
    readBasic, readCells, readHw, readProtect, readChip,
    onPollChange,
    restartPoll: startPoll,
  }
}
