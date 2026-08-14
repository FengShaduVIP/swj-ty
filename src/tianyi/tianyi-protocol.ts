/**
 * 天一 (TIANYI) 协议 —— 标准 Modbus-RTU 上位机通讯逻辑（纯 TS，无 Node/Buffer 依赖）
 * 适用：RS485 / RS232 / UART
 *
 * 帧结构：
 *   [从机地址 1B][功能码 1B][数据 nB][CRC 低 1B][CRC 高 1B]
 *
 * 校验：标准 Modbus CRC16（poly 0x8005 / init 0xFFFF / 低字节在前）
 */

// ============================ 功能码 ============================
export const FUNC = {
  READ_HOLDING: 0x03,   // 读保持寄存器（A000/A100/A300/A400/A500...）
  READ_INPUT: 0x04,     // 读输入寄存器（AA00 实时上报）
  WRITE_SINGLE: 0x06,   // 写单个寄存器
  WRITE_MULTIPLE: 0x10, // 写多个寄存器
} as const

export const DEFAULT_SLAVE_ADDR = 0x01

// ============================ 寄存器地址 ============================
export const REG = {
  // 电池信息区 A000–A0FF
  PACK_INFO_START: 0xA000,
  PACK_INFO_COUNT: 0x2F, // 读 47 个寄存器到 A02E

  // 单体电压区 A100–A1FF（动态数量，由 CellNum 决定）
  CELL_VOLT_START: 0xA100,

  // 单体温度区 A300–A3FF（动态数量，由 TempNum 决定）
  CELL_TEMP_START: 0xA300,

  // 设备/用户信息区 A400–A4FF
  DEVICE_INFO_START: 0xA400,
  DEVICE_INFO_COUNT: 0x10, // 读 16 个寄存器（名称 16 字）
  IMEI_START: 0xA418,
  IMEI_COUNT: 8,
  IMSI_START: 0xA420,
  IMSI_COUNT: 8,
  CCID_START: 0xA428,
  CCID_COUNT: 10,
  EC_SW_START: 0xA432,
  EC_SW_COUNT: 8,
  EC_HW_START: 0xA43A,
  EC_HW_COUNT: 8,
  BMS_SW_START: 0xA442,
  BMS_SW_COUNT: 8,
  BMS_HW_START: 0xA44A,
  BMS_HW_COUNT: 8,
} as const

// ============================ 基础工具 ============================
export function readU16(buf: number[], offset: number): number {
  return ((buf[offset] & 0xff) << 8) | (buf[offset + 1] & 0xff)
}

/** 32 位值：小端拼接（首寄存器 = 低字） */
export function readU32(buf: number[], offset: number): number {
  const low = readU16(buf, offset)
  const high = readU16(buf, offset + 2)
  return (high << 16) | low
}

export function toSigned16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v
}

export function calcCrc16(data: number[]): [number, number] {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b & 0xff
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001
      } else {
        crc >>= 1
      }
    }
  }
  return [crc & 0xff, (crc >> 8) & 0xff]
}

// ============================ 帧构建 ============================
export function buildReadHoldingRegisters(slave: number, start: number, count: number): number[] {
  const payload = [slave & 0xff, FUNC.READ_HOLDING, (start >> 8) & 0xff, start & 0xff, (count >> 8) & 0xff, count & 0xff]
  const [lo, hi] = calcCrc16(payload)
  return [...payload, lo, hi]
}

export function buildReadInputRegisters(slave: number, start: number, count: number): number[] {
  const payload = [slave & 0xff, FUNC.READ_INPUT, (start >> 8) & 0xff, start & 0xff, (count >> 8) & 0xff, count & 0xff]
  const [lo, hi] = calcCrc16(payload)
  return [...payload, lo, hi]
}

export function buildWriteSingleRegister(slave: number, reg: number, value: number): number[] {
  const payload = [slave & 0xff, FUNC.WRITE_SINGLE, (reg >> 8) & 0xff, reg & 0xff, (value >> 8) & 0xff, value & 0xff]
  const [lo, hi] = calcCrc16(payload)
  return [...payload, lo, hi]
}

export function buildWriteMultipleRegisters(slave: number, start: number, values: number[]): number[] {
  const count = values.length
  const bytes = count * 2
  const payload = [
    slave & 0xff, FUNC.WRITE_MULTIPLE,
    (start >> 8) & 0xff, start & 0xff,
    (count >> 8) & 0xff, count & 0xff,
    bytes & 0xff,
  ]
  for (const v of values) {
    payload.push((v >> 8) & 0xff, v & 0xff)
  }
  const [lo, hi] = calcCrc16(payload)
  return [...payload, lo, hi]
}

// ============================ 指令说明（通信日志用）============================
export function describeFrame(frame: number[]): string {
  if (!frame || frame.length < 4) return ''
  const slave = frame[0] & 0xff
  const func = frame[1] & 0xff
  const funcName: Record<number, string> = {
    [FUNC.READ_HOLDING]: '读保持',
    [FUNC.READ_INPUT]: '读输入',
    [FUNC.WRITE_SINGLE]: '写单寄存器',
    [FUNC.WRITE_MULTIPLE]: '写多寄存器',
  }
  if (func === FUNC.READ_HOLDING || func === FUNC.READ_INPUT) {
    const start = (frame[2] << 8) | frame[3]
    const count = (frame[4] << 8) | frame[5]
    return `从机${slave.toString(16).padStart(2, '0')} ${funcName[func] || '0x' + func.toString(16)} 0x${start.toString(16).toUpperCase().padStart(4, '0')}×${count}`
  }
  if (func === FUNC.WRITE_SINGLE) {
    const reg = (frame[2] << 8) | frame[3]
    return `从机${slave.toString(16).padStart(2, '0')} 写单 0x${reg.toString(16).toUpperCase().padStart(4, '0')}`
  }
  if (func === FUNC.WRITE_MULTIPLE) {
    const start = (frame[2] << 8) | frame[3]
    const count = (frame[4] << 8) | frame[5]
    return `从机${slave.toString(16).padStart(2, '0')} 写多 0x${start.toString(16).toUpperCase().padStart(4, '0')}×${count}`
  }
  return `从机${slave.toString(16).padStart(2, '0')} 功能码0x${func.toString(16)}`
}

// ============================ 帧解析 ============================
export interface ModbusFrame {
  slave: number
  func: number
  data: number[]
  crcOk: boolean
  exception?: boolean
  exceptionCode?: number
  /** 由总线在超时未响应时注入 */
  timeout?: boolean
}

export function parseModbusFrame(buf: number[]): ModbusFrame | null {
  if (!buf || buf.length < 5) return null
  const slave = buf[0] & 0xff
  const func = buf[1] & 0xff
  const exception = !!(func & 0x80)
  const actualFunc = exception ? func & 0x7f : func

  let data: number[]
  if (exception) {
    if (buf.length < 5) return null
    data = buf.slice(2, 3)
  } else if (actualFunc === FUNC.READ_HOLDING || actualFunc === FUNC.READ_INPUT) {
    const byteCount = buf[2] & 0xff
    if (buf.length < 3 + byteCount + 2) return null
    data = buf.slice(3, 3 + byteCount)
  } else if (actualFunc === FUNC.WRITE_SINGLE) {
    if (buf.length < 8) return null
    data = buf.slice(2, 6)
  } else if (actualFunc === FUNC.WRITE_MULTIPLE) {
    if (buf.length < 8) return null
    data = buf.slice(2, 6)
  } else {
    // 未知功能码，按整帧数据区估算
    if (buf.length < 5) return null
    data = buf.slice(2, buf.length - 2)
  }

  const frameWithoutCrc = buf.slice(0, buf.length - 2)
  const [lo, hi] = calcCrc16(frameWithoutCrc)
  const crcOk = lo === (buf[buf.length - 2] & 0xff) && hi === (buf[buf.length - 1] & 0xff)

  return {
    slave,
    func: actualFunc,
    data,
    crcOk,
    exception,
    exceptionCode: exception ? data[0] : undefined,
  }
}

// ============================ 标志位定义 ============================
export const PROTECT_BIT: Record<number, string> = {
  0: '电压断线', 1: '温度断线', 2: 'MOS温度高', 3: '压差保护',
  4: '短路保护', 5: '放电过流2', 6: '放电过流1', 7: '单体欠压',
  8: '总压欠压', 9: '放电高温', 10: '放电低温', 11: '充电过流',
  12: '单体过压', 13: '总压过压', 14: '充电高温', 15: '充电低温',
}

/** Alarm1 bit 位号 → 名称（每 2 bit 一个告警，这里取 bit 起点） */
export const ALARM1_BIT: Record<number, string> = {
  0: '电压断线', 2: '温度断线', 4: 'MOS温度高', 6: '压差保护',
  8: '短路保护', 10: '放电过流2', 12: '放电过流1', 14: '单体欠压',
}
export const ALARM2_BIT: Record<number, string> = {
  0: '总压欠压', 2: '放电高温', 4: '放电低温', 6: '充电过流',
  8: '单体过压', 10: '总压过压', 12: '充电高温', 14: '充电低温',
}

export const BATTERY_STATE_TEXT: Record<number, string> = {
  0: '静置', 1: '放电中', 2: '充电中', 3: '充满', 4: '欠压', 5: '保护', 6: '故障',
}

// ============================ 数据解析器 ============================
export interface PackInfo {
  cellNum: number
  tempNum: number
  voltage_V: number
  current_A: number
  power_W: number
  balCurrent_mA: number
  balNum: number
  vMax_mV: number
  vMaxNum: number
  vMin_mV: number
  vMinNum: number
  tMax_C: number
  tMaxNum: number
  tMin_C: number
  tMinNum: number
  tMos_C: number
  tBal_C: number
  rateCap_Ah: number
  fcc_Ah: number
  rc_Ah: number
  soc: number
  soh: number
  chgRemTime_min: number
  dsgRemTime_min: number
  cycleCount: number
  runTime_min: number
  tcap_Ah: number
  dayChgKwh: number
  dayDsgKwh: number
  totalChgKwh: number
  totalDsgKwh: number
  protect1: number
  protect2: number
  alarm1: number
  alarm2: number
  status1: number
  status2: number
  ym: number
  dh: number
  mm: number
}

export function parsePackInfo(data: number[]): PackInfo {
  const d = data
  return {
    cellNum: readU16(d, 0),
    tempNum: readU16(d, 2),
    voltage_V: readU16(d, 4) * 0.1,
    current_A: (readU16(d, 6) - 10000) * 0.1,
    power_W: (readU16(d, 8) - 10000) * 0.01 * 1000,
    balCurrent_mA: (readU16(d, 10) - 10000) * 1,
    balNum: readU16(d, 12),
    vMax_mV: readU16(d, 14),
    vMaxNum: readU16(d, 16),
    vMin_mV: readU16(d, 18),
    vMinNum: readU16(d, 20),
    tMax_C: (readU16(d, 22) - 400) * 0.1,
    tMaxNum: readU16(d, 24),
    tMin_C: (readU16(d, 26) - 400) * 0.1,
    tMinNum: readU16(d, 28),
    tMos_C: (readU16(d, 30) - 400) * 0.1,
    tBal_C: (readU16(d, 32) - 400) * 0.1,
    rateCap_Ah: readU16(d, 34) * 0.1,
    fcc_Ah: readU16(d, 36) * 0.1,
    rc_Ah: readU16(d, 38) * 0.1,
    soc: readU16(d, 40),
    soh: readU16(d, 42),
    chgRemTime_min: readU16(d, 44),
    dsgRemTime_min: readU16(d, 46),
    cycleCount: readU32(d, 48),
    runTime_min: readU32(d, 52),
    tcap_Ah: readU32(d, 56),
    dayChgKwh: readU32(d, 60) * 0.1,
    dayDsgKwh: readU32(d, 64) * 0.1,
    totalChgKwh: readU32(d, 68) * 0.1,
    totalDsgKwh: readU32(d, 72) * 0.1,
    protect1: readU16(d, 76),
    protect2: readU16(d, 78),
    alarm1: readU16(d, 80),
    alarm2: readU16(d, 82),
    status1: readU16(d, 84),
    status2: readU16(d, 86),
    ym: readU16(d, 88),
    dh: readU16(d, 90),
    mm: readU16(d, 92),
  }
}

export function parseCellVoltages(data: number[]): number[] {
  const cells: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) cells.push(readU16(data, i))
  return cells
}

export function parseTemperatures(data: number[]): number[] {
  const temps: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) {
    temps.push((readU16(data, i) - 400) * 0.1)
  }
  return temps
}

export interface DeviceInfo {
  name: string
  imei: string
  imsi: string
  ccid: string
  ecSw: string
  ecHw: string
  bmsSw: string
  bmsHw: string
}

function parseAscii(data: number[]): string {
  let s = ''
  for (let i = 0; i + 1 < data.length; i += 2) {
    const hi = data[i] & 0xff
    const lo = data[i + 1] & 0xff
    if (hi === 0 && lo === 0) continue
    s += String.fromCharCode(hi || 0)
    if (lo) s += String.fromCharCode(lo)
  }
  return s.trim() || '--'
}

function parseUtf8FromU16(data: number[]): string {
  const bytes: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) {
    bytes.push(data[i] & 0xff, data[i + 1] & 0xff)
  }
  try {
    const txt = new TextDecoder('utf-8').decode(new Uint8Array(bytes))
    return txt.replace(/\0/g, '').trim() || '--'
  } catch {
    return parseAscii(data)
  }
}

export function parseDeviceInfo(
  nameData: number[],
  imeiData: number[],
  imsiData: number[],
  ccidData: number[],
  ecSwData: number[],
  ecHwData: number[],
  bmsSwData: number[],
  bmsHwData: number[],
): DeviceInfo {
  return {
    name: parseUtf8FromU16(nameData),
    imei: parseAscii(imeiData),
    imsi: parseAscii(imsiData),
    ccid: parseAscii(ccidData),
    ecSw: parseAscii(ecSwData),
    ecHw: parseAscii(ecHwData),
    bmsSw: parseAscii(bmsSwData),
    bmsHw: parseAscii(bmsHwData),
  }
}

// ============================ Status1 解析 ============================
export interface StatusFlags {
  /** 0静置 1放电中 2充电中 3充满 4欠压 5保护 6故障 */
  batteryState: number
  batteryStateText: string
  chargeSwitch: boolean
  dischargeSwitch: boolean
  heatSwitch: boolean
  lowPower: boolean
  chargeFail: boolean
  dischargeFail: boolean
  heatFail: boolean
}

export function parseStatus1(status1: number): StatusFlags {
  return {
    batteryState: status1 & 0x0f,
    batteryStateText: BATTERY_STATE_TEXT[status1 & 0x0f] || `状态${status1 & 0x0f}`,
    chargeSwitch: !!((status1 >> 4) & 0x01),
    dischargeSwitch: !!((status1 >> 6) & 0x01),
    heatSwitch: !!((status1 >> 8) & 0x01),
    lowPower: !!((status1 >> 10) & 0x01),
    chargeFail: !!((status1 >> 11) & 0x01),
    dischargeFail: !!((status1 >> 12) & 0x01),
    heatFail: !!((status1 >> 13) & 0x01),
  }
}

// ============================ 告警等级解析 ============================
export interface AlarmItem {
  bit: number
  name: string
  level: number // 0-3
}

export function parseAlarm(value: number, bitMap: Record<number, string>): AlarmItem[] {
  const out: AlarmItem[] = []
  for (let bit = 0; bit < 16; bit += 2) {
    const level = (value >> bit) & 0x03
    if (level > 0) {
      out.push({ bit, name: bitMap[bit] || `bit${bit}`, level })
    }
  }
  return out
}

// ============================ 工具 ============================
export function toHex(frame: number[]): string {
  return frame.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

export function formatDateTime(ym: number, dh: number, mm: number): string {
  const year = (ym >> 8) & 0xff
  const month = ym & 0xff
  const day = (dh >> 8) & 0xff
  const hour = dh & 0xff
  const minute = (mm >> 8) & 0xff
  const second = mm & 0xff
  return `20${year.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
}
