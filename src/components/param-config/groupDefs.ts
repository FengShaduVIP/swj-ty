/**
 * 参数配置页的字段 / 分组静态定义（从 JbdParamConfig.vue 拆出）
 * 只含声明式数据与纯构建函数，无响应式、无 IO，便于维护与审查。
 */

export type FieldStatus = 'idle' | 'reading' | 'writing' | 'ok' | 'fail'
export type CustomDisplayKind = 'chipType' | 'hwVersion' | 'ntcCount' | 'balanceMode' | 'date' | 'serialRaw' | 'sn' | 'swVersion'

export interface FieldDef {
  label: string
  index?: number
  unit?: string
  decimals?: number
  step?: number
  min?: number
  max?: number
  note?: string
  /** 唯一 key（用于 v-for；当 index 不可用时用 label 兜底） */
  key?: string
  /** ASCII 块字段：读取 N 个连续寄存器并解码为字符串（只读） */
  ascii?: boolean
  ascii_len?: number
  /** 位开关字段（与 bitIndex/bit 配合） */
  bitIndex?: number
  bit?: number
  /** 只读字段（不可下发，常用于设备标识 / 协议未涵盖） */
  readOnly?: boolean
  /** 自定义展示：值为 customDisplayValue() 返回值；不参与 0xFA 读写 */
  customDisplay?: CustomDisplayKind
  /** 跨列占满（用于检流阻值等） */
  fullWidth?: boolean
  /** 字段行内附带「复位 MCU」按钮（发送控制指令 0x03 0x00） */
  resetMcu?: boolean
  /** 下拉选项字段：value 为下发到 BMS 的原始寄存器值 */
  options?: { label: string; value: number }[]
  /** 复合保护字段：单个寄存器 16 位，低字节高半字节=保护值档位(level)、低字节低半字节=延迟档位(delay) */
  kind?: 'scd'
  scdPart?: 'level' | 'delay'
  /** 下发前需要输入密码校验（如检流阻值） */
  needPassword?: boolean
}

export interface FieldState extends FieldDef {
  value: any
  dirty: boolean
  status: FieldStatus
}

export type GroupAction = {
  label: string
  fn: (g: { title: string; fields: FieldState[] }) => void | Promise<void>
}

export type GroupObj = { title: string; cols?: number; action?: GroupAction; fields: FieldState[] }

export function makeField(def: FieldDef): FieldState {
  return { ...def, value: def.bitIndex !== undefined ? false : null, dirty: false, status: 'idle' }
}

// ====== 分组定义（1 排 2 列瀑布流布局，每组内字段 3 列网格，共 11 组） ======
export const GROUP_DEFS: { title: string; order: number; cols?: number; action?: GroupAction; fields: FieldDef[] }[] = [
  // 1. 基本设置（12 项 / 3 列 × 4 行）
  // 显示名称对齐标准上位机（嘉佰达物联云）：电池生产商 / BMS版本号。
  // 电池SN码：真机全量扫描（scripts/hw-scan.hw.ts）证实寄存器区唯一 ASCII 字符串
  // 是蓝牙名称块（88~103），标准工具的 SN 即取自该块，故此处随蓝牙名称联动显示。
  // BMS版本号：标准工具显示 0x03 基本信息里的固件版本号去点形式（8.0 → 80），
  // 而非寄存器 72 的 ASCII 块（本机实测为 "www"）。
  {
    title: '基本设置',
    order: 1,
    fields: [
      { label: '蓝牙名称', key: 'bt-name', index: 88, ascii: true, ascii_len: 16, fullWidth: true, resetMcu: true },
      { label: '芯片类型', key: 'chip-type', customDisplay: 'chipType' },
      { label: '电池SN码', key: 'sn', customDisplay: 'sn', readOnly: true },
      { label: '电池型号', key: 'battery-model', index: 158, ascii: true, ascii_len: 12, readOnly: true },
      { label: '电池生产商', key: 'mfr', index: 56, ascii: true, ascii_len: 16 },
      { label: 'BMS版本号', key: 'sw-version', customDisplay: 'swVersion', readOnly: true },
      { label: 'BMS型号', key: 'bms-hw-name', index: 176, ascii: true, ascii_len: 8, readOnly: true },
      { label: '生产日期', key: 'prod-date', index: 5, customDisplay: 'date' },
      { label: '额定充电电压', index: 117, unit: 'V', decimals: 1, step: 0.1 },
      { label: '额定充电电流', index: 119, unit: 'A', decimals: 0 },
      { label: '额定放电电流', index: 118, unit: 'A', decimals: 0 },
      { label: '额定放电功率', index: 120, unit: 'W', decimals: 0 },
    ],
  },
  // 2. 电流设置（10 项 / 3 列 × 4 行）
  {
    title: '电流设置',
    order: 2,
    fields: [
      { label: '充电过流保护', index: 24, unit: 'mA', decimals: 0, step: 10 },
      { label: '充电过流延时', index: 52, unit: 'S', decimals: 0 },
      { label: '充电过流恢复延时', index: 53, unit: 'S', decimals: 0 },
      { label: '放电过流保护', index: 25, unit: 'mA', decimals: 0, step: 10 },
      { label: '放电过流延时', index: 54, unit: 'S', decimals: 0 },
      { label: '放电过流恢复延时', index: 55, unit: 'S', decimals: 0 },
      { label: '二级过流保护', index: 40, kind: 'scd', scdPart: 'level'},
      { label: '二级过流延时', index: 40, kind: 'scd', scdPart: 'delay'},
      { label: '短路保护', index: 41, kind: 'scd', scdPart: 'level' },
      { label: '短路保护延时', index: 41, kind: 'scd', scdPart: 'delay'},
      { label: '短路释放延时', index: 43, unit: 'S', decimals: 0 },
    ],
  },

  // 3. 容量电压（12 项 / 3 列 × 4 行）
  {
    title: '容量电压',
    order: 3,
    fields: [
      { label: '10%', index: 110, unit: 'mV', decimals: 0 },
      { label: '20%', index: 37, unit: 'mV', decimals: 0 },
      { label: '30%', index: 109, unit: 'mV', decimals: 0 },
      { label: '40%', index: 36, unit: 'mV', decimals: 0 },
      { label: '50%', index: 108, unit: 'mV', decimals: 0 },
      { label: '60%', index: 35, unit: 'mV', decimals: 0 },
      { label: '70%', index: 107, unit: 'mV', decimals: 0 },
      { label: '80%', index: 34, unit: 'mV', decimals: 0 },
      { label: '90%', index: 106, unit: 'mV', decimals: 0 },
      { label: '100%', index: 111, unit: 'mV', decimals: 0 },
      { label: '置满电压', index: 2, unit: 'mV', decimals: 0 },
      { label: '置空电压', index: 3, unit: 'mV', decimals: 0 },
    ],
  },
  // 5. 温度探头配置（序号 30 低字节：温度探头 1~8 使能，1 字节 8 bit / 3 列 × 3 行 + 应用配置按钮）
  {
    title: '温度探头配置',
    order: 5,
    fields: [
      { label: '温度探头_1',  key: 'probe-1',  bitIndex: 30, bit: 0  },
      { label: '温度探头_2',  key: 'probe-2',  bitIndex: 30, bit: 1  },
      { label: '温度探头_3',  key: 'probe-3',  bitIndex: 30, bit: 2  },
      { label: '温度探头_4',  key: 'probe-4',  bitIndex: 30, bit: 3  },
      { label: '温度探头_5',  key: 'probe-5',  bitIndex: 30, bit: 4  },
      { label: '温度探头_6',  key: 'probe-6',  bitIndex: 30, bit: 5  },
      { label: '温度探头_7',  key: 'probe-7',  bitIndex: 30, bit: 6  },
      { label: '温度探头_8',  key: 'probe-8',  bitIndex: 30, bit: 7  },
    ],
  },
  // 6. 均衡设置（4 项 / 3 列 × 2 行）
  {
    title: '均衡设置',
    order: 6,
    fields: [
      { label: '均衡开启电压', index: 26, unit: 'mV', decimals: 0 },
      { label: '均衡开启压差', index: 27, unit: 'mV', decimals: 0 },
      { label: 'GPS关闭电压', index: 104, unit: 'mV', decimals: 0 },
      { label: 'GPS关闭延时', index: 105, unit: 'S', decimals: 0 },
    ],
  },
  // 4. 系统设置（4 项 / 3 列 × 2 行）
  {
    title: '系统设置',
    order: 4,
    fields: [
      { label: '休眠时间', index: 122, unit: 'S', decimals: 0 },
      { label: '容量修正间隔', index: 113, unit: 'S', decimals: 0 },
      { label: '序列号', index: 6, customDisplay: 'serialRaw', readOnly: true },
      { label: '循环次数', index: 7, unit: '次', decimals: 0 },
    ],
  },
  // 8. 初始化设置（2 项 / 3 列 × 1 行）
  {
    title: '初始化设置',
    order: 8,
    fields: [
      { label: '标称容量', index: 0, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '循环容量', index: 1, unit: 'Ah', decimals: 2, step: 0.01 },
    ],
  },
  // 9. 温度设置（12 项 / 3 列 × 4 行）
  {
    title: '温度设置',
    order: 9,
    fields: [
      { label: '充电高温保护', index: 8, unit: '℃', decimals: 1 },
      { label: '充电高温恢复', index: 9, unit: '℃', decimals: 1 },
      { label: '充电高温延时', index: 45, unit: 'S', decimals: 0 },
      { label: '充电低温保护', index: 10, unit: '℃', decimals: 1 },
      { label: '充电低温恢复', index: 11, unit: '℃', decimals: 1 },
      { label: '充电低温延时', index: 44, unit: 'S', decimals: 0 },
      { label: '放电高温保护', index: 12, unit: '℃', decimals: 1 },
      { label: '放电高温恢复', index: 13, unit: '℃', decimals: 1 },
      { label: '放电高温延时', index: 47, unit: 'S', decimals: 0 },
      { label: '放电低温保护', index: 14, unit: '℃', decimals: 1 },
      { label: '放电低温恢复', index: 15, unit: '℃', decimals: 1 },
      { label: '放电低温延时', index: 46, unit: 'S', decimals: 0 },
    ],
  },
  // 10. 保护参数（14 项 / 3 列 × 5 行）
  {
    title: '保护参数',
    order: 10,
    fields: [
      { label: '单体过压保护', index: 20, unit: 'mV', decimals: 0 },
      { label: '单体过压恢复', index: 21, unit: 'mV', decimals: 0 },
      { label: '单体过压延时', index: 51, unit: 'S', decimals: 0 },
      { label: '单体欠压保护', index: 22, unit: 'mV', decimals: 0 },
      { label: '单体欠压恢复', index: 23, unit: 'mV', decimals: 0 },
      { label: '单体欠压延时', index: 50, unit: 'S', decimals: 0 },
      { label: '总体过压保护', index: 16, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体过压恢复', index: 17, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体过压延时', index: 49, unit: 'S', decimals: 0 },
      { label: '总体欠压保护', index: 18, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体欠压恢复', index: 19, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体欠压延时', index: 48, unit: 'S', decimals: 0 },
      { label: '硬件过压保护', index: 38, unit: 'mV', decimals: 0 },
      { label: '硬件欠压保护', index: 39, unit: 'mV', decimals: 0 },
    ],
  },

  // 11. 功能设置（11 项 / 3 列 × 4 行，末行 + 应用设置按钮）
  {
    title: '功能设置',
    order: 11,
    fields: [
      { label: '开关功能', key: 'cfg-sw', bitIndex: 29, bit: 0 },
      { label: '负载检测', key: 'cfg-load', bitIndex: 29, bit: 1 },
      { label: '均衡功能', key: 'cfg-bal', bitIndex: 29, bit: 2 },
      { label: '均衡方式', key: 'cfg-bal-mode', bitIndex: 29, bit: 3, customDisplay: 'balanceMode' },
      { label: 'LED', key: 'cfg-led', bitIndex: 29, bit: 4 },
      { label: 'LED数量', key: 'led-count', readOnly: true, note: '需协议补充' },
      { label: 'RTC', key: 'cfg-rtc', bitIndex: 29, bit: 5 },
      { label: 'FCC限制', key: 'cfg-fcc', bitIndex: 29, bit: 6 },
      { label: '充电握手', key: 'cfg-handshake', bitIndex: 29, bit: 7 },
      { label: 'GPS', key: 'cfg-gps', bitIndex: 29, bit: 8 },
      { label: '蜂鸣器续延', key: 'cfg-buzzer', bitIndex: 29, bit: 9 },
    ],
  },
  // 7. 检流电阻（独立模块：index 28；导入模板时不随下发）
  {
    title: '检流电阻',
    order: 7,
    cols: 1,
    fields: [
      { label: '检流阻值', index: 28, unit: 'mΩ', decimals: 2, step: 0.01, needPassword: true },
    ],
  },
]

/** 由分组标题顺序构建左右两列布局；GROUP_DEFS 中未列出的分组自动补到右列末尾。
 *  actions 由组件注入（分组级下发按钮，如位图「应用配置/应用设置」，
 *  因为其实现依赖组件内的连接状态与总线）。 */
export function buildColumnsFromTitles(order: string[][], actions: Record<string, GroupAction> = {}): GroupObj[][] {
  const built = GROUP_DEFS.map((g) => ({ title: g.title, cols: g.cols, action: actions[g.title], fields: g.fields.map(makeField) }))
  const pool = new Map(built.map((g) => [g.title, g]))
  const cols: GroupObj[][] = order.map((col) => {
    const arr: GroupObj[] = []
    for (const t of col) {
      const g = pool.get(t)
      if (g) { arr.push(g); pool.delete(t) }
    }
    return arr
  })
  for (const g of pool.values()) cols[cols.length - 1].push(g)
  return cols
}

// 出厂默认左右两列布局（用户拖拽确认后的顺序，已固化进代码）。
// 如需调整默认排布，直接改这里的标题顺序即可。
export const defaultColumnOrder: [string[], string[]] = [
  ['基本设置', '电流设置', '保护参数', '温度探头配置', '检流电阻'],
  ['初始化设置', '容量电压', '温度设置', '功能设置', '系统设置', '均衡设置'],
]
