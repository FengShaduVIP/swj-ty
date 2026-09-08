/** JbdParamConfig 参数配置页的共享类型（自 JbdParamConfig.vue 拆出，便于多文件复用） */

export type FieldStatus = 'idle' | 'reading' | 'writing' | 'ok' | 'fail'
export type CustomDisplayKind = 'chipType' | 'hwVersion' | 'ntcCount' | 'balanceMode' | 'date' | 'serialRaw'

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
  /** 复合保护字段：单个寄存器 16 位，低字节高半字节=保护值档位(level)、低半字节=延迟档位(delay) */
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

/** 分组标题栏右侧动作按钮：点击后下发 bitIndex 寄存器的共享位图 */
export interface GroupAction {
  label: string
  /** 动作目标寄存器（与 writeGroupBitmap 的 bitIndex 参数对应） */
  bitIndex: number
}

export interface GroupObj {
  title: string
  cols?: number
  action?: GroupAction
  fields: FieldState[]
}

export interface ConfigTemplate {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  data: any // 与导出文件同构：{ type, version, params: [...] }
}

export type ImportStatus = 'ok' | 'fail' | undefined

export interface ImportedParam {
  index: number; label: string; unit: string; value: number | string; raw: number; status?: ImportStatus
  current?: number | string | null // 导入前设备上真实的当前值，用于与下发值比对
  ascii?: string // ASCII 块参数（如生产厂商信息）：以字符串形式下发，raw 列不适用
}
