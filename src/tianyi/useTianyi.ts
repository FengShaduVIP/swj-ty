import { ref, computed, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  buildReadHoldingRegisters, buildReadInputRegisters,
  parsePackInfo, parseCellVoltages, parseTemperatures,
  parseDeviceInfo, parseStatus1, parseAlarm,
  REG, PROTECT_BIT, ALARM1_BIT, ALARM2_BIT,
  type PackInfo, type DeviceInfo, type StatusFlags,
} from './tianyi-protocol'
import { tianyiBus } from './tianyi-bus'
import { ui, pushSample } from '../store'

// ============================================================
// 模块级单例状态：天一 Modbus-RTU 实时监测页共享
// ============================================================
const connected = computed(() => ui.conn === 'connected')

const packInfo = ref<PackInfo | null>(null)
const cellVoltages = ref<number[]>([])
const temperatures = ref<number[]>([])
const deviceInfo = ref<DeviceInfo | null>(null)
const lastUpdateAt = ref<string>('--:--:--')
const commFault = ref(false)

// 从机地址与协议选择统一由 store 管理，避免单例与 UI 不同步
const slaveAddr = computed(() => ui.slaveAddr)

// 趋势历史
const MAX_HISTORY = 120
export interface Sample {
  t: number
  voltage: number
  current: number
  power: number
  soc: number
}
const history: Ref<Sample[]> = ref<Sample[]>([])

// ===== 派生 =====
const cellMax = computed(() => (cellVoltages.value.length ? Math.max(...cellVoltages.value) : 0))
const cellMin = computed(() => (cellVoltages.value.length ? Math.min(...cellVoltages.value) : 0))
const tempMax = computed(() => (temperatures.value.length ? Math.max(...temperatures.value) : null))
const tempMin = computed(() => (temperatures.value.length ? Math.min(...temperatures.value) : null))

const statusFlags = computed<StatusFlags>(() => {
  if (!packInfo.value) {
    return {
      batteryState: 0, batteryStateText: '静置',
      chargeSwitch: false, dischargeSwitch: false, heatSwitch: false,
      lowPower: false, chargeFail: false, dischargeFail: false, heatFail: false,
    }
  }
  return parseStatus1(packInfo.value.status1)
})

const activeProtects = computed(() => {
  if (!packInfo.value) return []
  const out: { bit: number; name: string }[] = []
  for (let bit = 0; bit < 16; bit++) {
    if (packInfo.value!.protect1 & (1 << bit)) {
      out.push({ bit, name: PROTECT_BIT[bit] || `bit${bit}` })
    }
  }
  return out
})

const activeAlarms = computed(() => {
  if (!packInfo.value) return []
  return [
    ...parseAlarm(packInfo.value.alarm1, ALARM1_BIT),
    ...parseAlarm(packInfo.value.alarm2, ALARM2_BIT),
  ]
})

const fmt = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '--' : v.toFixed(d))
const pad = (n: number) => String(n).padStart(2, '0')

function updateClock() {
  const now = new Date()
  lastUpdateAt.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function recordSample() {
  if (!packInfo.value) return
  pushSample()
  history.value.push({
    t: Date.now(),
    voltage: packInfo.value.voltage_V,
    current: packInfo.value.current_A,
    power: packInfo.value.power_W,
    soc: packInfo.value.soc,
  })
  if (history.value.length > MAX_HISTORY) history.value = history.value.slice(-MAX_HISTORY)
}

function clearTrend() { history.value = [] }

// ===== 发送 =====
function send(frame: number[]) {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return }
  tianyiBus.send(frame)
}
function sendAck(frame: number[], timeoutMs = 1500) {
  if (!connected.value) { ElMessage.warning('请先连接串口'); return Promise.reject(new Error('未连接')) }
  return tianyiBus.sendAck(frame, timeoutMs)
}

function readPackInfo() { send(buildReadHoldingRegisters(slaveAddr.value, REG.PACK_INFO_START, REG.PACK_INFO_COUNT)) }
function readCellVoltages(count: number) { send(buildReadHoldingRegisters(slaveAddr.value, REG.CELL_VOLT_START, count)) }
function readTemperatures(count: number) { send(buildReadHoldingRegisters(slaveAddr.value, REG.CELL_TEMP_START, count)) }
async function readDeviceInfo() {
  // 分多次读取：名称 + IMEI/IMSI/CCID + 各版本号；串行化并等待应答
  const jobs = [
    { start: REG.DEVICE_INFO_START, count: REG.DEVICE_INFO_COUNT },
    { start: REG.IMEI_START, count: REG.IMEI_COUNT },
    { start: REG.IMSI_START, count: REG.IMSI_COUNT },
    { start: REG.CCID_START, count: REG.CCID_COUNT },
    { start: REG.EC_SW_START, count: REG.EC_SW_COUNT },
    { start: REG.EC_HW_START, count: REG.EC_HW_COUNT },
    { start: REG.BMS_SW_START, count: REG.BMS_SW_COUNT },
    { start: REG.BMS_HW_START, count: REG.BMS_HW_COUNT },
  ]
  const results: number[][] = []
  for (const j of jobs) {
    const f = await sendAck(buildReadHoldingRegisters(slaveAddr.value, j.start, j.count))
    if (f.timeout || f.exception) {
      results.push([])
      continue
    }
    results.push(f.data)
  }
  deviceInfo.value = parseDeviceInfo(
    results[0], results[1], results[2], results[3],
    results[4], results[5], results[6], results[7],
  )
}

// ===== 轮询 =====
let pollTimer: number | null = null
let faultTimer: number | null = null
const POLL_PERIOD_MS = 1500
const FAULT_TIMEOUT_MS = 3000

async function pollOnce() {
  if (!connected.value) return
  try {
    // 电池信息
    const f0 = await sendAck(buildReadHoldingRegisters(slaveAddr.value, REG.PACK_INFO_START, REG.PACK_INFO_COUNT))
    if (f0.timeout || f0.exception) {
      commFault.value = true
      markFault()
      return
    }
    if (f0.func === 0x03 && f0.data.length >= REG.PACK_INFO_COUNT * 2) {
      packInfo.value = parsePackInfo(f0.data)
      ui.live.totalVoltage_V = packInfo.value.voltage_V
      ui.live.current_A = packInfo.value.current_A
      ui.live.soc = packInfo.value.soc
      ui.live.maxTemp_C = temperatures.value.length ? Math.max(...temperatures.value) : null
      ui.live.cellCount = packInfo.value.cellNum
      ui.alarmCount = activeProtects.value.length + activeAlarms.value.length
      updateClock()
      recordSample()
    }

    // 单体电压
    const cellCount = packInfo.value?.cellNum || 0
    if (cellCount > 0) {
      const f1 = await sendAck(buildReadHoldingRegisters(slaveAddr.value, REG.CELL_VOLT_START, cellCount))
      if (!f1.timeout && !f1.exception && f1.func === 0x03) {
        cellVoltages.value = parseCellVoltages(f1.data)
      }
    }

    // 温度
    const tempCount = packInfo.value?.tempNum || 0
    if (tempCount > 0) {
      const f2 = await sendAck(buildReadHoldingRegisters(slaveAddr.value, REG.CELL_TEMP_START, tempCount))
      if (!f2.timeout && !f2.exception && f2.func === 0x03) {
        temperatures.value = parseTemperatures(f2.data)
        if (packInfo.value) {
          ui.live.maxTemp_C = temperatures.value.length ? Math.max(...temperatures.value) : null
        }
      }
    }

    commFault.value = false
    clearFaultTimer()
  } catch (e) {
    commFault.value = true
    markFault()
  }
}

function markFault() {
  clearFaultTimer()
  faultTimer = window.setTimeout(() => {
    commFault.value = true
  }, FAULT_TIMEOUT_MS)
}

function clearFaultTimer() {
  if (faultTimer) { clearTimeout(faultTimer); faultTimer = null }
}

function startPoll() {
  stopPoll()
  // 首次立即执行一次
  void pollOnce()
  pollTimer = window.setInterval(() => {
    void pollOnce()
  }, POLL_PERIOD_MS)
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  clearFaultTimer()
}

function onConnChange(connectedNow: boolean) {
  if (connectedNow) {
    startPoll()
    // 设备信息只读一次，延迟启动避免阻塞首次实时数据轮询
    window.setTimeout(() => { void readDeviceInfo() }, 2000)
  } else {
    stopPoll()
    packInfo.value = null
    cellVoltages.value = []
    temperatures.value = []
    commFault.value = false
    clearTrend()
  }
}

// ===== 帧分发 =====
function handleFrame(f: ReturnType<typeof import('./tianyi-protocol')['parseModbusFrame']>) {
  if (!f || f.timeout) return
  if (f.exception) {
    ElMessage.warning(`从机 0x${f.slave.toString(16).padStart(2, '0')} 异常应答: 功能码 0x${f.func.toString(16).padStart(2, '0')} 异常码 ${f.exceptionCode}`)
    return
  }
  if (!f.crcOk) return
  if (f.func !== 0x03) return

  // 根据起始地址判断数据归属（简单按数据长度回推不现实，这里依赖发送时的全局状态不现实；
  // 因此采用「注册预期」机制：发送 readDeviceInfo 等一次性读取时由调用方自己处理应答。
  // 监测轮询的 pack/cell/temp 已在 pollOnce 内通过 sendAck 顺序配对。）
}

let busSub: (() => void) | null = null
if (!busSub) busSub = tianyiBus.onFrame((f) => handleFrame(f))

export function useTianyi() {
  return {
    // 状态
    packInfo, cellVoltages, temperatures, deviceInfo,
    lastUpdateAt, commFault, slaveAddr, history,
    // 派生
    cellMax, cellMin, tempMax, tempMin,
    statusFlags, activeProtects, activeAlarms,
    // 工具
    fmt, pad,
    // 动作
    readPackInfo, readCellVoltages, readTemperatures, readDeviceInfo,
    startPoll, stopPoll, onConnChange, clearTrend,
  }
}
