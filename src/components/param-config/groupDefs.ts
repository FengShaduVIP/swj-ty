/** 分组字段定义（静态数据，与 IO 逻辑解耦）
 *  布局对齐嘉佰达 JBDTools 参数设置页（2026-11-19 真机界面核验）：
 *  三列固定分配（46/27/27）：col1 = 基本参数/高级保护/均衡；col2 = 其他信息/NTC/功能；col3 = 容量(内部两列)。
 *  每组 layout = triple（保护/释放/延时 三段行）| rows（单字段行）| bits（位开关栅格）。
 */
import type { FieldDef, FieldState, GroupObj } from './types'

function makeField(def: FieldDef): FieldState {
  return { ...def, value: def.bitIndex !== undefined ? false : null, dirty: false, status: 'idle' }
}

interface GroupDef {
  title: string
  col: 1 | 2 | 3
  layout: 'rows' | 'triple' | 'bits'
  twoCol?: boolean
  pair?: boolean
  regRange?: string
  action?: { label: string; bitIndex: number }
  fields: FieldDef[]
}

const GROUP_DEFS: GroupDef[] = [
  // ===== 1：基本参数（保护 / 释放 / 延时，JBDTools 最左大列）=====
  {
    title: '基本参数', col: 1, layout: 'triple', regRange: 'reg 8~55',
    fields: [
      { label: '单体过压', index: 20, unit: 'mV' }, { label: '单体过压恢复', index: 21, unit: 'mV' }, { label: '单体过压延时', index: 51, unit: 's' },
      { label: '单体欠压', index: 22, unit: 'mV' }, { label: '单体欠压恢复', index: 23, unit: 'mV' }, { label: '单体欠压延时', index: 50, unit: 's' },
      { label: '整组过压', index: 16, unit: 'V', decimals: 2, step: 0.01 }, { label: '整组过压恢复', index: 17, unit: 'V', decimals: 2 }, { label: '整组过压延时', index: 49, unit: 's' },
      { label: '整组欠压', index: 18, unit: 'V', decimals: 2, step: 0.01 }, { label: '整组欠压恢复', index: 19, unit: 'V', decimals: 2 }, { label: '整组欠压延时', index: 48, unit: 's' },
      { label: '充电高温', index: 8, unit: '℃', decimals: 1 }, { label: '充电高温恢复', index: 9, unit: '℃', decimals: 1 }, { label: '充电高温延时', index: 45, unit: 's' },
      { label: '充电低温', index: 10, unit: '℃', decimals: 1 }, { label: '充电低温恢复', index: 11, unit: '℃', decimals: 1 }, { label: '充电低温延时', index: 44, unit: 's' },
      { label: '放电高温', index: 12, unit: '℃', decimals: 1 }, { label: '放电高温恢复', index: 13, unit: '℃', decimals: 1 }, { label: '放电高温延时', index: 47, unit: 's' },
      { label: '放电低温', index: 14, unit: '℃', decimals: 1 }, { label: '放电低温恢复', index: 15, unit: '℃', decimals: 1 }, { label: '放电低温延时', index: 46, unit: 's' },
      { label: '充电过流', index: 24, unit: 'mA', step: 10 }, { label: '充电过流恢复', index: 53, unit: 's' }, { label: '充电过流延时', index: 52, unit: 's' },
      { label: '放电过流', index: 25, unit: 'mA', step: 10 }, { label: '放电过流恢复', index: 55, unit: 's' }, { label: '放电过流延时', index: 54, unit: 's' },
    ],
  },
  // ===== 容量配置（独占第三列，内部两列压缩 SOC 表）=====
  {
    title: '容量配置', col: 3, layout: 'rows', regRange: 'reg 0~4 · 32~33 · SOC 表',
    fields: [
      { label: '复位次数', key: 'reset-count', customDisplay: 'resetCount' },
      { label: '标称容量', index: 0, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '循环容量', index: 1, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '系统功耗', index: 4, unit: 'mA' },
      { label: '平均置满电压', index: 2, unit: 'mV' },
      { label: '平均置空电压', index: 3, unit: 'mV' },
      { label: '100%', index: 111, unit: 'mV' },
      { label: '90%', index: 106, unit: 'mV' },
      { label: '80%', index: 34, unit: 'mV' },
      { label: '70%', index: 107, unit: 'mV' },
      { label: '60%', index: 35, unit: 'mV' },
      { label: '50%', index: 108, unit: 'mV' },
      { label: '40%', index: 36, unit: 'mV' },
      { label: '30%', index: 109, unit: 'mV' },
      { label: '20%', index: 37, unit: 'mV' },
      { label: '10%', index: 110, unit: 'mV' },
      { label: '关机时间', index: 32, unit: 's' },
      { label: 'LED点亮时间', index: 33, unit: 's' },
    ],
  },
  // ===== 2：高级保护（基本参数下方，字段两两一行，scd 下拉成对显示）=====
  {
    title: '高级保护', col: 1, layout: 'rows', pair: true, regRange: 'reg 38~43',
    fields: [
      { label: '硬件单体过压', index: 38, unit: 'mV' },
      { label: '硬件单体欠压', index: 39, unit: 'mV' },
      { label: '过压延时', index: 42, kind: 'hvd', hvdPart: 'ov', unit: 's' },
      { label: '欠压延时', index: 42, kind: 'hvd', hvdPart: 'uv', unit: 's' },
      { label: '二级放电过流', index: 40, unit: 'A', kind: 'scd', scdPart: 'level' },
      { label: '过流2延时', index: 40, unit: 'ms', kind: 'scd', scdPart: 'delay' },
      { label: '短路保护值', index: 41, unit: 'A', kind: 'scd', scdPart: 'level' },
      { label: '短路延时', index: 41, unit: 'ms', kind: 'scd', scdPart: 'delay' },
      { label: '短路释放延时', index: 43, unit: 's' },
      { label: '过流及短路保护值翻倍', key: 'scd-double', bitIndex: 40, bit: 15 },
    ],
  },
  // ===== 3：其他信息配置（条形码=reg88 蓝牙名称块；序列号/电池串数可编辑；检流电阻🔒）=====
  {
    title: '其他信息配置', col: 2, layout: 'rows', regRange: '标识 / ASCII',
    fields: [
      { label: '制造商', key: 'mfr', index: 56, ascii: true, ascii_len: 16 },
      { label: 'BMS编码', key: 'bms-ver', index: 72, ascii: true, ascii_len: 16 },
      { label: '条形码', key: 'bt-name', index: 88, ascii: true, ascii_len: 16 },
      { label: '序列号', index: 6 },
      { label: '循环次数', index: 7, unit: '次' },
      { label: '生产日期', key: 'prod-date', index: 5, customDisplay: 'date' },
      { label: '电池串数', index: 31, unit: '串' },
      { label: '检流阻值', index: 28, unit: 'mΩ', decimals: 2, step: 0.01, needPassword: true, note: '独立配置' },
    ],
  },
  // ===== 4：NTC 配置（其他信息下方）=====
  {
    title: 'NTC配置', col: 2, layout: 'bits', regRange: 'reg 30',
    action: { label: '应用配置', bitIndex: 30 },
    fields: Array.from({ length: 8 }, (_, i) => ({
      label: `NTC${i + 1}`, key: `ntc-${i + 1}`, bitIndex: 30, bit: i,
    })) as FieldDef[],
  },
  // ===== 6：均衡配置（高级保护下方，字段两两一行）=====
  {
    title: '均衡配置', col: 1, layout: 'rows', pair: true, regRange: 'reg 26~27 · 104~105',
    fields: [
      { label: '开启电压', index: 26, unit: 'mV' },
      { label: '均衡精度', index: 27, unit: 'mV' },
      { label: 'GPS关闭电压', index: 104, unit: 'mV' },
      { label: 'GPS关闭延时', index: 105, unit: 's' },
    ],
  },
  // ===== 5：功能配置（reg29；位名依协议表，JBDTools 本版位定义有差异待厂商位表）=====
  {
    title: '功能配置', col: 2, layout: 'bits', regRange: 'reg 29',
    action: { label: '应用设置', bitIndex: 29 },
    fields: [
      { label: '开关功能', key: 'cfg-sw', bitIndex: 29, bit: 0 },
      { label: '负载检测', key: 'cfg-load', bitIndex: 29, bit: 1 },
      { label: '均衡功能', key: 'cfg-bal', bitIndex: 29, bit: 2 },
      { label: '充电均衡', key: 'cfg-bal-mode', bitIndex: 29, bit: 3 },
      { label: 'LED功能', key: 'cfg-led', bitIndex: 29, bit: 4 },
      { label: 'RTC', key: 'cfg-rtc', bitIndex: 29, bit: 5 },
      { label: 'FCC限制', key: 'cfg-fcc', bitIndex: 29, bit: 6 },
      { label: '充电握手', key: 'cfg-handshake', bitIndex: 29, bit: 7 },
      { label: 'GPS模式', key: 'cfg-gps', bitIndex: 29, bit: 8 },
      { label: '蜂鸣器功能', key: 'cfg-buzzer', bitIndex: 29, bit: 9 },
      { label: 'LED数量', key: 'led-count', readOnly: true, note: '需协议补充' },
    ],
  },
]

export const builtGroups: GroupObj[] = GROUP_DEFS.map((g) => ({
  title: g.title, col: g.col, layout: g.layout, twoCol: g.twoCol, pair: g.pair, regRange: g.regRange, action: g.action,
  fields: g.fields.map(makeField),
}))

/** JBDTools 固定三列布局（46/27/27） */
export function buildStaticColumns(): GroupObj[][] {
  const cols: GroupObj[][] = [[], [], []]
  for (const g of builtGroups) cols[(g.col ?? 1) - 1].push(g)
  return cols
}

/** 基本参数 triple 行分组（10 行 × 保护/恢复/延时） */
export function tripleRows(fields: FieldState[]): FieldState[][] {
  const rows: FieldState[][] = []
  for (let i = 0; i + 2 < fields.length; i += 3) rows.push([fields[i], fields[i + 1], fields[i + 2]])
  return rows
}
