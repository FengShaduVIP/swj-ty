/**
 * 嘉佰达 0xFA 参数寄存器表（来自协议 V12 文档第五、六章）
 * 每个寄存器为 2 字节；ASCII 块为多寄存器连续存储，首字节为长度。
 *
 * 换算说明（关键）：
 *   - scale : 线性参数「每 1 个原始单位 = 多少显示值」。display = raw * scale。
 *             例：标称容量 unit 0.01AH → scale 0.01（raw 3000 = 30.00 Ah）；
 *                 总压 10mV → scale 0.01（raw 420 = 4.20 V）；
 *                 过流 10mA → scale 10（raw 100 = 1000 mA）。
 *   - signed: 是否按补码解析（如放电过流）。
 *   - kind  : 特殊类型
 *       'temp'   → 绝对开尔文 0.1K，display = (raw-2731)/10 ℃
 *       'shunt'  → 检流电阻：bit15=1 时单位 0.01mR，否则 0.1mR
 *       'bitmap' → 功能/探头配置位，按十六进制展示
 *       'date'   → 生产日期，按位拆解
 *       'raw'    → 原始值（见 IC 类型等），不做换算
 *   无 kind 且 scale 缺省为 1（mV / S / 次 等整数单位）。
 */

export type ParamKind = 'temp' | 'shunt' | 'bitmap' | 'date' | 'raw'

export interface ParamDef {
  index: number
  name: string
  /** 友好显示单位（换算后的单位），如 Ah / V / ℃ / mV / mA / S */
  unit?: string
  /** 线性比例系数：display = raw * scale */
  scale?: number
  /** 是否补码 */
  signed?: boolean
  /** 特殊类型 */
  kind?: ParamKind
  /** 以 ASCII 字符串方式读写 */
  ascii?: boolean
}

function toSigned16(v: number): number {
  v &= 0xffff
  return v >= 0x8000 ? v - 0x10000 : v
}

// 单寄存器参数（0~55）
const SINGLE: Omit<ParamDef, 'index'>[] = [
  { name: '标称容量', unit: 'Ah', scale: 0.01 },
  { name: '循环容量', unit: 'Ah', scale: 0.01 },
  { name: '充满电压', unit: 'mV', scale: 1 },
  { name: '放空电压', unit: 'mV', scale: 1 },
  { name: '系统功耗', unit: 'mA', scale: 1 },
  { name: '生产日期', kind: 'date' },
  { name: '序列号' },
  { name: '循环次数', unit: '次', scale: 1 },
  { name: '充电高温保护值', unit: '℃', kind: 'temp' },
  { name: '充电高温释放值', unit: '℃', kind: 'temp' },
  { name: '充电低温保护值', unit: '℃', kind: 'temp' },
  { name: '充电低温释放值', unit: '℃', kind: 'temp' },
  { name: '放电高温保护值', unit: '℃', kind: 'temp' },
  { name: '放电高温释放值', unit: '℃', kind: 'temp' },
  { name: '放电低温保护值', unit: '℃', kind: 'temp' },
  { name: '放电低温释放值', unit: '℃', kind: 'temp' },
  { name: '总压过压保护值', unit: 'V', scale: 0.01 },
  { name: '总压过压释放值', unit: 'V', scale: 0.01 },
  { name: '总压低压保护值', unit: 'V', scale: 0.01 },
  { name: '总压低压释放值', unit: 'V', scale: 0.01 },
  { name: '单体过压保护值', unit: 'mV', scale: 1 },
  { name: '单体过压释放值', unit: 'mV', scale: 1 },
  { name: '单体欠压保护值', unit: 'mV', scale: 1 },
  { name: '单体欠压释放值', unit: 'mV', scale: 1 },
  { name: '充电过流保护值', unit: 'mA', scale: 10 },
  { name: '放电过流保护值', unit: 'mA', scale: 10, signed: true },
  { name: '均衡开启电压', unit: 'mV', scale: 1 },
  { name: '均衡开启压差', unit: 'mV', scale: 1 },
  { name: '检流电阻值', unit: 'mΩ', kind: 'shunt' },
  { name: '功能配置', kind: 'bitmap' },
  { name: '温度探头配置', kind: 'bitmap' },
  { name: '电池串数', unit: '串', scale: 1 },
  { name: '开关控制时间', unit: 'S', scale: 1 },
  { name: 'LED 工作时间', unit: 'S', scale: 1 },
  { name: 'VOL-80%电压点', unit: 'mV', scale: 1 },
  { name: 'VOL-60%电压点', unit: 'mV', scale: 1 },
  { name: 'VOL_40%电压点', unit: 'mV', scale: 1 },
  { name: 'VOL_20%电压点', unit: 'mV', scale: 1 },
  { name: '硬件过压保护值', unit: 'mV', scale: 1 },
  { name: '硬件欠压保护值', unit: 'mV', scale: 1 },
  { name: '二级过流保护设置', kind: 'raw' },
  { name: '短路保护设置', kind: 'raw' },
  { name: '硬件过欠压延时', kind: 'raw' },
  { name: '短路释放延时', unit: 'S', scale: 1 },
  { name: '充电低温延时', unit: 'S', scale: 1 },
  { name: '充电高温延时', unit: 'S', scale: 1 },
  { name: '放电低温延时', unit: 'S', scale: 1 },
  { name: '放电高温延时', unit: 'S', scale: 1 },
  { name: '总压低压延时', unit: 'S', scale: 1 },
  { name: '总压高压延时', unit: 'S', scale: 1 },
  { name: '单体欠压延时', unit: 'S', scale: 1 },
  { name: '单体过压延时', unit: 'S', scale: 1 },
  { name: '充电过流延时', unit: 'S', scale: 1 },
  { name: '充电过流释放延时', unit: 'S', scale: 1 },
  { name: '放电过流延时', unit: 'S', scale: 1 },
  { name: '放电过流释放延时', unit: 'S', scale: 1 },
]

function buildTable(): ParamDef[] {
  const table: ParamDef[] = []
  SINGLE.forEach((d, i) => table.push({ index: i, ...d }))

  // 56~71 生产厂商信息 (16 寄存器 / 32 字节)
  for (let i = 56; i <= 71; i++) table.push({ index: i, name: '生产厂商信息', ascii: true })
  // 72~87 BMS-编码信息
  for (let i = 72; i <= 87; i++) table.push({ index: i, name: 'BMS-编码信息', ascii: true })
  // 88~103 条形码信息
  for (let i = 88; i <= 103; i++) table.push({ index: i, name: '条形码信息', ascii: true })
  // 104~122 单寄存器
  const REST: Omit<ParamDef, 'index'>[] = [
    { name: 'GPS关断电压', unit: 'mV', scale: 1 },
    { name: 'GPS关断延时', unit: 'S', scale: 1 },
    { name: 'VOL-90%', unit: 'mV', scale: 1 },
    { name: 'VOL-70%', unit: 'mV', scale: 1 },
    { name: 'VOL-50%', unit: 'mV', scale: 1 },
    { name: 'VOL-30%', unit: 'mV', scale: 1 },
    { name: 'VOL-10%', unit: 'mV', scale: 1 },
    { name: 'VOL-100%', unit: 'mV', scale: 1 },
    { name: '学习容量', unit: 'Ah', scale: 0.01 },
    { name: '修正间隔', unit: 'S', scale: 1 },
    { name: '额定电压', unit: 'V', scale: 0.1 },
    { name: '额定电流', unit: 'A', scale: 1 },
    { name: '最大功率', unit: 'W', scale: 1 },
    { name: '额定充电电压', unit: 'V', scale: 0.1 },
    { name: '额定放电电流', unit: 'A', scale: 1 },
    { name: '额定充电电流', unit: 'A', scale: 1 },
    { name: '额定放电功率', unit: 'W', scale: 1 },
    { name: '最小识别电流', unit: 'mA', scale: 1 },
    { name: '休眠时间', unit: 'S', scale: 1 },
  ]
  REST.forEach((d, i) => table.push({ index: 104 + i, ...d }))
  // 123~157 预留告警参数
  for (let i = 123; i <= 157; i++) table.push({ index: i, name: '预留告警参数', kind: 'raw' })
  // 158~169 电池型号 (ASCII)
  for (let i = 158; i <= 169; i++) table.push({ index: i, name: '电池型号', ascii: true })
  // 170~175 唯一ID (12 字节)
  for (let i = 170; i <= 175; i++) table.push({ index: i, name: '唯一ID码', kind: 'raw' })
  // 176~183 硬件名称 (ASCII)
  for (let i = 176; i <= 183; i++) table.push({ index: i, name: '硬件名称', ascii: true })
  return table.sort((a, b) => a.index - b.index)
}

export const PARAM_TABLE: ParamDef[] = buildTable()

export const CHIP_TYPES: Record<number, string> = {
  0: 'TI 方案',
  1: '凹凸 7717',
  2: '新塘/松下 49522',
  3: '中颖 309',
  4: '中颖 303',
  5: '集澈 DC10XX',
  6: 'OZ3714',
}

// ============================ 换算工具 ============================
function defOf(reg: number): ParamDef | undefined {
  return PARAM_TABLE.find((p) => p.index === reg)
}

/** 原始 16 位值 → 显示值（含小数/偏移） */
export function paramRawToDisplay(reg: number, raw: number): number {
  const def = defOf(reg)
  if (!def) return raw & 0xffff
  if (def.kind === 'temp') return (raw - 2731) / 10
  if (def.kind === 'shunt') {
    if (raw & 0x8000) return ((raw & 0x7fff) * 0.01)
    return raw * 0.1
  }
  if (def.kind === 'bitmap' || def.kind === 'date' || def.kind === 'raw') return raw & 0xffff
  const base = def.signed ? toSigned16(raw) : raw
  return base * (def.scale ?? 1)
}

/** 显示值 → 原始 16 位值（用于写回） */
export function paramDisplayToRaw(reg: number, display: number): number {
  const def = defOf(reg)
  if (!def) return Math.round(display) & 0xffff
  if (def.kind === 'temp') return Math.round(display * 10 + 2731) & 0xffff
  if (def.kind === 'shunt') {
    // 检流电阻：优先 0.1mR 单位；若该值无法整除（如 0.05mR）则改用 0.01mR 单位（置 bit15）
    const r1 = Math.round(display * 10)
    if (Math.abs(r1 * 0.1 - display) < 1e-9) return r1 & 0xffff
    return (0x8000 | Math.round(display * 100)) & 0xffff
  }
  if (def.kind === 'bitmap' || def.kind === 'date' || def.kind === 'raw') {
    return Math.round(display) & 0xffff
  }
  let raw = Math.round(display / (def.scale ?? 1))
  if (def.signed && raw < 0) raw = (0x10000 + raw) & 0xffff
  return raw & 0xffff
}

/** 友好单位（换算后单位） */
export function paramDispUnit(reg: number): string {
  return defOf(reg)?.unit || ''
}

// ============================ 短路 / 二级过流保护（复合寄存器） ============================
// 权威（PDF 第 16–17 页）：寄存器 40（二级过流）/ 41（短路）各为 1 个 16 位字，
//   有效信息位于「低 8 位」：高半字节(bit7~4)=保护值档位(T)，低半字节(bit3~0)=延时档位(D)。
// 保护值本质为检流电阻上的电压阈值(mV)；折算电流(A) = 电压(mV) / 检流电阻(mΩ)。
// 中颖 303(4) 在 PDF 中未给公式，按需求与中颖 309(3) 保持一致（复用其查表）。
// 下拉框只存 0~15 档位，下发时合回 16 位字（低字节 = TTTT DDDD）。

export interface ScdParts {
  /** 保护值档位 0~15（低字节高半字节） */
  level: number
  /** 延迟档位 0~15（低字节低半字节） */
  delay: number
}

/** 16 位原始值 → 低字节高低半字节档位（权威：level 在高半字节，delay 在低半字节） */
export function splitScd(raw: number): ScdParts {
  const v = raw & 0xffff
  return { level: (v >> 4) & 0x0f, delay: v & 0x0f }
}

/** 保护值档位 + 延迟档位 → 16 位原始值（下发用，低字节 = TTTT DDDD，高字节为 0） */
export function combineScd(level: number, delay: number): number {
  return (((level & 0x0f) << 4) | (delay & 0x0f)) & 0xffff
}

// ---- 逐芯片查表（来源：PDF 第 16–19 页 + 真实上位机截图核对；中颖303=中颖309） ----
// 注意：不同芯片的保护值「内部单位」不同：
//   - 凹凸(1)：保护值直接为电流 A（固件内部已含检流电阻折算）
//   - 其他芯片：保护值为检流电阻上的电压阈值 mV，需 ÷检流电阻(mΩ) 得电流(A)
//     检流电阻未知（未读取寄存器28）时，按 DEFAULT_SHUNT_MOHM 估算以始终显示 A。
// 二级过流保护值 (OCD_T → 内部单位：凹凸=A, 其余=mV)
const OCD_MV: Record<number, number[]> = {
  1: Array.from({ length: 16 }, (_, t) => 100 * t + 50),       // 凹凸 7717：50,150,250,...1550 **A**（截图核对）
  2: Array.from({ length: 16 }, (_, t) => 20 * t + 10),       // 松下 49522 (mV)
  3: [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200],   // 中颖 309 (mV)
  4: [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200],   // 中颖 303（=309）(mV)
  5: [4, 10, 16, 21, 28, 33, 38, 44, 50, 55, 61, 67, 73, 78, 84, 90],            // 集澈 DC10XX (mV)
  6: Array.from({ length: 16 }, (_, t) => 10 * (t + 1)),      // OZ3714 (mV)
}
// 短路保护值 (SCD_T → 内部单位：凹凸=A, 其余=mV)
const SCD_MV: Record<number, number[]> = {
  1: Array.from({ length: 16 }, (_, t) => 200 * t + 200),     // 凹凸 7717：200,400,600,...3200 **A**（截图核对）
  2: Array.from({ length: 16 }, (_, t) => 40 * t + 20),       // 松下 49522 (mV)
  3: [50, 80, 110, 140, 170, 200, 230, 260, 290, 320, 350, 400, 500, 600, 800, 1000],  // 中颖 309 (mV)
  4: [50, 80, 110, 140, 170, 200, 230, 260, 290, 320, 350, 400, 500, 600, 800, 1000],  // 中颖 303（=309）(mV)
  5: [19, 30, 41, 53, 64, 75, 87, 98, 110, 120, 132, 143, 155, 166, 177, 190],          // 集澈 (mV)
  6: Array.from({ length: 16 }, (_, t) => 40 * (t + 1)),      // OZ3714 (mV)
}
// 二级过流延时 (OCD_D → mS)
const OCD_DELAY_MS: Record<number, number[]> = {
  1: Array.from({ length: 16 }, (_, d) => 500 * (d + 1)),      // 凹凸 7717：500,1000,...8000 **ms**（截图核对）
  2: Array.from({ length: 16 }, (_, d) => 20 * d + 10),       // 松下 49522
  3: [50, 100, 200, 400, 600, 800, 1000, 2000, 4000, 6000, 8000, 10000, 15000, 20000, 30000, 40000],
  4: [50, 100, 200, 400, 600, 800, 1000, 2000, 4000, 6000, 8000, 10000, 15000, 20000, 30000, 40000], // 中颖 303（=309）
  5: [32, 80, 160, 320, 640, 1280, 2560, 5120, 0, 0, 0, 0, 0, 0, 0, 0],   // 集澈：仅 0~7 有效
  6: Array.from({ length: 16 }, (_, d) => 2 * (d + 1)),       // OZ3714：2,4,...32
}
// 短路延时 (SCD_D → µS)；界面统一以 mS 展示，故读取时 ÷1000
const SCD_DELAY_US: Record<number, number[]> = {
  1: Array.from({ length: 16 }, (_, d) => 62.5 * d + 62.5),
  2: Array.from({ length: 16 }, (_, d) => 62.5 * d + 31.25),
  3: Array.from({ length: 16 }, (_, d) => 64 * d),            // 中颖 309：64·D
  4: Array.from({ length: 16 }, (_, d) => 64 * d),            // 中颖 303（=309）
  5: [560, 800, 1600, 3200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],  // 集澈：仅 0~3 有效
  6: Array.from({ length: 16 }, (_, d) => 62.5 * (d + 1)),    // OZ3714
}

function lookup(table: Record<number, number[]>, chip: number | null, i: number): number {
  const arr = table[chip ?? -1]
  return arr ? (arr[i & 0x0f] ?? 0) : 0
}

/** 二级过流保护值 mV（按芯片） */
export function overcurrentMv(chip: number | null, level: number): number {
  return lookup(OCD_MV, chip, level)
}
/** 短路保护值 mV（按芯片） */
export function shortCircuitMv(chip: number | null, level: number): number {
  return lookup(SCD_MV, chip, level)
}
/** 二级过流延时 mS（按芯片） */
export function overcurrentDelayMs(chip: number | null, delay: number): number {
  return lookup(OCD_DELAY_MS, chip, delay)
}
/** 短路延时 µS（按芯片）；界面展示时再 ÷1000 转 mS */
export function shortCircuitDelayUs(chip: number | null, delay: number): number {
  return lookup(SCD_DELAY_US, chip, delay)
}

function trimNum(n: number, max = 3): string {
  if (!isFinite(n)) return '—'
  const r = Math.round(n * 10 ** max) / 10 ** max
  return String(r)
}

export type ScdParam = 'ocd' | 'scd'

/**
 * 保护值下拉 label：档 N · 电流(A)。
 *   - 凹凸(1)：查表值直接为电流(A)，无需折算，直接显示 A。
 *   - 其他芯片：查表值为电压阈值(mV)，÷检流电阻(mΩ) 得电流(A)；检流电阻未知时按 DEFAULT_SHUNT_MOHM 估算。
 *   - 全部芯片统一显示单位 A（无 mV 回退）。
 * TI(0) 方案位域不同且无 mV 表，label 仅显示档位并标注「TI专用」。
 */
/** 检流电阻未知时的默认估算值(mΩ)，用于把 mV 阈值折算为电流(A)显示。
 *  典型小容量 BMS 采样电阻为 0.1 mΩ（与用户提供的凹凸上位机截图吻合：
 *  PDF 公式 20*SCD_T+20 mV ÷ 0.1 = 200/400/…/2000 A，与截图一致）。 */
export const DEFAULT_SHUNT_MOHM = 0.1

export function scdProtectLabel(param: ScdParam, chip: number | null, level: number, shuntMOhm: number): string {
  if (chip === 0) return `档${level} · TI专用`
  // 凹凸芯片：保护值直接是安培(A)
  if (chip === 1) {
    const amps = param === 'ocd' ? overcurrentMv(chip, level) : shortCircuitMv(chip, level)
    return `档${level} · ${trimNum(amps, 1)} A`
  }
  // 其他芯片：mV → A（÷检流电阻；检流电阻未知时按默认值估算）
  const mv = param === 'ocd' ? overcurrentMv(chip, level) : shortCircuitMv(chip, level)
  const shunt = shuntMOhm > 0 ? shuntMOhm : DEFAULT_SHUNT_MOHM
  return `档${level} · ${trimNum(mv / shunt, 2)} A`
}

/** 延时下拉 label：统一以 mS 展示（短路延时由 µS ÷1000 换算） */
export function scdDelayLabelMs(param: ScdParam, chip: number | null, delay: number): string {
  if (chip === 0) return `档${delay} · TI专用`
  const ms = param === 'ocd' ? overcurrentDelayMs(chip, delay) : shortCircuitDelayUs(chip, delay) / 1000
  return `档${delay} · ${trimNum(ms, 3)} ms`
}

/** 显示值应保留的小数位数（与 paramFormat 一致）：temp→1、shunt→2、scale<1→-log10(scale)（上限 4）、否则 0。
 *  用于在界面文本框中按协议精度四舍五入，去除浮点运算产生的尾随零/脏尾数。 */
export function paramDisplayDecimals(reg: number): number {
  const def = defOf(reg)
  if (!def) return 0
  if (def.kind === 'temp') return 1
  if (def.kind === 'shunt') return 2
  if (def.scale !== undefined && def.scale < 1) return Math.min(Math.round(-Math.log10(def.scale)), 4)
  return 0
}

/** 显示用格式化字符串（带合适小数位 / 十六进制 / 日期） */
export function paramFormat(reg: number, raw: number): string {
  const def = defOf(reg)
  if (!def || def.ascii) return '—'
  if (def.kind === 'bitmap' || def.kind === 'raw') {
    return '0x' + (raw & 0xffff).toString(16).toUpperCase().padStart(4, '0')
  }
  if (def.kind === 'date') {
    const day = raw & 0x1f
    const month = (raw >> 5) & 0x0f
    const year = 2000 + (raw >> 9)
    return `${year}-${month}-${day}`
  }
  const val = paramRawToDisplay(reg, raw)
  if (def.kind === 'temp') return val.toFixed(1)
  if (def.kind === 'shunt') return val.toFixed(2)
  if (def.scale !== undefined && def.scale < 1) {
    const d = Math.min(Math.round(-Math.log10(def.scale)), 4)
    return val.toFixed(d)
  }
  return val.toString()
}
