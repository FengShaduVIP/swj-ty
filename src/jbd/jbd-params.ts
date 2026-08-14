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
// 说明：寄存器 84（二级过流保护设置）、85（短路保护设置）各为 1 个 16 位字，
//   高字节（bit15~8）= 保护值档位（SCD_T / OCD_T，0~15）
//   低字节（bit7~0） = 延迟档位（SCD_D / OCD_D，0~15）
// 不同芯片方案的档位→真实值换算公式不同，下拉框只存 0~15 档位，下发时合成 16 位字。

export interface ScdParts {
  /** 保护值档位 0~15（高字节） */
  level: number
  /** 延迟档位 0~15（低字节） */
  delay: number
}

/** 16 位原始值 → 高低字节档位 */
export function splitScd(raw: number): ScdParts {
  const v = raw & 0xffff
  return { level: (v >> 8) & 0x0f, delay: v & 0x0f }
}

/** 高低字节档位 → 16 位原始值（用于下发） */
export function combineScd(level: number, delay: number): number {
  return (((level & 0x0f) << 8) | (delay & 0x0f)) & 0xffff
}

/**
 * 保护值档位 → 真实电压(mV)
 *   凹凸(1): 20*T + 20；松下(2): 40*T + 20；未知方案默认凹凸。
 */
export function scdLevelMv(chipType: number | null, level: number): number {
  const t = level & 0x0f
  if (chipType === 2) return 40 * t + 20
  return 20 * t + 20
}

/**
 * 保护值档位 → 真实过流电流(A)
 *   按实测档位表递推：1档=80A, 2档=110A, ... 每档 +30A → 公式 50 + 30*N。
 *   0 档视为未设置，显示为 0A。
 */
export function scdLevelAmp(level: number): number {
  const n = level & 0x0f
  if (n === 0) return 0
  return 50 + 30 * n
}

/**
 * 延迟档位 → 真实延迟(uS)
 *   凹凸(1): 62.5*D + 62.5；松下(2): 62.5*D + 31.25；未知方案默认凹凸。
 */
export function scdDelayUs(chipType: number | null, delay: number): number {
  const d = delay & 0x0f
  if (chipType === 2) return 62.5 * d + 31.25
  return 62.5 * d + 62.5
}

/** 下拉框 option label：第 N 档 → 真实电压值，如 『档2 · 40 mV』 */
export function scdLevelLabel(chipType: number | null, level: number): string {
  return `档${level} · ${scdLevelMv(chipType, level)} mV`
}
/** 下拉框 option label：第 N 档 → 真实过流电流值，如 『档1 · 80 A』（0 档未设置） */
export function scdLevelAmpLabel(level: number): string {
  const n = level & 0x0f
  return `档${n} · ${scdLevelAmp(n)} A`
}
export function scdDelayLabel(chipType: number | null, delay: number): string {
  return `档${delay} · ${scdDelayUs(chipType, delay)} µS`
}

/**
 * 延迟档位 → 真实延时(ms)
 *   实测档位表：1档=8ms, 2档=20ms, 3档=40ms, ... 8档=1280ms，
 *   之后每档 ×2 递推：n<=2 时 1→8 / 2→20，n>=3 时 20 * 2^(n-2)。
 *   0 档视为未设置，显示为 0ms。
 */
export function scdDelayMs(delay: number): number {
  const n = delay & 0x0f
  if (n === 0) return 0
  if (n === 1) return 8
  if (n === 2) return 20
  return 20 * Math.pow(2, n - 2)
}

/** 下拉框 option label：第 N 档 → 真实延时(ms)，如 『档1 · 8 ms』 */
export function scdDelayMsLabel(delay: number): string {
  const n = delay & 0x0f
  return `档${n} · ${scdDelayMs(n)} ms`
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
