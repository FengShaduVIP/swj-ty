/**
 * 天一 (TIANYI) 协议 —— 参数下发寄存器表（来自 docs/天一协议寄存器映射说明.md 第 10 节）
 *
 * 换算（与监测页一致）：
 *   display = (raw - offset) * gain
 *   raw     = round(display / gain + offset)
 * 其中 raw 为保持寄存器原始 U16 值。
 *
 * 范围/枚举依据协议文档；校准区文档未给 offset/gain，按 raw 系数（gain 1 / offset 0）处理，
 * 以设备实测为准（详见文档第 11 节错漏提示）。
 */

export type TianyiGroup = 'config' | 'protect' | 'calib' | 'sleep' | 'control'

export interface EnumOption {
  value: number
  label: string
}

export interface TianyiParamDef {
  reg: number
  name: string
  label: string
  offset: number
  gain: number
  unit?: string
  min?: number
  max?: number
  decimals?: number
  step?: number
  rw: boolean
  options?: EnumOption[]
  group: TianyiGroup
  hint?: string
}

// 每组连续读取的起始地址与寄存器数量（控制区为写专用，不参与读取）
export const GROUP_READ: Record<Exclude<TianyiGroup, 'control'>, { start: number; count: number }> = {
  config: { start: 0xa500, count: 0x14 }, // A500..A513（A514-A51B 为预留，默认不显示）
  protect: { start: 0xa600, count: 0x3b }, // A600..A63A
  calib: { start: 0xa700, count: 0x1e },  // A700..A71D（A71E-A735 VlineRES 默认不显示）
  sleep: { start: 0xa800, count: 7 },      // A800..A806
}

export const GROUP_META: { key: TianyiGroup; title: string; hint: string }[] = [
  { key: 'config', title: '基础配置', hint: 'A500–A513 · 电芯/容量/类型/通讯/回路使能' },
  { key: 'protect', title: '保护参数', hint: 'A600–A63A · 过压/欠压/过流/温度/均衡' },
  { key: 'calib', title: '校准参数', hint: 'A700–A71D · 电压/电流/SOC 标定系数' },
  { key: 'sleep', title: '休眠参数', hint: 'A800–A806 · 快/中/慢速休眠阈值与延时' },
  { key: 'control', title: '复位控制', hint: 'A900/A901 · 系统重启 / 恢复出厂（写专用）' },
]

// 枚举选项
const BATTYPE: EnumOption[] = [
  { value: 0, label: '铁锂' },
  { value: 1, label: '三元' },
  { value: 2, label: '钠离子' },
  { value: 3, label: '钛酸锂' },
  { value: 4, label: '其它' },
]
const CHG_SELECT: EnumOption[] = [
  { value: 0, label: '恒定' },
  { value: 1, label: '三段式' },
  { value: 2, label: '智能调节' },
  { value: 3, label: '用户定义' },
]
const KEY_SELECT: EnumOption[] = [
  { value: 0, label: '开关管充放电' },
  { value: 1, label: '开关只管放电' },
  { value: 2, label: '无开关' },
  { value: 3, label: '其他方式' },
]
const CTR_SELECT: EnumOption[] = [
  { value: 0, label: '同口' },
  { value: 1, label: '异口不互锁' },
  { value: 2, label: '异口互锁' },
  { value: 3, label: 'OBC充不互锁' },
  { value: 4, label: 'OBC充互锁' },
  { value: 5, label: '国标充不互锁' },
  { value: 6, label: '国标充互锁' },
  { value: 7, label: '客户自定义' },
]
const EN: EnumOption[] = [
  { value: 0, label: '禁用' },
  { value: 1, label: '使能' },
]
const BAUDRATE_485: EnumOption[] = [
  { value: 24, label: '2400' },
  { value: 48, label: '4800' },
  { value: 96, label: '9600' },
  { value: 192, label: '19200' },
  { value: 384, label: '38400' },
  { value: 1152, label: '115200' },
]
const BAUDRATE_CAN: EnumOption[] = [
  { value: 125, label: '125' },
  { value: 250, label: '250' },
  { value: 500, label: '500' },
  { value: 1000, label: '1000' },
]
const VENABLE: EnumOption[] = [
  { value: 0, label: '禁用' },
  { value: 1, label: '定值标定' },
  { value: 2, label: '动态标定' },
]

// ============================ 参数表 ============================
export const PARAM_DEFS: TianyiParamDef[] = [
  // -------- 配置 A500–A513 --------
  { reg: 0xa500, name: 'CELLNumber', label: '电芯数量', offset: 0, gain: 1, unit: '个', min: 3, max: 255, decimals: 0, rw: true, group: 'config' },
  { reg: 0xa501, name: 'TempNum', label: '温度数量', offset: 0, gain: 1, unit: '个', min: 1, max: 255, decimals: 0, rw: true, group: 'config' },
  { reg: 0xa502, name: 'PACK_FCC', label: '电池额定容量', offset: 0, gain: 0.1, unit: 'Ah', min: 0.1, max: 6553.0, decimals: 1, rw: true, group: 'config' },
  { reg: 0xa503, name: 'PACK_BATTYPE_Flag', label: '电池类型', offset: 0, gain: 1, decimals: 0, rw: true, options: BATTYPE, group: 'config' },
  { reg: 0xa504, name: 'PACK_ID', label: '电池ID(并联区分)', offset: 0, gain: 1, min: 0, max: 255, decimals: 0, rw: true, group: 'config' },
  { reg: 0xa505, name: 'UART_4851_Addr', label: '485_1 站地址', offset: 0, gain: 1, unit: '#', min: 1, max: 255, decimals: 0, rw: true, group: 'config' },
  { reg: 0xa506, name: 'UART_4852_Addr', label: '485_2 站地址', offset: 0, gain: 1, unit: '#', min: 1, max: 255, decimals: 0, rw: true, group: 'config' },
  { reg: 0xa507, name: 'UART_4851_BoundRate', label: '485_1 波特率', offset: 0, gain: 1, unit: 'bps', decimals: 0, rw: true, options: BAUDRATE_485, hint: '96=9600, 1152=115200', group: 'config' },
  { reg: 0xa508, name: 'UART_4852_BoundRate', label: '485_2 波特率', offset: 0, gain: 1, unit: 'bps', decimals: 0, rw: true, options: BAUDRATE_485, hint: '96=9600, 1152=115200', group: 'config' },
  { reg: 0xa509, name: 'CAN1_BoundRate', label: 'CAN1 波特率', offset: 0, gain: 1, unit: 'kbps', decimals: 0, rw: true, options: BAUDRATE_CAN, group: 'config' },
  { reg: 0xa50a, name: 'CAN2_BoundRate', label: 'CAN2 波特率', offset: 0, gain: 1, unit: 'kbps', decimals: 0, rw: true, options: BAUDRATE_CAN, group: 'config' },
  { reg: 0xa50b, name: 'CHG_Voltage', label: '请求充电电压', offset: 0, gain: 0.1, unit: 'V', min: 10, max: 1000.0, decimals: 1, rw: true, group: 'config' },
  { reg: 0xa50c, name: 'CHG_Current', label: '请求充电电流', offset: 0, gain: 0.1, unit: 'A', min: 1.0, max: 1000.0, decimals: 1, rw: true, group: 'config' },
  { reg: 0xa50d, name: 'CHG_SELECT', label: '电流策略标志位', offset: 0, gain: 1, decimals: 0, rw: true, options: CHG_SELECT, hint: '⚠️ 源表功能码标注为 11，非标准', group: 'config' },
  { reg: 0xa50e, name: 'KEY_SELECT', label: '开关量标志位', offset: 0, gain: 1, decimals: 0, rw: true, options: KEY_SELECT, group: 'config' },
  { reg: 0xa50f, name: 'CTR_SELECT', label: '控制策略选择', offset: 0, gain: 1, decimals: 0, rw: true, options: CTR_SELECT, group: 'config' },
  { reg: 0xa510, name: 'CHG_EN', label: '充电回路使能', offset: 0, gain: 1, decimals: 0, rw: true, options: EN, group: 'config' },
  { reg: 0xa511, name: 'DSG_EN', label: '放电回路使能', offset: 0, gain: 1, decimals: 0, rw: true, options: EN, group: 'config' },
  { reg: 0xa512, name: 'HOT_EN', label: '加热回路使能', offset: 0, gain: 1, decimals: 0, rw: true, options: EN, group: 'config' },
  { reg: 0xa513, name: 'BEEP_EN', label: '蜂鸣器回路使能', offset: 0, gain: 1, decimals: 0, rw: true, options: EN, group: 'config' },

  // -------- 保护 A600–A63A --------
  { reg: 0xa600, name: 'TOV', label: '总压过压保护', offset: 0, gain: 0.1, unit: 'V', min: 1.0, max: 1000.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa601, name: 'TOVD', label: '总压过压保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa602, name: 'TOVR', label: '总压过压释放', offset: 0, gain: 0.1, unit: 'V', min: 0, max: 1000.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa603, name: 'TOVRD', label: '总压过压释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa604, name: 'OV', label: '单体过压保护', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa605, name: 'OVD', label: '单体过压保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa606, name: 'OVR', label: '单体过压释放', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa607, name: 'OVRD', label: '单体过压释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa608, name: 'TUV', label: '总压欠压保护', offset: 0, gain: 0.1, unit: 'V', min: 1.0, max: 1000.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa609, name: 'TUVD', label: '总压欠压保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa60a, name: 'TUVR', label: '总压欠压释放', offset: 0, gain: 0.1, unit: 'V', min: 0, max: 1000.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa60b, name: 'TUVRD', label: '总压欠压释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa60c, name: 'UV', label: '单体欠压保护', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa60d, name: 'UVD', label: '单体欠压保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa60e, name: 'UVR', label: '单体欠压释放', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa60f, name: 'UVRD', label: '单体欠压释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa610, name: 'VDIFF', label: '压差保护', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa611, name: 'VDIFFD', label: '压差保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa612, name: 'VDIFFR', label: '压差保护释放', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa613, name: 'VDIFFRD', label: '压差保护释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa614, name: 'DOT', label: '放电高温保护', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa615, name: 'DOTD', label: '放电高温保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa616, name: 'DOTR', label: '放电高温释放', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa617, name: 'DOTRD', label: '放电高温释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa618, name: 'COT', label: '充电高温保护', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa619, name: 'COTD', label: '充电高温保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa61a, name: 'COTR', label: '充电高温释放', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa61b, name: 'COTRD', label: '充电高温释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa61c, name: 'DUT', label: '放电低温保护', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa61d, name: 'DUTD', label: '放电低温保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa61e, name: 'DUTR', label: '放电低温释放', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa61f, name: 'DUTRD', label: '放电低温释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa620, name: 'CUT', label: '充电低温保护', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa621, name: 'CUTD', label: '充电低温保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa622, name: 'CUTR', label: '充电低温释放', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa623, name: 'CUTRD', label: '充电低温释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa624, name: 'MOSOT', label: 'MOS 高温保护', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa625, name: 'MOSOTD', label: 'MOS 高温保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa626, name: 'MOSOTR', label: 'MOS 高温释放', offset: 400, gain: 0.1, unit: '°C', min: -40.0, max: 200.0, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa627, name: 'MOSOTRD', label: 'MOS 高温释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa628, name: 'COC', label: '充电过流保护', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa629, name: 'COCD', label: '充电过流保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa62a, name: 'COCR', label: '充电过流释放', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa62b, name: 'COCRD', label: '充电过流释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa62c, name: 'DOC', label: '放电过流保护', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa62d, name: 'DOCD', label: '放电过流保护延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa62e, name: 'DOCR', label: '放电过流释放', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa62f, name: 'DOCRD', label: '放电过流释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa630, name: 'DOC2', label: '放电过流保护2', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa631, name: 'DOCD2', label: '放电过流保护2延时', offset: 0, gain: 1, unit: 'S', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa632, name: 'DOCR2', label: '放电过流保护2释放', offset: 0, gain: 0.1, unit: 'A', min: 0, max: 6553.5, decimals: 1, rw: true, group: 'protect' },
  { reg: 0xa633, name: 'DOCRD2', label: '放电过流保护2释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa634, name: 'SCRN', label: '短路保护尝试次数', offset: 0, gain: 1, unit: '次', min: 1, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa635, name: 'SC', label: '短路保护释放延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa636, name: 'bal_EN', label: '均衡开启策略', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa637, name: 'bal_Cur', label: '均衡最大电流', offset: 0, gain: 1, unit: 'mA', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa638, name: 'bal_vdiff', label: '均衡开启压差', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa639, name: 'bal_Vmax', label: '均衡开启最高电压', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },
  { reg: 0xa63a, name: 'bal_Vmin', label: '均衡开启最低电压', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'protect' },

  // -------- 校准 A700–A71D（文档未给 offset/gain，按 raw 系数 gain1/offset0；以设备实测为准） --------
  { reg: 0xa700, name: 'VREF', label: '电压基准', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa701, name: 'CurGain', label: '电流增益系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa702, name: 'CurOffset', label: '静态电流偏置值', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa703, name: 'CurIgnore', label: '电流屏蔽值', offset: 0, gain: 1, unit: 'mA', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa704, name: 'SelfPowerLoss', label: '运行自耗电', offset: 0, gain: 1, unit: 'mA', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa705, name: 'CHGGain', label: '充电电流增益系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa706, name: 'DSGMGain', label: '一阶放电电流增益系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa707, name: 'DSGGain', label: '二阶放电电流增益系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa708, name: 'LowPower', label: '低电量阈值', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa709, name: 'FCC_FLAG', label: '迭代标志位', offset: 0, gain: 1, decimals: 0, rw: true, hint: '⚠️ 源表 HEX 列误填为 42761', group: 'calib' },
  { reg: 0xa70a, name: 'FCC_H', label: '迭代容量上限', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa70b, name: 'FCC_L', label: '迭代容量下限', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa70c, name: 'Cail_HV', label: '高点满充值', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa70d, name: 'Cail_MV', label: '中点电压值', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa70e, name: 'Cail_LV', label: '低点放光值', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa70f, name: 'ChgRate', label: '充电效能系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa710, name: 'DSGRate', label: '放电效能系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa711, name: 'FCCRate', label: '满充容量系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa712, name: 'RunRte', label: '循环标定系数', offset: 0, gain: 1, decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa713, name: 'VEnable', label: '高低点标定使能', offset: 0, gain: 1, decimals: 0, rw: true, options: VENABLE, group: 'calib' },
  { reg: 0xa714, name: 'Vlow_1', label: '1% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa715, name: 'Vlow_2', label: '2% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa716, name: 'Vlow_3', label: '3% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa717, name: 'Vlow_5', label: '5% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa718, name: 'Vlow_8', label: '8% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa719, name: 'Vhigh_92', label: '92% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa71a, name: 'Vhigh_95', label: '95% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa71b, name: 'Vhigh_97', label: '97% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa71c, name: 'Vhigh_98', label: '98% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },
  { reg: 0xa71d, name: 'Vhigh_99', label: '99% 电压标定', offset: 0, gain: 1, unit: 'mV', decimals: 0, rw: true, group: 'calib' },

  // -------- 休眠 A800–A806 --------
  { reg: 0xa800, name: 'Sleep_EN', label: '休眠使能', offset: 0, gain: 1, decimals: 0, rw: true, options: EN, group: 'sleep' },
  { reg: 0xa801, name: 'FastVoltage', label: '快速休眠电压', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },
  { reg: 0xa802, name: 'FastDelay', label: '快速休眠延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },
  { reg: 0xa803, name: 'MidVoltage', label: '中速休眠电压', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },
  { reg: 0xa804, name: 'MidDelay', label: '中速休眠延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },
  { reg: 0xa805, name: 'SlowVoltage', label: '慢速休眠电压', offset: 0, gain: 1, unit: 'mV', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },
  { reg: 0xa806, name: 'SlowDelay', label: '慢速休眠延时', offset: 0, gain: 1, unit: 'S', min: 0, max: 65535, decimals: 0, rw: true, group: 'sleep' },

  // -------- 控制 A900/A901（写专用，功能码 0x10，写 0x0001） --------
  { reg: 0xa900, name: 'RESET', label: '系统重启', offset: 0, gain: 1, decimals: 0, rw: true, group: 'control', hint: '写 0x0001 重启 BMS' },
  { reg: 0xa901, name: 'RECONVERY_BMS', label: 'BMS 恢复出厂', offset: 0, gain: 1, decimals: 0, rw: true, group: 'control', hint: '⚠️ 与 RECONVERY_EC 共用 A901，写 0x0001 格式化全部配置后重启' },
]

// 换算辅助
export function rawToDisplay(def: TianyiParamDef, raw: number): number {
  return (raw - def.offset) * def.gain
}
export function displayToRaw(def: TianyiParamDef, display: number): number {
  return Math.round(display / def.gain + def.offset)
}
export function formatDisplay(def: TianyiParamDef, raw: number): string {
  const v = rawToDisplay(def, raw)
  if (!Number.isFinite(v)) return '--'
  return v.toFixed(def.decimals ?? 0)
}
export function paramsOf(group: TianyiGroup): TianyiParamDef[] {
  return PARAM_DEFS.filter((p) => p.group === group)
}
