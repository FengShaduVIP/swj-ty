/** 参数下发/读取引擎（自 JbdParamConfig.vue 拆出的共享单例）：
 *  参数配置页与产线下发页共用同一套 0xFA 读写、工厂模式、回读校验与派工上传逻辑，
 *  字段状态来自 groupDefs 的 builtGroups 模块单例，两页看到的是同一份数据。
 *  依赖注入说明：引擎不感知组件 props，通过 useDispatch({ connected, authSession,
 *  confirmPassword }) 在组件 setup 时登记取值回调（两页传入的均为 App 顶栏同一状态）。 */
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildReadParam, buildWriteParam, buildSetBtName,
  buildControlCommand, CONTROL_FUNC,
} from '@/jbd/jbd-protocol'
import type { Frame } from '@/jbd/jbd-protocol'
import {
  paramRawToDisplay, paramDisplayToRaw, splitScd, combineScd,
} from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import { addDispatchRecord, type DispatchParam } from '@/db/dispatchLog'
import { canDispatchParameters, isAuthSessionValid, type AuthSession } from '@/auth/auth'
import { buildDispatchSnapshot, shouldUploadDispatchRecord, shouldUploadDispatchResult } from '@/dispatch/uploadDecision'
import { FRAME_TIMEOUT_MS } from '@/constants'
import { useFactory } from './useFactory'
import { buildColumnsFromTitles, defaultColumnOrder } from './groupDefs'
import type { FieldState, GroupObj } from './types'

// ====== 依赖登记（组件 setup 时注入；引擎函数在调用瞬间读取最新值）======
export type RendererAuthSession = Pick<AuthSession, 'userId' | 'username' | 'expiresTime'>
export interface DispatchDeps {
  /** 串口是否已连接（与 App 顶栏 connected 同源） */
  connected: () => boolean
  /** 后台登录会话；未登录时禁止一切下发 */
  authSession: () => RendererAuthSession | null
  /** needPassword 字段下发前的密码确认（参数配置页提供弹窗实现；未提供则拒绝下发） */
  confirmPassword?: () => Promise<boolean>
}
const deps: DispatchDeps = {
  connected: () => false,
  authSession: () => null,
  confirmPassword: async () => {
    ElMessage.warning('当前页面不支持该参数的密码校验，请前往「参数配置」页下发')
    return false
  },
}

function ensureDispatchAllowed(): boolean {
  if (!deps.connected()) {
    ElMessage.warning('请先连接串口')
    return false
  }
  if (!isAuthSessionValid(deps.authSession())) {
    ElMessage.warning('请先登录后台，再下发参数')
    return false
  }
  return true
}

/** 方案 B：只要有参数下发成功，就把当前已知完整参数快照上传后台；V3-- 前缀才上传。 */
async function uploadDispatchSnapshot(): Promise<void> {
  const btField = allFields.value.find((f) => f.key === 'bt-name')
  const btName = btField && btField.value != null ? String(btField.value) : ''
  if (!shouldUploadDispatchRecord(btName)) return

  const params = buildDispatchSnapshot(allFields.value)
  if (!params.length) return
  if (!window.dispatchAPI) {
    ElMessage.warning('当前环境不支持上传下发记录')
    return
  }

  const result = await window.dispatchAPI.upload({
    btName,
    dispatchedAt: Date.now(),
    params,
  })
  if (!result.ok) {
    ElMessage.warning(result.error || '参数已下发，但后台同步失败')
    return
  }
  ElMessage.info('已上传最新下发参数到后台')
}

// ====== 字段集合：与 JbdParamConfig 的 columns 引用同一批 GroupObj 实例 ======
// builtGroups 是模块单例池，buildColumnsFromTitles 每次返回的都是同一批对象；
// 经 ref 包装后拿到的是同一批 reactive 代理，任一页面的改动对两页 UI 同时生效。
const engineColumns = ref<GroupObj[][]>(buildColumnsFromTitles(defaultColumnOrder))
const allFields = computed(() => engineColumns.value.flat().flatMap((g) => g.fields))

// 单字段可写判定：与组件模板的下发按钮禁用态同口径（引擎内的 writeField 亦复用）
function canWrite(f: FieldState): boolean {
  if (!canDispatchParameters(deps.connected(), deps.authSession())) return false
  // 批量读/写下发进行中禁止单字段下发，避免并发 0xFA 等待者互相抢帧
  if (busy.value) return false
  if (f.readOnly) return false
  // 生产日期：customDisplay 但可写（日期选择器 → raw → 下发）
  if (f.customDisplay === 'date' && f.index !== undefined) return f.value !== null
  if (f.customDisplay) return false
  if (isBitSwitch(f)) return false  // 位开关通过 group.action 或 writeAll 下发
  // ASCII：值为字符串（可空串），index 必须存在
  if (f.ascii) return f.index !== undefined && typeof f.value === 'string'
  return f.value !== null && f.index !== undefined
}

// 工厂模式进入/退出（见 useFactory.ts）；引擎持有唯一实例，两页共享工厂态
const { autoFactory, inFactory, enterFactory, exitFactory } = useFactory()
const j = useJbd()
// 批量读/写进行中标志：直接使用 useJbd 的共享 batchBusy，
// 使批量操作期间实时监测的自动轮询自动暂停（批量结束后恢复），批量帧不再与轮询帧抢总线。
const busy = j.batchBusy
const progress = ref(0)

// ====== ASCII 解析 ======
/** 从 0xFA 多寄存器应答中解码 ASCII 字串
 *  响应格式：[regH, regL, count, v0H, v0L, v1H, v1L, ...]
 *  按 PDF V12：条形码/BMS 编码/厂商信息均采用 ASCII 码传送，第一个字节 = 字符串长度，
 *  后续字节为 ASCII 字符。寄存器按大端存放（高字节在前），因此直接顺序取 data[3..] 即为字节流。
 */
function parseAsciiResponse(resp: Frame | null, maxBytes: number): string {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return ''
  const data = resp.data
  if (!data || data.length < 4) return ''
  const count = data[2]
  if (count < 1 || data.length < 3 + count * 2) return ''
  // 顺序取字节：data[3]=v0H, data[4]=v0L, data[5]=v1H, data[6]=v1L ...
  const total = Math.min(count * 2, maxBytes)
  const bytes = data.slice(3, 3 + total)
  // 第一字节为字符串长度（UTF-8 字节数），后续字节为名称的 UTF-8 编码
  const len = bytes[0] & 0xff
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text: string
  if (len > 0 && len < bytes.length) {
    text = decoder.decode(new Uint8Array(bytes.slice(1, 1 + len)))
  } else {
    // 无长度字节或长度为 0：把后续所有字节当字符串解码
    text = decoder.decode(new Uint8Array(bytes.slice(1)))
  }
  // 仅剔除控制字符（保留可打印 ASCII、CJK 等多字节字符）
  return text.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

// ====== 位开关共享位图 ======
/** reg -> raw bitmap (0~0xFFFF)；所有同 bitIndex 的位开关共用同一份位图 */
const bitmaps = ref<Record<number, number | null>>({})
function popcount(n: number): number {
  let c = 0
  while (n) { c += n & 1; n >>>= 1 }
  return c
}
/** NTC 使能数 = index 30 bitmap 共 16 位（温度探头_1~16，bit0~15）的 popcount
 *  按 PDF：寄存器 30 = 温度探头配置，2 字节，每 1 bit 对应一路探头使能。
 */
const ntcCount = computed(() => {
  const v = bitmaps.value[30]
  return v === null || v === undefined ? 0 : popcount(v & 0xffff)
})

function isBitSwitch(f: FieldState): boolean {
  return f.bitIndex !== undefined && f.bit !== undefined && f.customDisplay !== 'balanceMode'
}

/** ASCII 字段编码：字符串 → (ascii_len 个寄存器 = ascii_len*2 字节)
 *  按 PDF 格式：第 1 字节为字符串长度（字符数），后面紧跟 ASCII 字符，不足补 0。
 */
function encodeAsciiValue(f: FieldState): number[] {
  const maxBytes = (f.ascii_len ?? 8) * 2
  const str = String(f.value ?? '')
  const bytes: number[] = [str.length & 0xff]
  for (let i = 0; i < maxBytes - 1; i++) {
    bytes.push(i < str.length ? (str.charCodeAt(i) & 0xff) : 0)
  }
  return bytes
}

/** 取同 index 的另一个 part 字段（用于合成下发） */
function scdPeer(f: FieldState): FieldState | undefined {
  return allFields.value.find(
    (x) => x.index === f.index && x.kind === 'scd' && x.scdPart !== f.scdPart,
  )
}

function parseParamResponse(resp: Frame | null): number | null {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return null
  if (resp.data.length < 5) return null
  const reg = (resp.data[0] << 8) | resp.data[1]
  const count = resp.data[2]
  if (count < 1 || resp.data.length < 5 + (count - 1) * 2) return null
  const raw = ((resp.data[3] << 8) | resp.data[4]) & 0xffff
  return raw
}

// ====== 寄存器感知的 0xFA 应答等待 ======
// onceResponse 仅按命令码 0xFA 配对应答，先前请求「迟到」的帧会被当前等待误收，
// 而 parseParamResponse/parseAsciiResponse 都不校验响应里的寄存器地址 ——
// 回读值会取到别的寄存器，造成校验误报（错误消息里的『读取』值本身就是错的数据）
// 或错位值恰好相等时的漏报。本函数在总超时预算内循环等待，只接受
// 「命令码 0xFA + 状态 0x00 + 起始寄存器与请求一致（count ≥ minCount）」的帧，
// 其余脏帧丢弃后继续等剩余预算；预算耗尽返回 null（与超时同义）。
async function awaitParamResponse(expectReg: number, timeoutMs = FRAME_TIMEOUT_MS, minCount = 1): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rest = deadline - Date.now()
    if (rest <= 0) return null
    const resp = await jbdBus.onceResponse(rest, 0xfa)
    if (!resp || resp.timeout) return null
    if (resp.status !== 0x00 || !resp.data || resp.data.length < 3) continue
    const reg = (resp.data[0] << 8) | resp.data[1]
    if (reg !== expectReg || resp.data[2] < minCount) continue
    return resp
  }
}

/** 批量读（0xFA 多寄存器）应答等待：与 awaitParamResponse 同思路，在总预算内循环等待，
 *  丢弃寄存器地址/数量不符的脏帧（如前序请求迟到的应答），只接受
 *  「命令码 0xFA + 状态 0x00 + 起始寄存器与 count 均与请求一致」的帧；预算耗尽返回 null。 */
async function awaitBatchResponse(expectStart: number, expectCount: number, timeoutMs: number): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rest = deadline - Date.now()
    if (rest <= 0) return null
    const resp = await jbdBus.onceResponse(rest, 0xfa)
    if (!resp || resp.timeout) return null
    if (resp.status !== 0x00 || !resp.data || resp.data.length < 3) continue
    const reg = (resp.data[0] << 8) | resp.data[1]
    if (reg !== expectStart || resp.data[2] !== expectCount) continue
    if (resp.data.length < 3 + expectCount * 2) continue
    return resp
  }
}

// ====== 总线世代计数 ======
// 批量操作（读取全部 / 本组读取 / 下发）开始时自增；单写下发遗留的后台回读校验
// （void verifyField，不 await）检测到世代变化即静默退出，避免其 0xFA 读取
// 与批量流程的帧互抢导致校验误报。批量自身内部串行校验不受影响。
let busEpoch = 0
/** 组件内自定义批量流程（如参数配置页的模板一键下发）接管总线前自增世代 */
function bumpBusEpoch() { busEpoch++ }

// ====== 读取/写入单个字段 ======
async function readField(f: FieldState, timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  if (!deps.connected()) return false
  // 不能读取：非 date/serialRaw 的 customDisplay、无 index 的 readOnly
  const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
  if ((f.customDisplay && !canReadCustomDisplay) || (f.readOnly && f.index === undefined)) {
    ElMessage.warning(`[${f.label}] 无可读取寄存器`)
    return false
  }
  // 读取参数不进入/退出工厂模式（与「读取全部」保持一致），普通模式即可读。
  f.status = 'reading'
  // 位开关：读一次位图，所有同位图字段同步
  if (isBitSwitch(f)) {
    jbdBus.send(buildReadParam(f.bitIndex!, 1))
    const resp = await awaitParamResponse(f.bitIndex!, timeoutMs)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    bitmaps.value[f.bitIndex!] = raw
    const peers = allFields.value.filter((x) => x.bitIndex === f.bitIndex)
    for (const p of peers) {
      p.value = ((raw >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
      p.status = 'ok'
    }
    return true
  }
  // ASCII 块：读 N 个寄存器（普通模式即可读取，不进入工厂模式）
  // 蓝牙名称(index 88)读取即 0xFA 88~103 条形码信息，显示其条形码数值；
  // 仅下发蓝牙名称时才使用专用 0xA2 指令（见 sendFields 写分支）。
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    jbdBus.send(buildReadParam(f.index!, len))
    // ASCII 块要求响应 count ≥ len（起始寄存器已由 awaitParamResponse 校验）
    const resp = await awaitParamResponse(f.index!, timeoutMs, len)
    if (!resp) {
      f.status = 'fail'; return false
    }
    const text = parseAsciiResponse(resp, len * 2)
    f.value = text
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // date / serialRaw：读 raw 值，由 customDisplay 格式化
  if (canReadCustomDisplay && f.index !== undefined) {
    jbdBus.send(buildReadParam(f.index, 1))
    const resp = await awaitParamResponse(f.index, timeoutMs)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    f.value = raw
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // 复合保护字段（scd）：高字节=保护值档位、低字节=延迟档位
  if (f.kind === 'scd') {
    jbdBus.send(buildReadParam(f.index!, 1))
    const resp = await awaitParamResponse(f.index!, timeoutMs)
    const raw = parseParamResponse(resp)
    if (raw === null) {
      f.status = 'fail'; return false
    }
    const { level, delay } = splitScd(raw)
    const peer = scdPeer(f)
    if (f.scdPart === 'level') f.value = level
    else f.value = delay
    if (peer) peer.value = f.scdPart === 'level' ? delay : level
    f.dirty = false
    f.status = 'ok'
    if (peer) { peer.dirty = false; peer.status = 'ok' }
    return true
  }
  // 下拉选项字段：value 直接存原始寄存器值
  if (f.options) {
    jbdBus.send(buildReadParam(f.index!, 1))
    const resp = await awaitParamResponse(f.index!, timeoutMs)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    f.value = raw & 0xffff
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // 普通数值
  jbdBus.send(buildReadParam(f.index!, 1))
  const resp = await awaitParamResponse(f.index!)
  const raw = parseParamResponse(resp)
  if (raw === null) { f.status = 'fail'; return false }
  f.value = paramRawToDisplay(f.index!, raw)
  f.dirty = false
  f.status = 'ok'
  return true
}

/** 单个参数下发成功后：标记状态并弹出成功提示 */
function markWriteOk(f: FieldState): true {
  f.status = 'ok'
  f.dirty = false
  ElMessage.success(`写参数[${f.label}]成功`)
  return true
}

// ====== 下发后自动回读校验 ======
// 触发：普通下发(writeField) 与 强制/全部下发(sendFields) 中每次字段写入成功后。
// 流程：写入前已捕获「期望值快照」→ 写入成功后自动发一次读取指令(readField，内建 1500ms 超时)
//      → 比较期望值与读取回来的数值是否一致；不一致/超时/读取失败 → 字段 status='fail'(行内标红)
//      + ElMessage.error 明确文案，便于定位问题。
// 回读复用已验证可靠的单参数逐读路径(readField)，规避设备对 ASCII 块(88~103)/scd 复合寄存器
// 大跨度批量读返回错位数据的问题；超时机制由 readField 的 onceResponse(1500, 0xfa) 提供。

export interface WriteExpect {
  /** 写入前捕获的期望「显示值」(数值/scd 档位/date/serialRaw) */
  display?: any
  /** 写入前捕获的期望 ASCII 文本（ascii 字段） */
  ascii?: string
  /** 写入前捕获的期望原始 16 位值（scd 组合 / options / 普通数值回退比对） */
  raw?: number
}

/** 捕获字段「写入前」的期望值快照，供写入成功后回读校验比对。
 *  必须在 send/write 指令发出之前调用（写入成功后 readField 会改写 f.value）。 */
function captureExpect(f: FieldState): WriteExpect {
  if (f.ascii) return { ascii: String(f.value ?? '') }
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    return { raw: combineScd(level, delay) & 0xffff }
  }
  if (f.options) return { raw: Number(f.value ?? 0) & 0xffff }
  // 普通数值 / date / serialRaw：保存显示值，比对时换算回 raw 再比，容忍展示精度误差
  if (f.index !== undefined) {
    const dv = paramDisplayToRaw(f.index, f.value)
    return { display: f.value, raw: dv & 0xffff }
  }
  return { display: f.value }
}

/** 把字段当前回读值解析为一个可比对的值（与 captureExpect 同口径） */
function currentExpectLike(f: FieldState): WriteExpect {
  if (f.ascii) return { ascii: String(f.value ?? '') }
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    return { raw: combineScd(level, delay) & 0xffff }
  }
  if (f.options) return { raw: Number(f.value ?? 0) & 0xffff }
  if (f.index !== undefined) {
    const dv = paramDisplayToRaw(f.index, f.value)
    return { display: f.value, raw: dv & 0xffff }
  }
  return { display: f.value }
}

/** 比对期望值与回读值；返回 null 表示一致，否则返回明确的异常描述。 */
function diffMessage(f: FieldState, exp: WriteExpect, got: WriteExpect): string | null {
  // 1) ASCII：直接比文本
  if (f.ascii) {
    const e = (exp.ascii ?? '').trim()
    const g = (got.ascii ?? '').trim()
    if (e === g) return null
    return `下发值与读取不一致：下发「${e}」 读取「${g}」（ASCII 参数）`
  }
  // 2) 其余：优先比 raw（规避浮点展示误差），再比 display
  const er = exp.raw
  const gr = got.raw
  if (er !== undefined && gr !== undefined && er !== gr) {
    return `下发值与读取不一致：下发 0x${er.toString(16).toUpperCase().padStart(4, '0')} 读取 0x${gr.toString(16).toUpperCase().padStart(4, '0')}`
  }
  // raw 缺失时回退比对显示值（数值型允许展示精度截断，故仅当差异超出 1e-6 才报）
  const ed = exp.display
  const gd = got.display
  if (ed !== undefined && gd !== undefined && typeof ed === 'number' && typeof gd === 'number') {
    if (Math.abs(Number(ed) - Number(gd)) > 1e-6) {
      return `下发值与读取不一致：下发 ${ed} 读取 ${gd}`
    }
  }
  return null
}

/** 下发成功后自动回读校验：
 *  - 先发一次读取指令(readField，内建 1500ms 超时)；超时/失败 → 视为校验未通过；
 *  - 比对期望值与读取值，不一致 → 行内标红(status='fail') + 明确错误提示；
 *  - 一致 → 保持 status='ok'，不额外打扰用户。
 * 注：readField 本身会把读取结果写回 f.value，故比对用的「回读值」取自 readField 之后的 f。 */
async function verifyField(f: FieldState, exp: WriteExpect, epoch = busEpoch): Promise<void> {
  // 世代已变：批量操作（读取全部/下发/本组读取）已接管总线，静默退出避免 0xFA 帧互抢
  if (busEpoch !== epoch) return
  // scd 复合字段：整寄存器由 level part 代表写入，校验失败需把 delay part(peer) 一并标红
  const peer = f.kind === 'scd' ? scdPeer(f) : undefined
  const failBoth = (msg: string) => {
    f.status = 'fail'
    f.dirty = true
    if (peer) { peer.status = 'fail'; peer.dirty = true }
    ElMessage.error(`校验失败[${f.label}]：${msg}`)
  }
  const passBoth = () => {
    f.status = 'ok'
    f.dirty = false
    if (peer) { peer.status = 'ok'; peer.dirty = false }
  }
  // scd 复合字段（寄存器 40 二级过流 / 41 短路，各 2 字节）：
  // 直接比对「整寄存器下发字节」与「整寄存器回读字节」，不做 splitScd 拆分比对。
  // 设备如实回写则整值相等 → 保护值档 + 延时档两个 part 自然都一致（整寄存器对得上）；
  // 整值不等才判校验失败，并把 level/delay 两个 part 一并标红，便于定位。
  if (f.kind === 'scd' && f.index !== undefined) {
    // scd 回读也重试 3 次（与非 scd 一致），吸收强制下发批量帧密集导致的偶发超时
    let okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
    if (!okRead && busEpoch === epoch) okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
    if (!okRead && busEpoch === epoch) okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
    if (busEpoch !== epoch) return
    if (!okRead) {
      failBoth('读取超时或无响应（设备未正确返回下发结果）')
      return
    }
    // readField 已把整寄存器回读值拆显到 f.value / peer.value（UI 显示档位），
    // 这里按 scdPart 位置重组出整寄存器值，与下发时的整寄存器值(exp.raw)直接比对。
    const selfGot = Number(f.value ?? 0)
    const peerGot = peer ? Number(peer.value ?? 0) : 0
    const gotRaw = f.scdPart === 'level'
      ? combineScd(selfGot, peerGot) & 0xffff   // self=level 高4位, peer=delay 低4位
      : combineScd(peerGot, selfGot) & 0xffff   // self=delay 低4位, peer=level 高4位
    if (gotRaw !== (exp.raw! & 0xffff)) {
      const eL = (exp.raw! >> 4) & 0x0f
      const eD = exp.raw! & 0x0f
      const gL = (gotRaw >> 4) & 0x0f
      const gD = gotRaw & 0x0f
      failBoth(`下发值与读取不一致：下发(整寄存器=0x${exp.raw!.toString(16).padStart(4, '0')} level=0x${eL.toString(16)} delay=0x${eD.toString(16)}) 读取(整寄存器=0x${gotRaw.toString(16).padStart(4, '0')} level=0x${gL.toString(16)} delay=0x${gD.toString(16)})`)
      return
    }
    passBoth()
    return
  }
  // 其余字段：复用 readField（已内建 1500ms 超时），失败重试两次吸收批量帧拥挤超时
  // ASCII 字段特殊处理：readField 回读可能把 f.value 覆写为空（parseAsciiResponse
  // 对 BMS 编码信息等大跨度 ASCII 块校验失败返回空串），故比对前保存用户原值，
  // 校验失败时只标红、并恢复 f.value 为用户原下发内容，避免界面显示为空。
  const savedValue = f.value
  let okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
  if (!okRead && busEpoch === epoch) okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
  if (!okRead && busEpoch === epoch) okRead = await readField(f, VERIFY_READ_TIMEOUT_MS)
  if (busEpoch !== epoch) return
  if (!okRead) {
    f.value = savedValue
    failBoth('读取超时或无响应（设备未正确返回下发结果）')
    return
  }
  const got = currentExpectLike(f)
  const diff = diffMessage(f, exp, got)
  if (diff) {
    f.value = savedValue
    failBoth(diff)
  } else {
    passBoth()
  }
}

/** 下发成功后立即标记 ok，并异步触发回读校验（校验失败会翻红 field.status）。
 *  不 await 校验结果，避免阻塞 writeField 的返回；校验反馈通过行内标红 + 错误提示表达。
 *  捕获当前总线世代：若校验期间有批量操作（读取全部/下发等）接管总线，则静默退出避免抢帧。 */
function markWriteOkWithVerify(f: FieldState, exp: WriteExpect): true {
  markWriteOk(f)
  void verifyField(f, exp, busEpoch)
  return true
}

async function writeField(f: FieldState): Promise<boolean> {
  if (!ensureDispatchAllowed()) return false
  if (!canWrite(f)) return false
  let mirrorUploaded = false
  // 标称容量单独下发时，也同步镜像满充容量（与批量下发/导入/强制下发行为一致）
  if (f.index === 0) {
    const full = allFields.value.find((x) => x.index === 112)
    if (full && f.value != null) {
      full.value = f.value
      mirrorUploaded = shouldUploadDispatchResult(await sendFields([full]))
    }
  }
  const ok = await writeFieldDirect(f)
  if (ok && !mirrorUploaded) await uploadDispatchSnapshot()
  return ok
}

async function writeFieldDirect(f: FieldState): Promise<boolean> {
  if (!canWrite(f)) return false
  // 写入前捕获期望值快照（校验用），必须在下发指令发出前完成
  const exp = captureExpect(f)
  f.status = 'writing'
  if (autoFactory.value && !inFactory.value) {
    const ok = await enterFactory()
    if (!ok) { f.status = 'fail'; return false }
  }
  // ASCII 字段：多寄存器写（ascii_len 个寄存器 → ascii_len*2 字节）
  if (f.ascii) {
    // 蓝牙名称：走专用修改指令 DD 5A A2 <len> <name...> <chk> 77（载荷 [长度][名称]，无填充，长度字段=名称长度+1）
    if (f.key === 'bt-name') {
      const resp = await jbdBus.sendAck(buildSetBtName(String(f.value ?? '')))
      if (autoFactory.value) await exitFactory()
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
        return false
      }
      return markWriteOkWithVerify(f, exp)
    }
    const bytes = encodeAsciiValue(f)
    const resp = await jbdBus.sendAck(buildWriteParam(f.index!, bytes))
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    return markWriteOk(f)
  }
  // 复合保护字段（scd）：与 peer 合并成 16 位字再下发
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    const raw = combineScd(level, delay) & 0xffff
    const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    if (peer) { peer.status = 'ok'; peer.dirty = false }
    return markWriteOk(f)
  }
  // 下拉选项字段：value 即原始寄存器值，直接下发
  if (f.options) {
    const raw = Number(f.value ?? 0) & 0xffff
    const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    return markWriteOk(f)
  }
  // 普通数值字段
  // 检流阻值等需密码校验：先弹窗确认，密码不正确则中止下发
  if (f.needPassword) {
    const ok = await (deps.confirmPassword?.() ?? Promise.resolve(false))
    if (!ok) {
      f.status = 'fail'
      ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
      return false
    }
  }
  const raw = paramDisplayToRaw(f.index!, f.value)
  const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
  if (autoFactory.value) await exitFactory()
  if (!resp || resp.timeout || resp.status !== 0x00) {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    return false
  }
  return markWriteOk(f)
}

// 计算去重后的「读取单元」：位开关共用同一寄存器（按 bitIndex 去重）、
// 重复 index 也只读一次；非 date/serialRaw 的 customDisplay、以及无 index 的只读项直接跳过。
// 这样「读取全部」对温度探头(16 路 NTC 共用寄存器 30)、功能设置(共用寄存器 29)等
// 位开关组只发一帧，避免对同一寄存器重复读取。
function planReadUnits(fields: FieldState[]): { units: FieldState[]; skip: number } {
  const seen = new Set<string>()
  const units: FieldState[] = []
  let skip = 0
  for (const f of fields) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) { skip++; continue }
    if (f.readOnly && f.index === undefined) { skip++; continue }
    const key = isBitSwitch(f) ? `bit:${f.bitIndex}` : `idx:${f.index}`
    if (seen.has(key)) continue
    seen.add(key)
    units.push(f)
  }
  return { units, skip }
}

async function readGroup(g: { title: string; fields: FieldState[] }) {
  if (!deps.connected()) return
  const { units, skip } = planReadUnits(g.fields)
  busEpoch++
  busy.value = true
  let ok = 0, fail = 0
  for (const f of units) {
    const r = await readField(f)
    if (r) ok++; else fail++
  }
  busy.value = false
  const tip = skip ? `（跳过 ${skip} 只读项）` : ''
  ElMessage[fail ? 'warning' : 'success'](`本组读取完成：${ok} 成功，${fail} 失败${tip}`)
}

// ====== 批量寄存器读取（0xFA，设备单帧读取上限约 56 寄存器，按连续段拆分）======
// 读取全部：把"实际用到的寄存器"按连续段（run）合并，每段最多 READ_CHUNK 个做一条 0xFA 批量读，
// 串口往返从逐寄存器(~150)降到个位数；若某段批量读失败（设备对较大 count 不稳），自动回退为该段内
// 逐寄存器单条读（parseParamResponse），兼顾速度与可靠性。两条路径均复用 readField 一致的解析。
// 实测：寄存器 0~55（count=56）单条批量读正常，故 READ_CHUNK 取 48（留余量，避免逼近设备上限）。
const READ_CHUNK = 48

/** 下发后回读校验阶段的读取超时（ms）：正常一问一答几十毫秒内即返回，300ms 已含约 6 倍
 *  余量；校验失败仅是行内标红（有逐寄存器回退与 verifyField 补读兜底），无需 FRAME_TIMEOUT_MS
 *  的 1500ms 全额预算——后者会把瞬时丢帧的最坏耗时放大到秒级。 */
const VERIFY_READ_TIMEOUT_MS = 300

/** 字段依赖的寄存器序号集合（用于按寄存器去重读取 / 失败定位） */
function fieldRegisters(f: FieldState): number[] {
  if (isBitSwitch(f)) return [f.bitIndex!]
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    const out: number[] = []
    for (let i = f.index!; i < f.index! + len; i++) out.push(i)
    return out
  }
  if (f.index === undefined) return []
  return [f.index]
}

/** 从 rawMap（regIndex -> 16 位原始值）回填单个字段，等价于 readField 的成功分支。
 *  bit 开关：更新共享位图并扇出到所有同位图字段；
 *  ASCII：把连续寄存器按大端拼回字节流再走 ASCII 解析；
 *  scd：拆分高低字节档位并同步 peer；其余按换算表回填。 */
function applyFieldFromRaw(f: FieldState, rawMap: Record<number, number>): boolean {
  if (isBitSwitch(f)) {
    const bi = f.bitIndex!
    if (rawMap[bi] === undefined) return false
    bitmaps.value[bi] = rawMap[bi]
    const peers = allFields.value.filter((x) => x.bitIndex === bi)
    for (const p of peers) {
      p.value = ((rawMap[bi] >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
      p.status = 'ok'
    }
    return true
  }
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    const bytes: number[] = []
    for (let i = f.index!; i < f.index! + len; i++) {
      const r = rawMap[i]
      if (r === undefined) return false
      bytes.push((r >> 8) & 0xff, r & 0xff)
    }
    const reg = f.index!
    const data = [(reg >> 8) & 0xff, reg & 0xff, len, ...bytes]
    // 构造与 0xFA 批量读应答同构的伪帧，复用 parseAsciiResponse 解析
    const fakeFrame: Frame = { cmd: 0xfa, status: 0x00, len: data.length, data, checksum: [0, 0], callbackId: [], valid: true }
    f.value = parseAsciiResponse(fakeFrame, len * 2)
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (f.customDisplay === 'date' || f.customDisplay === 'serialRaw') {
    if (f.index === undefined || rawMap[f.index] === undefined) return false
    f.value = rawMap[f.index]
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (f.kind === 'scd') {
    const raw = rawMap[f.index!]
    if (raw === undefined) return false
    const { level, delay } = splitScd(raw)
    const peer = scdPeer(f)
    if (f.scdPart === 'level') f.value = level
    else f.value = delay
    if (peer) peer.value = f.scdPart === 'level' ? delay : level
    f.dirty = false
    f.status = 'ok'
    if (peer) { peer.dirty = false; peer.status = 'ok' }
    return true
  }
  if (f.options) {
    if (rawMap[f.index!] === undefined) return false
    f.value = rawMap[f.index!] & 0xffff
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (rawMap[f.index!] === undefined) return false
  f.value = paramRawToDisplay(f.index!, rawMap[f.index!])
  f.dirty = false
  f.status = 'ok'
  return true
}

/** 解析批量读响应：data = [startRegHi, startRegLo, count, v0Hi, v0Lo, ...]，
 * 校验 startReg/count 与请求一致后返回 startReg→raw 映射，否则返回 null（交由回退逻辑处理）。 */
function parseBatchResponse(resp: Frame | null, expectStart: number, expectCount: number): Record<number, number> | null {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return null
  if (!resp.data || resp.data.length < 3 + expectCount * 2) return null
  const startReg = (resp.data[0] << 8) | resp.data[1]
  const cnt = resp.data[2]
  if (startReg !== expectStart || cnt !== expectCount) return null
  const map: Record<number, number> = {}
  for (let i = 0; i < cnt; i++) {
    const off = 3 + i * 2
    map[startReg + i] = ((resp.data[off] << 8) | resp.data[off + 1]) & 0xffff
  }
  return map
}

/** 去重后的寄存器集合按连续段（run）合并、段内按 READ_CHUNK 切分：
 *  「读取全部」与批量下发后的回读校验共用，让一条 0xFA 批量读覆盖尽量多的寄存器。 */
function planReadChunks(regs: number[]): { start: number; count: number }[] {
  const sorted = [...new Set(regs)].sort((a, b) => a - b)
  const chunks: { start: number; count: number }[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sorted[j] === sorted[j - 1] + 1) j++
    const runStart = sorted[i]
    const runLen = j - i
    for (let s = runStart; s < runStart + runLen; s += READ_CHUNK) {
      chunks.push({ start: s, count: Math.min(READ_CHUNK, runStart + runLen - s) })
    }
    i = j
  }
  return chunks
}

async function readAll() {
  if (!deps.connected()) return
  busEpoch++
  busy.value = true
  progress.value = 0
  // 默认第一条指令：先读取芯片类型。芯片方案决定二级过流/短路保护下拉的档位物理量，
  // 必须先于参数批量读，避免 SCD 选项因未知芯片而显示 0.00A 误导用户；同时每次读取全部
  // 都强制重读一遍，确保芯片方案是最新识别结果。
  j.chipType.value = null
  await j.readChip()
  // 收集所有字段实际依赖的寄存器（去重）
  const regSet = new Set<number>()
  for (const f of allFields.value) {
    if (f.customDisplay && f.customDisplay !== 'date' && f.customDisplay !== 'serialRaw') continue
    if (f.readOnly && f.index === undefined) continue
    // ASCII 字段（蓝牙名称等）设备对大跨度批量读易返回错位数据，不参与批量收集，
    // 改为下方回填阶段逐字段走 readField 单读（与「读本组」同源，已验证可靠）。
    if (f.ascii) continue
    // scd 复合保护字段（二级过流/短路，寄存器 40/41）：与相邻寄存器（36~39）连续，
    // 合并批量读时设备对跨边界多寄存器读返回错位数据（level 半字节变 0），单读则正常。
    // 故 scd 不走批量收集，下方回填阶段逐字段走 readField 单读（与「读本组」一致）。
    if (f.kind === 'scd') continue
    for (const r of fieldRegisters(f)) regSet.add(r)
  }
  if (!regSet.size) { busy.value = false; ElMessage.warning('没有可读取的参数'); return }
  const rawMap: Record<number, number> = {}
  const failedRegs = new Set<number>()
  // 仅读取实际用到的寄存器：按连续段（run）合并、段内按 READ_CHUNK 切分（planReadChunks），
  // 每段一条批量 0xFA 读。这样既不读无关/可能无效的寄存器，又能吃满批量读。
  const chunks = planReadChunks([...regSet])
  let done = 0
  for (const ch of chunks) {
    progress.value = Math.round((done / chunks.length) * 100)
    // 1) 尝试批量读：一次往返拿 READ_CHUNK 个寄存器
    jbdBus.send(buildReadParam(ch.start, ch.count))
    const resp = await jbdBus.onceResponse(FRAME_TIMEOUT_MS, 0xfa)
    const batch = parseBatchResponse(resp, ch.start, ch.count)
    if (batch) {
      Object.assign(rawMap, batch)
    } else {
      // 2) 回退：该块内逐寄存器单条读（与 readField 一致、已验证可靠）
      for (let r = ch.start; r < ch.start + ch.count; r++) {
        jbdBus.send(buildReadParam(r, 1))
        const rr = await awaitParamResponse(r, FRAME_TIMEOUT_MS)
        const raw = parseParamResponse(rr)
        if (raw === null) failedRegs.add(r)
        else rawMap[r] = raw
      }
    }
    done++
  }
  // 逐字段回填：仅依赖失败寄存器的字段标红，其余照常更新
  let ok = 0, fail = 0
  for (const f of allFields.value) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) continue // 派生展示（芯片类型/硬件版本/NTC 数/均衡模式），不参与 0xFA 读
    if (f.readOnly && f.index === undefined) continue
    // ASCII 字段 / scd 复合保护字段：逐字段单读（readField），
    // 避免大跨度/跨边界批量读的设备错位问题（scd 单读与「读本组」同源，已验证可靠）。
    if (f.ascii || f.kind === 'scd') {
      const okRead = await readField(f)
      if (okRead) ok++; else { f.status = 'fail'; fail++ }
      continue
    }
    const fr = fieldRegisters(f)
    if (fr.some((r) => failedRegs.has(r))) { f.status = 'fail'; fail++; continue }
    if (applyFieldFromRaw(f, rawMap)) ok++
    else { f.status = 'fail'; fail++ }
  }
  progress.value = 100
  busy.value = false
  if (fail) ElMessage.warning(`读取全部失败：${fail} 个参数读取失败`)
  else ElMessage.success('读取全部成功')
}

/** 批量下发完成后的统一回读校验（verifyQueue 的分流执行）：
 *  - 普通数值 / 下拉等单寄存器字段：按连续段合并为 0xFA 批量读（与「读取全部」同源、
 *    已验证可靠），一次往返即可校验一段寄存器；某段批量读失败再逐寄存器单读回退。
 *  - ASCII 块 / scd 复合字段：设备对大跨度/跨边界批量读返回错位数据（见 readAll 注释），
 *    维持 verifyField 逐字段单读。
 *  校验读取统一用 VERIFY_READ_TIMEOUT_MS 短超时；比对按整寄存器 raw 进行（diffMessage），
 *  不覆写 f.value，界面始终保持用户下发值。 */
async function verifyFieldsBatched(verifyQueue: { f: FieldState; exp: WriteExpect }[]): Promise<void> {
  const single: { f: FieldState; exp: WriteExpect }[] = []
  const batchable: { f: FieldState; exp: WriteExpect }[] = []
  for (const v of verifyQueue) {
    const f = v.f
    const canBatch = f.index !== undefined && !f.ascii && f.kind !== 'scd' &&
      (!f.customDisplay || f.customDisplay === 'date' || f.customDisplay === 'serialRaw')
    if (canBatch) batchable.push(v)
    else single.push(v)
  }
  if (batchable.length) {
    const rawMap: Record<number, number> = {}
    for (const ch of planReadChunks(batchable.map((v) => v.f.index!))) {
      jbdBus.send(buildReadParam(ch.start, ch.count))
      const resp = await awaitBatchResponse(ch.start, ch.count, VERIFY_READ_TIMEOUT_MS)
      const batch = parseBatchResponse(resp, ch.start, ch.count)
      if (batch) {
        Object.assign(rawMap, batch)
      } else {
        // 该段批量读失败：段内逐寄存器单读回退（与 readAll 的回退同源）
        for (let r = ch.start; r < ch.start + ch.count; r++) {
          jbdBus.send(buildReadParam(r, 1))
          const rr = await awaitParamResponse(r, VERIFY_READ_TIMEOUT_MS)
          const raw = parseParamResponse(rr)
          if (raw !== null) rawMap[r] = raw
        }
      }
    }
    for (const { f, exp } of batchable) {
      const gotRaw = rawMap[f.index!]
      if (gotRaw === undefined) {
        f.status = 'fail'
        f.dirty = true
        ElMessage.error(`校验失败[${f.label}]：读取超时或无响应（设备未正确返回下发结果）`)
        continue
      }
      const diff = diffMessage(f, exp, { raw: gotRaw & 0xffff })
      if (diff) {
        f.status = 'fail'
        f.dirty = true
        ElMessage.error(`校验失败[${f.label}]：${diff}`)
      } else {
        f.status = 'ok'
        f.dirty = false
      }
    }
  }
  for (const { f, exp } of single) {
    await verifyField(f, exp)
  }
}

// 通用下发：对传入字段集合逐一下发，复用全部合成/密码/工厂逻辑。
// 调用方决定字段集合（脏字段、或全部已读字段），本函数不判断 dirty。
async function sendFields(fields: FieldState[]) {
  if (!ensureDispatchAllowed()) return { ok: 0, fail: 0 }
  if (!fields.length) return { ok: 0, fail: 0 }
  busEpoch++
  busy.value = true
  let ok = 0, fail = 0
  // 收集写入成功的字段及其期望值快照，待全部写完后统一串行回读校验。
  // 禁止在循环内并发触发 verifyField：多个字段的回读会经 jbdBus 的 onceResponse(0xfa)
  // 互相抢帧（onceResponse 仅按命令码 0xfa 过滤、不区分寄存器地址），导致后发字段
  // （如 BMS 编码信息 72，位于生产厂商 56 之后）的读响应被前序字段的读/写响应抢占，
  // 解析为空 → 校验误报。统一串行回读可彻底消除抢帧，且与「全部读取」走同源 readField。
  const verifyQueue: { f: FieldState; exp: WriteExpect }[] = []
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return { ok: 0, fail: 0 } }
  }
  for (let i = 0; i < fields.length; i++) {
    progress.value = Math.round(((i) / fields.length) * 100)
    const f = fields[i]
    // 写入前捕获期望值快照（校验用），必须在下发指令发出前完成
    const exp = captureExpect(f)
    // 复合保护字段：只由 level part 代表整个寄存器合成下发，delay part 跳过
    if (f.kind === 'scd') {
      if (f.scdPart === 'delay') { f.status = 'ok'; continue }
      const peer = scdPeer(f)
      const peerVal = peer && peer.value != null ? Number(peer.value) : 0
      const selfVal = f.value != null ? Number(f.value) : 0
      const raw = combineScd(selfVal, peerVal) & 0xffff
      f.status = 'writing'
      const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        ok++
        if (peer) { peer.status = 'ok'; peer.dirty = false }
      }
      continue
    }
    f.status = 'writing'
    // ASCII 字段：多寄存器写（蓝牙名称走专用 0xA2 指令）
    if (f.ascii) {
      if (f.key === 'bt-name') {
        const resp = await jbdBus.sendAck(buildSetBtName(String(f.value ?? '')))
        if (!resp || resp.timeout || resp.status !== 0x00) {
          f.status = 'fail'; fail++
          ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
        } else {
          f.status = 'ok'; f.dirty = false
          ok++
        }
        continue
      }
      const bytes = encodeAsciiValue(f)
      const resp = await jbdBus.sendAck(buildWriteParam(f.index!, bytes))
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        ok++
        if (!f.readOnly) verifyQueue.push({ f, exp })
      }
      continue
    }
    // 下拉选项字段：value 即原始寄存器值
    if (f.options) {
      const raw = Number(f.value ?? 0) & 0xffff
      const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        ok++
        if (!f.readOnly) verifyQueue.push({ f, exp })
      }
      continue
    }
    // 普通数值字段
    // 检流阻值等需密码校验：canBatchDispatch 已排除 needPassword 字段，批量路径不会触达；
    // 此处仍保留兜底检查，防调用方绕过筛选直接传入。
    if (f.needPassword) {
      const pwdOk = await (deps.confirmPassword?.() ?? Promise.resolve(false))
      if (!pwdOk) {
        f.status = 'fail'; fail++
        ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
        continue
      }
    }
    const raw = paramDisplayToRaw(f.index!, f.value!)
    const resp = await jbdBus.sendAck(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'; fail++
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    } else {
      ok++
      if (!f.readOnly) verifyQueue.push({ f, exp })
    }
  }
  // 全部写完后，统一串行回读校验（与「全部读取」同源 readField）：
  // 仍在同一个工厂会话内（尚未退出），回读与写彻底串行，杜绝并发抢帧
  // （BMS 编码信息 72 等关键字段不再误报）；校验读取在工厂态下更可靠。
  // 普通数值字段先按连续段批量读校验（一次往返覆盖多个寄存器，见 verifyFieldsBatched），
  // ASCII / scd 字段仍走逐字段单读。
  if (verifyQueue.length) {
    await verifyFieldsBatched(verifyQueue)
  }
  // 整批下发（写 + 回读校验）全部结束，最后统一退出工厂模式一次 —— 全程只进/退一次。
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  const outcome: DispatchOutcome = { ok, fail }
  if (shouldUploadDispatchResult(outcome)) await uploadDispatchSnapshot()
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`参数下发完成：${ok} 成功，${fail} 失败`)
  return outcome
}

export interface DispatchOutcome {
  ok: number
  fail: number
}

// 满充容量(index 112) 与 标称容量(index 0) 保持一致：
// 只要本次下发的字段集合包含「标称容量」，就额外把满充容量(112)按标称容量的值下发一遍。
// 满充容量自身为只读字段，不单独编辑，其值恒等于标称容量。
function injectFullChargeMirror(fields: FieldState[]): FieldState[] {
  const nominal = fields.find((f) => f.index === 0)
  if (!nominal || nominal.value == null) return fields
  const full = allFields.value.find((f) => f.index === 112)
  if (!full) return fields
  // 只读展示也跟随标称容量，让用户直观看到「满充容量 = 标称容量」
  full.value = nominal.value
  if (fields.includes(full)) return fields
  return [...fields, full]
}

/** 「全部写入 / 强制下发」的字段筛选口径：有寄存器、可写、非位开关（位图走分组下发）、
 *  非密码字段（避免批量中途反复弹密码框），且值非空（与单字段 canWrite 同口径——
 *  值为 null 时按 0 下发会写出无效数据，如清空后的生产日期变成 0x0000）。
 *  生产日期（customDisplay='date'）的 f.value 即寄存器 raw，走普通数值分支下发，
 *  必须包含——此前被 !customDisplay 一刀切排除，导致日期永远不随批量下发。 */
function canBatchDispatch(f: FieldState): boolean {
  if (f.customDisplay && f.customDisplay !== 'date') return false
  if (f.readOnly) return false
  if (isBitSwitch(f)) return false
  if (f.index === undefined) return false
  if (f.needPassword) return false
  return f.value !== null && f.value !== undefined
}

// 强制下发：把当前已读取/已显示的字段值全部下发一遍，不依赖脏标记。
// 适用于「读出来后又想原样写回一遍」的场景（如参数被设备意外清零、或对照核验）。
async function forceWriteAll() {
  if (!ensureDispatchAllowed()) return
  const fields = allFields.value.filter(canBatchDispatch)
  if (!fields.length) { ElMessage.warning('暂无可下发的参数（请先读取设备参数）'); return }
  try {
    await ElMessageBox.confirm(
      `即将把当前读取到的 ${fields.length} 项参数原样全部下发到设备，覆盖设备现有参数。确定继续吗？`,
      '强制下发确认',
      { type: 'warning', confirmButtonText: '确定下发', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // 下发前重读芯片类型（不读参数、不动页面 f.value）：换电池不重连时 chipType 仍是
  // 上一台的缓存，会导致二级过流/短路下拉框用错档位表。重读确保档位解释对应当前电池，
  // 同时页面模板参数值保持不变，支持用同一套参数反复下发多组电池。
  j.chipType.value = null
  await j.readChip()
  await sendFields(injectFullChargeMirror(fields))
  // 落地：把本次强制下发的参数快照写入本地记录库（时间 + 蓝牙名称 + 具体参数）
  const btField = fields.find((f) => f.key === 'bt-name')
  const btName = btField && btField.value != null ? String(btField.value) : '—'
  const params: DispatchParam[] = fields.map((f) => ({
    label: f.label,
    index: f.index,
    value: f.value,
  }))
  addDispatchRecord({ btName, params })
  ElMessage.info('已记录本次强制下发到本地历史')
}

// ====== 分组位图下发（用于功能设置/温度探头配置） ======
async function writeGroupBitmap(g: { title: string; fields: FieldState[] }, bitIndex: number) {
  if (!ensureDispatchAllowed()) return
  // 未读取过则先读取
  if (bitmaps.value[bitIndex] === null || bitmaps.value[bitIndex] === undefined) {
    jbdBus.send(buildReadParam(bitIndex, 1))
    const resp = await jbdBus.onceResponse(FRAME_TIMEOUT_MS, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { ElMessage.error(`读取位图[${bitIndex}]失败`); return }
    bitmaps.value[bitIndex] = raw
    const peers = allFields.value.filter((x) => x.bitIndex === bitIndex)
    for (const p of peers) {
      p.value = ((raw >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
    }
  }
  const dirty = g.fields.filter((f) => f.dirty && isBitSwitch(f))
  if (!dirty.length) {
    ElMessage.info(`[${g.title}] 没有需要下发的位开关`)
    return
  }
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  for (const f of dirty) {
    f.status = 'writing'
    const raw = bitmaps.value[bitIndex] ?? 0
    const resp = await jbdBus.sendAck(buildWriteParam(bitIndex, [(raw >> 8) & 0xff, raw & 0xff]))
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'; fail++
      ElMessage.error(`写位图[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status?.toString(16)}`}`)
    } else {
      f.status = 'ok'; f.dirty = false; ok++
    }
  }
  if (autoFactory.value) await exitFactory()
  if (shouldUploadDispatchResult({ ok, fail })) await uploadDispatchSnapshot()
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`[${g.title}] 位图下发完成：${ok} 成功，${fail} 失败`)
}

// 字段行内「复位 MCU」按钮 / 产线下发页「复位MCU」：发送控制指令 0x03 0x00
async function confirmResetMcu() {
  if (!ensureDispatchAllowed()) return
  try {
    await ElMessageBox.confirm('确定要复位 MCU 吗？设备将重新启动。', '复位 MCU', { type: 'warning' })
  } catch {
    return // 用户取消
  }
  // 控制指令在部分固件下需先进入工厂模式才允许执行：
  // 发送前临时进入工厂态（若当前未处于工厂态），发送后退出，避免遗留锁态。
  let tmpFactory = false
  if (autoFactory.value && !inFactory.value) {
    tmpFactory = await enterFactory()
  }
  await jbdBus.send(buildControlCommand(CONTROL_FUNC.RESET_MCU))
  if (tmpFactory && autoFactory.value) await exitFactory()
  ElMessage.success('已发送复位 MCU 指令')
}

/** 组合式入口：组件 setup 时传入自身依赖（两页均为 App 顶栏同一状态的回调），
 *  引擎状态（字段/位图/进度/工厂态/世代计数）为模块单例，两页共享。 */
export function useDispatch(d?: DispatchDeps) {
  if (d) {
    deps.connected = d.connected
    deps.authSession = d.authSession
    if (d.confirmPassword) deps.confirmPassword = d.confirmPassword
  }
  return {
    // 状态
    busy, progress, bitmaps, ntcCount,
    autoFactory, inFactory, enterFactory, exitFactory,
    // 门禁
    ensureDispatchAllowed, canWrite,
    // 纯工具
    isBitSwitch, scdPeer, encodeAsciiValue, canBatchDispatch, injectFullChargeMirror,
    // 读写引擎
    readField, readGroup, readAll,
    writeField, sendFields, writeGroupBitmap, forceWriteAll,
    confirmResetMcu, uploadDispatchSnapshot,
    bumpBusEpoch,
  }
}
