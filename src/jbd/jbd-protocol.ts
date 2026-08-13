/**
 * 嘉佰达 (JBD) 软件板通用协议 V12 —— 上位机通讯逻辑（纯 TS，无 Node/Buffer 依赖）
 * 适用：RS485 / RS232 / UART（本上位机项目直接走串口）
 *
 * 帧结构：
 *   主机发送： 0xDD | 0xA5(读)/0x5A(写) | 命令码 | 长度 | 数据… | 校验H | 校验L | 0x77 | [CALLBACK_ID≤4B]
 *   BMS 响应： 0xDD | 命令码(回显)       | 状态位 | 长度 | 数据… | 校验H | 校验L | 0x77 | [CALLBACK_ID≤4B]
 *
 * 校验（已用文档示例反推验证）：
 *   发送帧被校验字节 = [命令码, 长度, 数据]（不含 0xA5/0x5A 标志）
 *   响应帧被校验字节 = [状态位, 长度, 数据]（不含回显命令码）
 *   上述字节求和 → 取反 + 1（二补码，16 位）→ 高位在前
 */

// ============================ 帧常量 ============================
export const FRAME_START = 0xdd
export const FRAME_END = 0x77
export const FLAG_READ = 0xa5
export const FLAG_WRITE = 0x5a

export const DEFAULT_FACTORY_PWD = 0x5678 // 进入工厂模式默认密码
export const EXIT_FACTORY_PWD = 0x2828 // 退出工厂模式密码

// ============================ 命令码 ============================
export const CMD = {
  CHIP_TYPE: 0x00, // 读：芯片类型；写：进入工厂模式(0x5678)
  BASIC_INFO: 0x03,
  CELL_VOLTAGE: 0x04,
  HARDWARE_VER: 0x05,
  BT_PAIR: 0x06,
  BT_PWD_MODIFY: 0x07,
  CONTROL: 0x0a,
  FACTORY_PWD: 0x0b,
  PROTECT_COUNT: 0xaa,
  MOS_CTRL: 0xfb,
  PARAM: 0xfa,
  INTERNAL_RES: 0xf6,
  HEATING: 0xfc,
  EXIT_FACTORY: 0x01,
} as const

// ============================ 响应状态位 ============================
export const STATUS = {
  SUCCESS: 0x00,
  FAIL: 0x80, // 命令码不存在
  INVALID: 0x81, // 操作无效(未进工厂模式/密码不匹配)
  CHECK_ERROR: 0x82,
  PWD_PAIR_ERR: 0x83,
  PWD_MODIFY_ERR: 0x84,
} as const

export const MOS_TYPE = {
  DISCHARGE: 0x00,
  CHARGE: 0x01,
  PRE_DISCHARGE: 0x03,
  CHARGE_DISCHARGE: 0x0a,
} as const
export const MOS_ACTION = {
  RELEASE: 0x00, // 解除软件关闭
  CLOSE: 0x01, // 软件关闭
} as const

export const CONTROL_FUNC = {
  RESET_CAPACITY: [0x01, 0x00],
  CLEAR_RECORD: [0x02, 0x00],
  RESET_MCU: [0x03, 0x00],
  CLEAR_PROTECT: [0x04, 0x00],
  SLEEP: [0x05, 0x00],
  POWER_DOWN: [0x06, 0x00],
  AUTO_BALANCE: [0x07, 0x00],
  STORAGE: [0x08, 0x00],
  SOC20_SWITCH: [0x09, 0x00],
  SOC20_FORCE: [0x0a, 0x00],
  FORCE_START: [0x0b, 0x00],
  FORCE_HEAT: [0x0c, 0x00],
} as const

// ============================ 基础工具 ============================
export function readU16(buf: number[], offset: number): number {
  return ((buf[offset] & 0xff) << 8) | (buf[offset + 1] & 0xff)
}
export function toSigned16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v
}
export function calcChecksum(checked: number[]): [number, number] {
  const sum = checked.reduce((a, b) => a + (b & 0xff), 0) & 0xffff
  const c = (0x10000 - sum) & 0xffff
  return [(c >> 8) & 0xff, c & 0xff]
}

// ============================ 帧构建 ============================
export function buildRead(reg: number, data: number[] = [], cbId?: number[]): number[] {
  const len = data.length & 0xff
  const [hi, lo] = calcChecksum([reg & 0xff, len, ...data])
  const frame = [FRAME_START, FLAG_READ, reg & 0xff, len, ...data, hi, lo, FRAME_END]
  if (cbId?.length) frame.push(...cbId)
  return frame
}
export function buildWrite(reg: number, data: number[], cbId?: number[]): number[] {
  const len = data.length & 0xff
  const [hi, lo] = calcChecksum([reg & 0xff, len, ...data])
  const frame = [FRAME_START, FLAG_WRITE, reg & 0xff, len, ...data, hi, lo, FRAME_END]
  if (cbId?.length) frame.push(...cbId)
  return frame
}

// ============================ 帧解析 ============================
export interface Frame {
  cmd: number
  status: number
  len: number
  data: number[]
  checksum: [number, number]
  callbackId: number[]
  valid: boolean
  /** 由帧总线 onceResponse 注入：true 表示等待超时（无响应） */
  timeout?: boolean
}
export function parseFrame(buf: ArrayLike<number>): Frame | null {
  const b = Array.from(buf)
  const start = b.indexOf(FRAME_START)
  if (start < 0) return null
  if (b.length < start + 7) return null

  const cmd = b[start + 1]
  const status = b[start + 2]
  const len = b[start + 3] & 0xff
  // 按长度字段定位帧尾，避免数据体中的 0x77 被误认为是帧结束
  const endIndex = start + 6 + len
  if (b.length < endIndex + 1) return null
  if (b[endIndex] !== FRAME_END) return null

  const data = b.slice(start + 4, start + 4 + len)
  const hi = b[start + 4 + len]
  const lo = b[start + 5 + len]
  const callbackId = b.slice(endIndex + 1)
  const [chi, clo] = calcChecksum([status, len, ...data])
  const valid = chi === hi && clo === lo
  return { cmd, status, len, data, checksum: [hi, lo], callbackId, valid }
}

// ============================ 指令构建器 ============================
export const buildReadBasicInfo = () => buildRead(CMD.BASIC_INFO)
export const buildReadCellVoltages = () => buildRead(CMD.CELL_VOLTAGE)
export const buildReadHardwareVersion = () => buildRead(CMD.HARDWARE_VER)
export const buildReadProtectCounts = () => buildRead(CMD.PROTECT_COUNT)
export const buildReadChipType = () => buildRead(CMD.CHIP_TYPE)
export const buildReadInternalRes = () => buildRead(CMD.INTERNAL_RES)
export function buildControlMOS(yy: number, xx: number): number[] {
  return buildWrite(CMD.MOS_CTRL, [yy & 0xff, xx & 0xff])
}
export function buildControlCommand(func: readonly number[]): number[] {
  return buildWrite(CMD.CONTROL, [func[0] & 0xff, func[1] & 0xff])
}
export function buildFactoryPwdModify(oldPwd: number, newPwd: number): number[] {
  return buildWrite(CMD.FACTORY_PWD, [
    (oldPwd >> 8) & 0xff, oldPwd & 0xff, (newPwd >> 8) & 0xff, newPwd & 0xff,
  ])
}
export const buildFactoryPwdClear = () => buildWrite(CMD.FACTORY_PWD, [0x5a, 0xa5])
export const buildEnterFactory = () => buildWrite(CMD.CHIP_TYPE, [0x56, 0x78])
export const buildExitFactory = () => buildWrite(CMD.EXIT_FACTORY, [0x28, 0x28])
export function buildReadParam(reg: number, count: number): number[] {
  return buildRead(CMD.PARAM, [(reg >> 8) & 0xff, reg & 0xff, count & 0xff])
}
export function buildWriteParam(reg: number, values: number[]): number[] {
  const count = values.length / 2
  return buildWrite(CMD.PARAM, [(reg >> 8) & 0xff, reg & 0xff, count & 0xff, ...values])
}
export function buildBtPair(password: number[]): number[] {
  return buildWrite(CMD.BT_PAIR, [0x06, ...password.map((d) => d & 0xff)])
}
export function buildBtPwdModify(oldPwd: number[], newPwd: number[]): number[] {
  return buildWrite(CMD.BT_PWD_MODIFY, [
    0x0c, ...oldPwd.map((d) => d & 0xff), ...newPwd.map((d) => d & 0xff),
  ])
}
export function buildHeating(xx: number, hh: number, mm: number, zz: number, ww: number): number[] {
  return buildWrite(CMD.HEATING, [xx & 0xff, hh & 0xff, mm & 0xff, zz & 0xff, ww & 0xff])
}
export function buildWriteInternalRes(values: number[]): number[] {
  return buildWrite(CMD.INTERNAL_RES, values)
}

// ============================ 响应解析器 ============================
export function parseCellVoltages(data: number[]): number[] {
  const cells: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) cells.push(readU16(data, i))
  return cells
}
export function parseHardwareVersion(data: number[]): string {
  return data.map((b) => String.fromCharCode(b & 0xff)).join('')
}
const PROTECT_FIELDS = [
  '短路保护', '充电过流', '放电过流', '单体过压', '单体欠压',
  '充电高温', '充电低温', '放电高温', '放电低温', '整体过压', '整体欠压', '系统重启',
]
export function parseProtectCounts(data: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  const n = Math.min(data.length / 2, PROTECT_FIELDS.length)
  for (let i = 0; i < n; i++) out[PROTECT_FIELDS[i]] = readU16(data, i * 2)
  return out
}
export function parseInternalRes(data: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) out.push(toSigned16(readU16(data, i)))
  return out
}
export interface BasicInfo {
  totalVoltage_mV: number
  current_mA: number
  remainingCapacity_mAh: number
  nominalCapacity_mAh: number
  cycleCount: number
  manufactureDate: { year: number; month: number; day: number }
  balanceLow: number
  balanceHigh: number
  protectStatus: number
  swVersion: string
  rsoc: number
  fet: { charge: boolean; discharge: boolean; currentLimit: boolean; heating: boolean; unit100: boolean }
  cellCount: number
  ntcCount: number
  temperatures_C: number[]
  humidity?: number
  alarmStatus?: number
  fullChargeCapacity_mAh?: number
  remainingCapacity2_mAh?: number
  balanceCurrent_mA?: number
}
export function parseBasicInfo(data: number[]): BasicInfo {
  let p = 0
  const totalVoltage_mV = readU16(data, p) * 10; p += 2
  const rawCurrent = readU16(data, p); p += 2
  const rawRemain = readU16(data, p); p += 2
  const rawNominal = readU16(data, p); p += 2
  const cycleCount = readU16(data, p); p += 2
  const dateRaw = readU16(data, p); p += 2
  const manufactureDate = {
    day: dateRaw & 0x1f,
    month: (dateRaw >> 5) & 0x0f,
    year: 2000 + (dateRaw >> 9),
  }
  const balanceLow = readU16(data, p); p += 2
  const balanceHigh = readU16(data, p); p += 2
  const protectStatus = readU16(data, p); p += 2
  const swVersion = ((data[p] >> 4) & 0x0f) + '.' + (data[p] & 0x0f); p += 1
  const rsoc = data[p]; p += 1
  const fetRaw = data[p]; p += 1
  const fet = {
    charge: !!(fetRaw & 0x01),
    discharge: !!(fetRaw & 0x02),
    currentLimit: !!(fetRaw & 0x04),
    heating: !!(fetRaw & 0x08),
    unit100: !!(fetRaw & 0x80),
  }
  const unitMul = fet.unit100 ? 100 : 10
  const cellCount = data[p]; p += 1
  const ntcCount = data[p]; p += 1
  const temperatures_C: number[] = []
  for (let i = 0; i < ntcCount && p + 1 < data.length; i++) {
    temperatures_C.push((readU16(data, p) - 2731) / 10)
    p += 2
  }
  let humidity: number | undefined
  let alarmStatus: number | undefined
  let fullChargeCapacity_mAh: number | undefined
  let remainingCapacity2_mAh: number | undefined
  let balanceCurrent_mA: number | undefined
  if (p < data.length) { humidity = data[p]; p += 1 }
  if (p + 1 < data.length) { alarmStatus = readU16(data, p); p += 2 }
  if (p + 1 < data.length) { fullChargeCapacity_mAh = readU16(data, p) * unitMul; p += 2 }
  if (p + 1 < data.length) { remainingCapacity2_mAh = readU16(data, p) * unitMul; p += 2 }
  if (p + 1 < data.length) { balanceCurrent_mA = readU16(data, p); p += 2 }
  return {
    totalVoltage_mV, current_mA: toSigned16(rawCurrent) * unitMul,
    remainingCapacity_mAh: rawRemain * unitMul, nominalCapacity_mAh: rawNominal * unitMul,
    cycleCount, manufactureDate, balanceLow, balanceHigh, protectStatus, swVersion,
    rsoc, fet, cellCount, ntcCount, temperatures_C, humidity, alarmStatus,
    fullChargeCapacity_mAh, remainingCapacity2_mAh, balanceCurrent_mA,
  }
}

export const PROTECT_BIT: Record<number, string> = {
  0: '单体过压保护', 1: '单体欠压保护', 2: '整组过压保护', 3: '整组欠压保护',
  4: '充电过温保护', 5: '充电低温保护', 6: '放电过温保护', 7: '放电低温保护',
  8: '充电过流保护', 9: '放电过流保护', 10: '短路保护', 11: '前端检测 IC 错误',
  12: '软件锁定 MOS', 13: '充电 MOS 击穿标志', 14: '放电 MOS 击穿标志', 15: '预留',
}

/**
 * 告警状态位图（BasicInfo.alarmStatus，U16，仅低 12 bit 有效）
 * bit0 单体高压告警
 * bit1 单体低压告警
 * bit2 整组高压告警
 * bit3 整组低压告警
 * bit4 充电高温告警
 * bit5 充电低温告警
 * bit6 放电高温告警
 * bit7 放电低温告警
 * bit8 充电电流大告警
 * bit9 放电电流大告警
 * bit10 单体压差大告警
 * bit11 容量低告警
 */
export const ALARM_BIT: Record<number, string> = {
  0: '单体高压告警', 1: '单体低压告警', 2: '整组高压告警', 3: '整组低压告警',
  4: '充电高温告警', 5: '充电低温告警', 6: '放电高温告警', 7: '放电低温告警',
  8: '充电电流大告警', 9: '放电电流大告警', 10: '单体压差大告警', 11: '容量低告警',
}

export function toHex(frame: number[]): string {
  return frame.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}
