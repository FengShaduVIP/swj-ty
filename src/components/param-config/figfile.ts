/**
 * 源程序（JBDTools_ChangePow）参数文件 `.fig` 格式
 * ------------------------------------------------------------
 * 纯文本、固定列宽、无表头，行分隔符是 **CR CR LF**（`\r\r\n`）。
 *
 * 单行结构：
 *   `"  "` + Key（左对齐，占 23 列，不足补空格）+ 数值 + `"\r\r\n"`
 *   即数值固定从第 26 个字符（1-based）/ 索引 25 开始。
 *
 * 实测样本（源程序导出，2179 字节 / 70 行）：
 *   `'  FileCode               3838\r\r\n'`
 *   `'  DesignCapacity         6000\r\r\n'`
 *   `'  CycleCapacity          4800\r\r\n'`
 *   ...
 *   `'  Chip_Type              1\r\r\n'`
 *
 * 所有数值都是**寄存器原始值**（未做界面换算），与 0xFA 读回的 u16 一一对应。
 * 三个 ASCII 块（ManufacturerName / DeviceName / BarCode）直接写字面文本。
 *
 * 与源程序的差异：`FileCode` 恒为 3838、`BalanceCurrent` 恒为 0，二者都不对应
 * 任何可读寄存器（源程序导出时同样如此），导入时忽略。
 */

export interface FigField {
  key: string
  /** 数值字段 → 寄存器索引 */
  reg?: number
  /** ASCII 字段 → ASCII 块起始寄存器 */
  ascii?: number
  /** 固定值（不对应寄存器，导出照抄源程序） */
  fixed?: number
  /** 芯片类型（由 0x00 指令读取，不是 0xFA 寄存器） */
  chip?: boolean
}

/** 字段顺序严格照源程序 .fig 的行序，不可调整 */
export const FIG_FIELDS: FigField[] = [
  { key: 'FileCode', fixed: 3838 },
  { key: 'DesignCapacity', reg: 0 },
  { key: 'CycleCapacity', reg: 1 },
  { key: 'FullChargeVol', reg: 2 },
  { key: 'ChargeEndVol', reg: 3 },
  { key: 'DischargingRate', reg: 4 },
  { key: 'ManufactureDate', reg: 5 },
  { key: 'SerialNumber', reg: 6 },
  { key: 'CycleCount', reg: 7 },
  { key: 'ChgOverTemp', reg: 8 },
  { key: 'ChgOTRelease', reg: 9 },
  { key: 'ChgLowTemp', reg: 10 },
  { key: 'ChgUTRelease', reg: 11 },
  { key: 'DisOverTemp', reg: 12 },
  { key: 'DsgOTRelease', reg: 13 },
  { key: 'DisLowTemp', reg: 14 },
  { key: 'DsgUTRelease', reg: 15 },
  { key: 'PackOverVoltage', reg: 16 },
  { key: 'PackOVRelease', reg: 17 },
  { key: 'PackUnderVoltage', reg: 18 },
  { key: 'PackUVRelease', reg: 19 },
  { key: 'CellOverVoltage', reg: 20 },
  { key: 'CellOVRelease', reg: 21 },
  { key: 'CellUnderVoltage', reg: 22 },
  { key: 'CellUVRelease', reg: 23 },
  { key: 'OverChargeCurrent', reg: 24 },
  { key: 'OverDisCurrent', reg: 25 },
  { key: 'BalanceStartVoltage', reg: 26 },
  { key: 'BalanceWindow', reg: 27 },
  { key: 'SenseResistor', reg: 28 },
  { key: 'BatteryConfig', reg: 29 },
  { key: 'NtcConfig', reg: 30 },
  { key: 'PackNum', reg: 31 },
  { key: 'fet_ctrl_time_set', reg: 32 },
  { key: 'led_disp_time_set', reg: 33 },
  { key: 'VoltageCap80', reg: 34 },
  { key: 'VoltageCap60', reg: 35 },
  { key: 'VoltageCap40', reg: 36 },
  { key: 'VoltageCap20', reg: 37 },
  { key: 'HardCellOverVoltage', reg: 38 },
  { key: 'HardCellUnderVoltage', reg: 39 },
  { key: 'HardChgOverCurrent', reg: 40 },
  { key: 'HardDsgOverCurrent', reg: 41 },
  { key: 'HardTime', reg: 42 },
  { key: 'SCReleaseTime', reg: 43 },
  { key: 'ChgUTDelay', reg: 44 },
  { key: 'ChgOTDelay', reg: 45 },
  { key: 'DsgUTDelay', reg: 46 },
  { key: 'DsgOTDelay', reg: 47 },
  { key: 'PackUVDelay', reg: 48 },
  { key: 'PackOVDelay', reg: 49 },
  { key: 'CellUVDelay', reg: 50 },
  { key: 'CellOVDelay', reg: 51 },
  { key: 'ChgOCDelay', reg: 52 },
  { key: 'ChgOCRDelay', reg: 53 },
  { key: 'DsgOCDelay', reg: 54 },
  { key: 'DsgOCRDelay', reg: 55 },
  { key: 'ManufacturerName', ascii: 56 },
  { key: 'DeviceName', ascii: 72 },
  { key: 'BarCode', ascii: 88 },
  { key: 'GPS_VOL', reg: 104 },
  { key: 'GPS_TIME', reg: 105 },
  { key: 'VoltageCap90', reg: 106 },
  { key: 'VoltageCap70', reg: 107 },
  { key: 'VoltageCap50', reg: 108 },
  { key: 'VoltageCap30', reg: 109 },
  { key: 'VoltageCap10', reg: 110 },
  { key: 'VoltageCap100', reg: 111 },
  { key: 'BalanceCurrent', fixed: 0 },
  { key: 'Chip_Type', chip: true }
]

const PREFIX = '  '
const KEY_WIDTH = 23
const EOL = '\r\r\n'
/** 数值起始列（0-based） */
const VALUE_COL = 25

/** 生成与源程序完全一致的 .fig 文本 */
export function buildFig(
  regs: number[],
  ascii: Record<number, string>,
  chipType: number
): string {
  const rows = FIG_FIELDS.map((f) => {
    let v: string | number = 0
    if (f.chip) v = chipType
    else if (f.ascii !== undefined) v = ascii[f.ascii] ?? ''
    else if (f.reg !== undefined) v = (regs[f.reg] ?? 0) & 0xffff
    else v = f.fixed ?? 0
    return PREFIX + f.key.padEnd(KEY_WIDTH, ' ') + v + EOL
  })
  return rows.join('')
}

/** 粗略判断一段文本是否为 .fig 参数文件 */
export function isFigText(text: string): boolean {
  return /^ {2}FileCode\s/m.test(text) || (/DesignCapacity/.test(text) && /CellOverVoltage/.test(text))
}

export interface FigParsed {
  /** 已按寄存器索引铺开的 184 项（缺项为 undefined） */
  regs: (number | undefined)[]
  ascii: Record<number, string>
  chipType?: number
  /** 命中字段数，用于提示 */
  hit: number
  unknownKeys: string[]
}

/**
 * 解析 .fig 文本。
 * 只取能识别到寄存器的行，其余（FileCode / BalanceCurrent / 未知键）忽略，
 * 这样既兼容源程序文件，也不会因源程序增删无关字段而失败。
 */
export function parseFig(text: string): FigParsed {
  const regs: (number | undefined)[] = new Array(184).fill(undefined)
  const ascii: Record<number, string> = {}
  const unknownKeys: string[] = []
  let chipType: number | undefined
  let hit = 0

  const byKey = new Map(FIG_FIELDS.map((f) => [f.key, f]))
  const lines = text.split(/\r\r\n|\r\n|\n/)

  for (const raw of lines) {
    if (!raw.trim()) continue
    const key = raw.slice(2, VALUE_COL).trim()
    const value = raw.slice(VALUE_COL).trim()
    if (!key) continue
    const f = byKey.get(key)
    if (!f) {
      unknownKeys.push(key)
      continue
    }
    if (f.chip) {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n)) {
        chipType = n
        hit++
      }
      continue
    }
    if (f.ascii !== undefined) {
      ascii[f.ascii] = value
      hit++
      continue
    }
    if (f.reg !== undefined) {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n)) {
        regs[f.reg] = n & 0xffff
        hit++
      }
      continue
    }
    // fixed 字段（FileCode / BalanceCurrent）：不参与写入
  }

  return { regs, ascii, chipType, hit, unknownKeys }
}

/** 源程序使用的文件名：Alf-YYYYMMDDhhmmss.fig */
export function figFileName(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp =
    p(d.getFullYear(), 4) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  return `Alf-${stamp}.fig`
}
