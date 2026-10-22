/**
 * 参数镜像层 —— 照搬 SWJ 项目（src/core/params.ts + src/stores/device.ts）的参数链路。
 *
 * 数据模型与 SWJ 一致：`paramState.regs` 是 184 个 u16 寄存器槽位的镜像，
 * ASCII 块另存解码文本（ascii）与原始寄存器字（asciiRaw）。
 *
 * 读取：固定 9 段区间，每段一条 0xFA 批量读，读满 184 个寄存器；
 *       任一字段失败即整批失败（不做逐字段回退）。
 * 写入：进工厂 → 按同样 9 段整包写回 → 退工厂（finally 保证退出）；
 *       ASCII 段优先原样回写 asciiRaw，避免重新编码与设备内校验值不一致。
 * 单段写：进工厂 → 写 → 本地生效 → 回读纠偏 → 退工厂（供单参数下发的场合使用）。
 *
 * 与 SWJ 的差异仅两处：
 *   1) 总线用本项目的 serialBus（Web Serial），不再有 SerialBus 的 Uint8Array 缓冲；
 *   2) 写帧构造走 jbd-protocol.buildWriteParam，其 values 是**字节数组**（N = length/2），
 *      故本层负责把寄存器字拆成高/低字节，等价于 SWJ buildWriteParams 的内部行为。
 */
import { reactive } from 'vue'
import { serialBus, waitRefreshIdle } from './serial-bus'
import {
  CMD,
  buildRead,
  buildReadParam,
  buildWriteParam,
  buildEnterFactory,
  buildExitFactory,
  type Frame
} from './jbd-protocol'

/* ------------------------------------------------------------------ */
/* 读取分段：必须分段，跨 ASCII 块整段读会静默错位（SWJ 实测结论）       */
/* ------------------------------------------------------------------ */
export interface Segment {
  start: number
  count: number
  note: string
}

export const READ_SEGMENTS: Segment[] = [
  { start: 0, count: 56, note: '数值参数区' },
  { start: 56, count: 16, note: '制造商 ASCII' },
  { start: 72, count: 16, note: 'BMS编码 ASCII' },
  { start: 88, count: 16, note: '条形码 ASCII' },
  { start: 104, count: 19, note: 'GPS / VOL 点 / 额定参数' },
  { start: 123, count: 35, note: '预留告警参数' },
  { start: 158, count: 12, note: '电池型号 ASCII' },
  { start: 170, count: 6, note: '唯一 ID' },
  { start: 176, count: 8, note: '硬件名称 ASCII' }
]

/** 参数寄存器总数（0 ~ 183） */
export const REG_COUNT = 184

/**
 * 检流阻值寄存器（reg28）：硬件采样电阻的标定值。
 *
 * 整包写入（全部写入 / 强制下发）一律跳过它——始终回写设备读回的原始字，
 * 页面上的改动不会随整包下发落到设备；只有「检流阻值」自身的单独下发
 * （writeSegment）才真正改写它，避免导入模板/批量下发冲掉硬件标定。
 */
export const REG_SENSE = 28

export interface AsciiBlock {
  key: string
  label: string
  start: number
  count: number
  maxLen: number
}

export const ASCII_BLOCKS: AsciiBlock[] = [
  { key: 'mfr', label: '制造商', start: 56, count: 16, maxLen: 32 },
  { key: 'bmsCode', label: 'BMS编码', start: 72, count: 16, maxLen: 32 },
  { key: 'barcode', label: '条形码', start: 88, count: 16, maxLen: 32 },
  { key: 'model', label: '电池型号', start: 158, count: 12, maxLen: 24 },
  { key: 'hwName', label: '硬件名称', start: 176, count: 8, maxLen: 16 }
]

/**
 * 解码 ASCII 块：块内首字节是有效长度，其后是文本，剩余为填充。
 * @param words 该块的寄存器字（count 个 u16，高字节在前）
 */
export function decodeAsciiBlock(words: number[]): string {
  const bytes: number[] = []
  for (const w of words) bytes.push((w >> 8) & 0xff, w & 0xff)
  const len = Math.min(bytes[0] ?? 0, Math.max(0, bytes.length - 1))
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[1 + i])
  return s.replace(/\0+$/, '')
}

/**
 * 编码 ASCII 块：首字节写文本字节数，其后写文本，剩余补 0。
 *
 * 设备上的原始块未必符合这个规则，所以「原样回写」必须用读到的原始字节，
 * 本函数只用于用户真正改动了文本的场合。
 */
export function encodeAsciiBlock(text: string, count: number): number[] {
  const total = count * 2
  const bytes: number[] = new Array(total).fill(0)
  const enc: number[] = []
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    enc.push(c > 0 && c < 0x80 ? c : 0x3f)
  }
  const n = Math.min(enc.length, Math.max(0, total - 1))
  bytes[0] = n
  for (let i = 0; i < n; i++) bytes[1 + i] = enc[i]
  const words: number[] = []
  for (let i = 0; i < total; i += 2) {
    words.push((((bytes[i] ?? 0) & 0xff) << 8) | ((bytes[i + 1] ?? 0) & 0xff))
  }
  return words
}

/* ------------------------------------------------------------------ */
/* 全局参数状态                                                        */
/* ------------------------------------------------------------------ */
export interface ProgressState {
  active: boolean
  label: string
  detail: string
  done: number
  total: number
}

export const paramState = reactive({
  /** 184 个寄存器槽位（0 ~ 183），与设备 0xFA 参数区一一对应 */
  regs: [] as number[],
  /** ASCII 块：起始寄存器 → 解码文本 */
  ascii: {} as Record<number, string>,
  /** ASCII 块：起始寄存器 → 原始寄存器字（读回时保存，写入时原样回写） */
  asciiRaw: {} as Record<number, number[]>,
  /**
   * 检流阻值（reg28）的设备基准字：读参时记录，单独下发成功后同步为回读值。
   * 整包写入用它覆盖镜像里的编辑值，等价于「跳过 reg28、不动设备标定」。
   */
  senseRaw: null as number | null,
  /** 芯片类型（0x00 指令读取，决定二级过流/短路的档位物理量） */
  chipType: 0,
  /** 是否已从设备读取过完整参数（写入前置门禁） */
  paramsLoaded: false,
  /** 当前是否处于工厂模式（写入/单段写期间为 true） */
  inFactory: false,
  /** 参数来自哪个导入文件（导入后显示文件名，读取设备值时清空） */
  importFile: '',
  busy: false,
  lastError: '',
  progress: { active: false, label: '', detail: '', done: 0, total: 0 } as ProgressState
})

function progressStart(label: string, total: number): void {
  paramState.progress.active = true
  paramState.progress.label = label
  paramState.progress.detail = ''
  paramState.progress.done = 0
  paramState.progress.total = Math.max(1, total)
}

function progressNote(detail: string): void {
  paramState.progress.detail = detail
}

function progressStep(): void {
  const p = paramState.progress
  p.done = Math.min(p.total, p.done + 1)
}

function progressEnd(): void {
  const p = paramState.progress
  p.active = false
  p.detail = ''
  p.done = 0
  p.total = 0
}

export function clearParamError(): void {
  paramState.lastError = ''
}

/* ------------------------------------------------------------------ */
/* 帧收发                                                              */
/* ------------------------------------------------------------------ */
async function txn(frame: number[], cmd: number, timeoutMs = 1500, retries = 1): Promise<Frame> {
  return serialBus.transact(frame, cmd, timeoutMs, retries)
}

const readWord = (d: number[], off: number): number => (((d[off] ?? 0) << 8) | (d[off + 1] ?? 0)) & 0xffff

/** 寄存器字数组 → 字节数组（buildWriteParam 的 values 口径） */
function toBytes(words: number[]): number[] {
  const out: number[] = []
  for (const w of words) out.push((w >> 8) & 0xff, w & 0xff)
  return out
}

/* ------------------------------------------------------------------ */
/* 读取全部参数                                                        */
/* ------------------------------------------------------------------ */
export async function loadParams(): Promise<boolean> {
  if (!serialBus.isOpen) {
    paramState.lastError = '串口未打开'
    return false
  }
  await waitRefreshIdle()
  paramState.busy = true
  paramState.lastError = ''
  progressStart('读取参数', READ_SEGMENTS.length + 1)
  try {
    const regs = new Array(REG_COUNT).fill(0)
    const ascii: Record<number, string> = {}
    const asciiRaw: Record<number, number[]> = {}

    // 芯片类型（决定位域换算），失败不阻断整批读取
    progressNote('芯片类型 (0x00)')
    try {
      const rc = await txn(buildRead(CMD.CHIP_TYPE), CMD.CHIP_TYPE, 1200, 2)
      if (rc.status === 0 && rc.data.length >= 2) paramState.chipType = readWord(rc.data, 0)
    } catch {
      paramState.chipType = 0
    }
    progressStep()

    for (const seg of READ_SEGMENTS) {
      const last = seg.start + seg.count - 1
      progressNote(`寄存器 ${seg.start}–${last}（${seg.note}）`)
      const r = await txn(buildReadParam(seg.start, seg.count), CMD.PARAM, 2000, 3)
      if (r.status !== 0) throw new Error(`段 ${seg.start} 返回状态 0x${r.status.toString(16)}`)
      const d = r.data
      if (d.length < 3) throw new Error(`段 ${seg.start} 数据过短`)
      const echoStart = readWord(d, 0)
      if (echoStart !== seg.start) throw new Error(`段 ${seg.start} 回显地址不符（${echoStart}）`)

      const isAscii = ASCII_BLOCKS.some((a) => a.start === seg.start)
      if (isAscii) {
        const words: number[] = []
        for (let k = 0; k < seg.count; k++) words.push(readWord(d, 3 + 2 * k))
        asciiRaw[seg.start] = words
        ascii[seg.start] = decodeAsciiBlock(words)
      } else {
        for (let k = 0; k < seg.count; k++) regs[seg.start + k] = readWord(d, 3 + 2 * k)
      }
      progressStep()
    }

    paramState.regs = regs
    paramState.ascii = ascii
    paramState.asciiRaw = asciiRaw
    paramState.senseRaw = regs[REG_SENSE] & 0xffff
    paramState.paramsLoaded = true
    // 界面值已与设备一致，导入文件不再代表当前参数
    paramState.importFile = ''
    return true
  } catch (e) {
    paramState.lastError = (e as Error).message
    return false
  } finally {
    progressEnd()
    paramState.busy = false
  }
}

/* ------------------------------------------------------------------ */
/* 写入全部参数                                                        */
/* ------------------------------------------------------------------ */
/**
 * 组装某一段的写数据：返回**寄存器字**数组，长度必须等于 count。
 *
 * ASCII 段优先原样回写读到的原始字：设备上的块并不严格遵循「首字节=长度、
 * 其余补 0」的规则，重新编码会与设备内的校验值不一致。
 */
function segmentPayload(
  start: number,
  count: number,
  regs: number[],
  ascii: Record<number, string>,
  asciiRaw: Record<number, number[]>
): number[] {
  const block = ASCII_BLOCKS.find((a) => a.start === start)
  if (block) {
    const raw = asciiRaw[start]
    if (raw && raw.length === count && decodeAsciiBlock(raw) === (ascii[start] ?? '')) {
      return raw.slice()
    }
    return encodeAsciiBlock(ascii[start] ?? '', count)
  }
  const words: number[] = []
  for (let k = 0; k < count; k++) words.push((regs[start + k] ?? 0) & 0xffff)
  return words
}

/**
 * 写入全部参数：进工厂 → 逐段整包写 → 退工厂
 * 数值段按寄存器原值写入，ASCII 段优先按读到的原始字节回写。
 */
export async function writeParams(
  regs: number[],
  ascii: Record<number, string>,
  asciiRaw: Record<number, number[]> = paramState.asciiRaw
): Promise<boolean> {
  if (!serialBus.isOpen) {
    paramState.lastError = '串口未打开'
    return false
  }
  await waitRefreshIdle()
  paramState.busy = true
  paramState.lastError = ''
  let inFactory = false
  progressStart('写入参数', READ_SEGMENTS.length + 2)
  try {
    // 检流阻值（reg28）跳过：整包下发只回写设备基准字，页面改动不会落到设备。
    // 单独下发走 writeSegment，成功后会同步 senseRaw（见下方 writeSegment）。
    const payloadRegs = regs.slice()
    if (paramState.senseRaw != null) payloadRegs[REG_SENSE] = paramState.senseRaw

    progressNote('进入工厂模式')
    const rIn = await txn(buildEnterFactory(), CMD.CHIP_TYPE, 1500, 2)
    if (rIn.status !== 0) throw new Error(`进入工厂模式失败（0x${rIn.status.toString(16)}）`)
    inFactory = true
    paramState.inFactory = true
    progressStep()

    for (const seg of READ_SEGMENTS) {
      const last = seg.start + seg.count - 1
      progressNote(`写入寄存器 ${seg.start}–${last}（${seg.note}）`)
      const words = segmentPayload(seg.start, seg.count, payloadRegs, ascii, asciiRaw)
      // 写帧里的 N 必须是寄存器个数，且不能跨越 184 个寄存器的边界
      if (words.length !== seg.count) {
        throw new Error(`段 ${seg.start} 数据长度异常（${words.length} ≠ ${seg.count}）`)
      }
      if (seg.start + words.length > REG_COUNT) {
        throw new Error(`段 ${seg.start} 越界（写到 ${seg.start + words.length - 1}）`)
      }
      const r = await txn(buildWriteParam(seg.start, toBytes(words)), CMD.PARAM, 2000, 2)
      if (r.status >= 0x80) {
        throw new Error(`段 ${seg.start} 写入被拒（0x${r.status.toString(16)}）`)
      }
      progressStep()
    }

    // 整包写成功：设备上的 reg28 仍是基准值，把镜像同步回去，
    // 避免界面显示一个设备里并不存在的检流阻值
    if (paramState.senseRaw != null) paramState.regs[REG_SENSE] = paramState.senseRaw

    progressNote('退出工厂模式')
    return true
  } catch (e) {
    paramState.lastError = (e as Error).message
    return false
  } finally {
    if (inFactory) {
      try {
        await txn(buildExitFactory(), CMD.EXIT_FACTORY, 1500, 2)
      } catch (e) {
        paramState.lastError = `退出工厂模式异常：${(e as Error).message}`
      }
      paramState.inFactory = false
    }
    progressEnd()
    paramState.busy = false
  }
}

/* ------------------------------------------------------------------ */
/* 单段写入（单参数下发 / ASCII 块下发）                                */
/* ------------------------------------------------------------------ */
/**
 * 写入一段寄存器字：进工厂 → 写 → 本地生效 → 回读纠偏 → 退工厂。
 *
 * @param values 寄存器字数组，长度即写入个数
 * @param label  进度与日志里的名称
 * @param apply  本地生效回调：写帧被设备接受后立即调用一次，再用回读结果纠偏
 */
export async function writeSegment(
  start: number,
  values: number[],
  label: string,
  apply: (words: number[]) => void
): Promise<boolean> {
  if (!serialBus.isOpen) {
    paramState.lastError = '未连接设备，无法下发'
    return false
  }
  await waitRefreshIdle()
  paramState.busy = true
  paramState.lastError = ''
  let inFactory = false
  progressStart(`下发${label}`, 4)
  try {
    progressNote('进入工厂模式')
    const rIn = await txn(buildEnterFactory(), CMD.CHIP_TYPE, 1500, 2)
    if (rIn.status !== 0) throw new Error(`进入工厂模式失败（0x${rIn.status.toString(16)}）`)
    inFactory = true
    paramState.inFactory = true
    progressStep()

    progressNote(`写入${label}`)
    const r = await txn(buildWriteParam(start, toBytes(values)), CMD.PARAM, 2000, 2)
    if (r.status >= 0x80) throw new Error(`写入被拒（0x${r.status.toString(16)}）`)
    progressStep()

    // 写帧已被设备接受 → 本地立即生效，界面随之同步
    apply(values)

    // 回读纠偏：以设备返回的真实字为准（设备可能截断、补位或量化）
    progressNote(`回读${label}`)
    const back = await txn(buildReadParam(start, values.length), CMD.PARAM, 2000, 2)
    if (back.status === 0 && back.data.length >= 3 + values.length * 2) {
      const words: number[] = []
      for (let k = 0; k < values.length; k++) words.push(readWord(back.data, 3 + 2 * k))
      apply(words)
    }
    // 单独下发覆盖到 reg28 时，设备基准随之改变，后续整包下发以新值为准回写
    if (start <= REG_SENSE && REG_SENSE < start + values.length) {
      paramState.senseRaw = paramState.regs[REG_SENSE] & 0xffff
    }
    progressStep()
    return true
  } catch (e) {
    paramState.lastError = (e as Error).message
    return false
  } finally {
    if (inFactory) {
      try {
        await txn(buildExitFactory(), CMD.EXIT_FACTORY, 1500, 2)
      } catch (e) {
        paramState.lastError = `退出工厂模式异常：${(e as Error).message}`
      }
      paramState.inFactory = false
    }
    progressEnd()
    paramState.busy = false
  }
}
