/* =========================================================================
 * 参数下发引擎（useDispatch.ts）— 模块级单例
 * 指令口径与嘉佰达 JBDTools 上位机完全一致：
 *   读取参数 = 芯片类型(0x00) + 九段 0xFA 批量读（READ_SEGMENTS）
 *   写入参数/强制下发 = 进工厂 + 九段 0xFA 批量写 + 退工厂（整包 11 帧）
 *   行内「下发」= 进工厂 → 0xFA 写 → 回读 → 退工厂（回读值宽松回填）
 *   检流电阻(reg28) 唯一例外：不随批量/导入下发，需口令后单独下发
 * 维护一份 184 寄存器镜像（regMirror）+ ASCII 块原始字镜像（asciiRawMirror），
 * ASCII 块「未改动原样回写、改动后重新编码」，避免设备块格式不规则被写坏。
 * ========================================================================= */
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildReadParam, buildWriteParam,
  buildControlCommand, CONTROL_FUNC,
} from '@/jbd/jbd-protocol'
import type { Frame } from '@/jbd/jbd-protocol'
import { paramRawToDisplay, paramDisplayToRaw, paramDisplayDecimals, paramFormat, splitScd, combineScd, scdProtectLabel, scdDelayLabelMs, scdDelayMaxIndex, isChipScdKnown } from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import { addDispatchRecord, type DispatchParam } from '@/db/dispatchLog'
import { canDispatchParameters, isAuthSessionValid } from '@/auth/auth'
import { buildDispatchSnapshot, shouldUploadDispatchRecord, shouldUploadDispatchResult } from '@/dispatch/uploadDecision'
import { isFigText, parseFig, buildFig, figFileName } from './figfile'
import { useTemplates } from './useTemplates'
import { useFactory } from './useFactory'
import { buildStaticColumns, tripleRows } from './groupDefs'
import type { FieldState, GroupObj, ImportedParam } from './types'

/** 后台登录会话（App.vue 注入；决定参数下发是否放行） */
export const dispatchAuthSession = ref<{ userId: number; username: string; expiresTime: number } | null>(null)

export interface DispatchOutcome {
  ok: number
  fail: number
}

/* ------------------------------------------------------------------ */
/* 九段分段表（必须分段：跨 ASCII 块整段读会静默错位，已实测）           */
/* ------------------------------------------------------------------ */
interface Segment { start: number; count: number; note?: string }

export const READ_SEGMENTS: Segment[] = [
  { start: 0, count: 56, note: '数值参数区' },
  { start: 56, count: 16, note: '制造商 ASCII' },
  { start: 72, count: 16, note: 'BMS编码 ASCII' },
  { start: 88, count: 16, note: '条形码/蓝牙名称 ASCII' },
  { start: 104, count: 19, note: 'GPS / 额定参数' },
  { start: 123, count: 35, note: '预留告警参数' },
  { start: 158, count: 12, note: '电池型号 ASCII' },
  { start: 170, count: 6, note: '唯一 ID' },
  { start: 176, count: 8, note: '硬件名称 ASCII' },
]
const ASCII_BLOCK_STARTS = new Set([56, 72, 88, 158, 176])
const MIRROR_SIZE = 184
/** 段读写超时（与 JBDTools 一致取 2000ms） */
const SEG_TIMEOUT_MS = 2000

/** ASCII 块解码：块内首字节为有效长度，其后为文本（与 JBDTools 一致） */
function decodeAsciiWords(words: number[]): string {
  const bytes: number[] = []
  for (const w of words) bytes.push((w >> 8) & 0xff, w & 0xff)
  const len = Math.min(bytes[0] ?? 0, Math.max(0, bytes.length - 1))
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[1 + i])
  return s.replace(/\0+$/, '')
}

/** 16 位字数组 → 大端字节数组（buildWriteParam 入参是字节，count = 字节数/2 = 字数） */
function wordsToBytes(words: number[]): number[] {
  const out: number[] = []
  for (const w of words) out.push((w >> 8) & 0xff, w & 0xff)
  return out
}

/** ASCII 块编码：首字节写文本字节数，其后写文本，剩余补 0 */
function encodeAsciiBlock(text: string, count: number): number[] {
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
/* 单例上下文                                                          */
/* ------------------------------------------------------------------ */
const j = useJbd()
// 批量读/写下发进行中标志：直接使用 useJbd 的共享 batchBusy，
// 使批量操作期间实时监测的自动轮询自动暂停（批量结束后恢复），批量帧不再与轮询帧抢总线。
const busy = j.batchBusy
const progress = ref(0)

/** 184 寄存器镜像 + ASCII 块镜像（九段读写的数据源） */
const regMirror = ref<Record<number, number>>({})
const asciiMirror = ref<Record<number, string>>({})
const asciiRawMirror = ref<Record<number, number[]>>({})
/** 设备参数是否已读取（写入/强制下发的前置条件）；导入参数同样置位（免先读取） */
export const paramsLoaded = ref(false)
/** 镜像是否完整（readAll 后为 true；仅导入时为 false，写入前需自动补读缺口段） */
const mirrorComplete = ref(false)

/** 九段读取进度描述（读取到第几段），供页面进度提示 */
const segNote = ref('')

// ====== 密码校验弹窗状态（UI 由 App.vue 全局渲染，dlg-pwd） ======
export const pwdVisible = ref(false)
export const pwdInput = ref('')
export const pwdError = ref('')
export const pwdTitle = ref('下发确认')
export const pwdHint = ref('该参数下发需要输入密码确认。')
export const pwdConfirmText = ref('确认下发')
let pwdResolve: ((ok: boolean) => void) | null = null

export function confirmPassword(opts?: { title?: string; hint?: string; confirmText?: string }): Promise<boolean> {
  // 并发守卫：已有密码弹窗进行中时直接拒绝新请求，避免前一 Promise 永久悬挂
  if (pwdVisible.value) return Promise.resolve(false)
  pwdTitle.value = opts?.title ?? '下发确认'
  pwdHint.value = opts?.hint ?? '该参数下发需要输入密码确认。'
  pwdConfirmText.value = opts?.confirmText ?? '确认下发'
  pwdInput.value = ''
  pwdError.value = ''
  pwdVisible.value = true
  return new Promise((resolve) => { pwdResolve = resolve })
}
export async function onPwdConfirm() {
  const ok = await window.bmsAPI?.verifyDispatchPwd(pwdInput.value)
  if (!ok) {
    pwdError.value = '密码错误，请重试'
    return
  }
  pwdVisible.value = false
  pwdResolve?.(true)
  pwdResolve = null
}
export function onPwdCancel() {
  pwdVisible.value = false
  pwdResolve?.(false)
  pwdResolve = null
}

function dispatchAllowed(): boolean {
  return canDispatchParameters(j.connected.value, dispatchAuthSession.value)
}

function ensureDispatchAllowed(): boolean {
  if (!j.connected.value) {
    ElMessage.warning('请先连接串口')
    return false
  }
  if (!isAuthSessionValid(dispatchAuthSession.value)) {
    ElMessage.warning('请先登录后台，再下发参数')
    return false
  }
  return true
}

/** 方案 B：只要有参数下发成功，就把当前已知完整参数快照上传后台；V3-- 前缀才上传。 */
async function uploadDispatchSnapshot(): Promise<void> {
  try {
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
  } catch (e: any) {
    // fire-and-forget 调用方不 await：IPC reject 也不能变成未捕获 rejection
    ElMessage.warning('后台同步异常：' + (e?.message || e))
  }
}

// ====== 导入参数预览状态（预览弹窗 UI 由参数配置页渲染） ======
export const importedParams = ref<ImportedParam[]>([])
export const importedSourceName = ref<string>('')
export const importDialogVisible = ref(false)

// ====== 本地配置模板（localStorage）：列表/存/删/导入（见 useTemplates.ts） ======
const {
  templates, templateDialogVisible, openTemplateDialog, importFromTemplate,
  onFileChangeFromDialog, saveAsTemplate, renameTemplate, deleteTemplate, formatDate,
} = useTemplates({
  buildExportData: () => buildExportData(),
  // 模板数据是 JSON 配置对象：先解析成参数列表再进预览（与从文件导入同路径）
  applyImport: (data: any) => {
    const r = parseJsonImport(data)
    if ('error' in r) { ElMessage.error(r.error); return }
    if (r.skippedSense) ElMessage.info('已跳过检流电阻（reg28），该参数需单独下发')
    applyImport(r.list)
  },
  onFileChange,
  setImportedSourceName: (name) => { importedSourceName.value = name },
})

function fieldByIndex(index: number): FieldState | undefined {
  return allFields.value.find((f) => f.index === index)
}

// 工厂模式进入/退出（见 useFactory.ts）
const { autoFactory, inFactory, enterFactory, exitFactory } = useFactory()

// ====== 分组布局：JBDTools 固定三列（静态，无拖拽排序） ======
const columns = ref<GroupObj[][]>(buildStaticColumns())
const groups = computed(() => columns.value.flat())
const allFields = computed(() => groups.value.flatMap((g) => g.fields))
const dirtyCount = computed(() => allFields.value.filter((f) => f.dirty).length)

function isBitSwitch(f: FieldState): boolean {
  return f.bitIndex !== undefined && f.bit !== undefined
}

function isReadOnly(f: FieldState): boolean {
  if (f.readOnly) return true
  if (f.customDisplay && f.customDisplay !== 'date') return true
  return false
}

function shouldShowUnit(f: FieldState): boolean {
  if (f.ascii) return false
  if (f.bitIndex !== undefined) return false
  if (f.customDisplay) return false
  if (f.readOnly) return false
  return !!f.unit
}

function canWrite(f: FieldState): boolean {
  if (!dispatchAllowed()) return false
  if (busy.value) return false
  if (f.readOnly) return false
  if (f.customDisplay === 'date' && f.index !== undefined) return f.value !== null
  if (f.customDisplay) return false
  if (isBitSwitch(f)) return false  // 位开关通过分组「应用」或整包写入
  if (f.ascii) return f.index !== undefined && typeof f.value === 'string'
  return f.value !== null && f.index !== undefined
}

/** 位开关变更 → 更新镜像寄存器对应位 */
function onBitChange(f: FieldState) {
  if (f.bitIndex === undefined || f.bit === undefined) return
  const cur = regMirror.value[f.bitIndex] ?? 0
  regMirror.value[f.bitIndex] = (cur & ~(1 << f.bit)) | ((f.value ? 1 : 0) << f.bit)
  f.dirty = true
}

/** 数值字段输入：number input 回传字符串，转 number；空值置 null */
function onNumInput(f: FieldState, v: any) {
  if (v === '' || v === null || v === undefined) f.value = null
  else {
    const n = Number(v)
    if (!Number.isNaN(n)) f.value = n
  }
  f.dirty = true
}

/** 数值字段显示格式化：按字段 decimals（缺省按协议寄存器精度）四舍五入，并去除尾随零 */
function formatFieldValue(f: FieldState): string {
  const v = f.value
  if (v === null || v === undefined || v === '') return ''
  const num = Number(v)
  if (Number.isNaN(num)) return String(v)
  const d = f.decimals ?? (f.index !== undefined ? paramDisplayDecimals(f.index) : 0)
  const s = num.toFixed(d)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** 下拉选项字段输入：直接存原始 value 并标脏 */
function onSelectChange(f: FieldState, v: any) {
  f.value = Number(v)
  f.dirty = true
}

// ====== 数字输入编辑态 ======
// 输入中显示原始敲入文本（避免格式化回显把 "86." 重置成 "86"，小数点打不出来/光标跳位），
// 失焦后按协议精度格式化回显。editRaw 按字段记录最后一次敲入文本。
const editingFields = ref(new Set<FieldState>())
const editRaw = new WeakMap<FieldState, string>()
function onNumEdit(f: FieldState, v: string) {
  editRaw.set(f, v)
  onNumInput(f, v)
}
function onNumFocus(f: FieldState) {
  editingFields.value.add(f)
}
function onNumBlur(f: FieldState) {
  editingFields.value.delete(f)
  editRaw.delete(f)
}
/** 数字输入框显示值：编辑中显示原文，否则按协议精度格式化 */
function numDisplay(f: FieldState): string {
  return editingFields.value.has(f) && editRaw.has(f) ? editRaw.get(f)! : formatFieldValue(f)
}

/** 取同 index 的另一个 part 字段（用于合成下发） */
function scdPeer(f: FieldState): FieldState | undefined {
  return allFields.value.find(
    (x) => x.index === f.index && x.kind === f.kind && (x.scdPart ?? x.hvdPart) !== (f.scdPart ?? f.hvdPart),
  )
}

// 检流电阻(mΩ)：取自「检流阻值」字段显示值（scd 档位换算用）
const shuntField = computed(() => allFields.value.find((x) => x.index === 28))
/** 检流阻值是否已从设备读取（未读取时 A 值按默认 0.1mΩ 估算，下拉加 ≈ 前缀明示） */
const shuntKnown = computed(() => typeof shuntField.value?.value === 'number' && shuntField.value.value > 0)
const shuntMOhm = computed(() => {
  const v = shuntField.value?.value
  return typeof v === 'number' && v > 0 ? v : 0.1
})

/** scd 下拉选项缓存：只依赖 chip/shunt，避免每次渲染重建 16 项标签数组 */
const scdOptionsCache = computed(() => {
  const chip = j.chipType.value
  const shunt = shuntMOhm.value
  const build = (param: 'ocd' | 'scd', part: 'level' | 'delay'): { label: string; value: number }[] => {
    const fn: (i: number) => string = part === 'delay'
      ? (i: number) => scdDelayLabelMs(param, chip, i)
      : (i: number) => scdProtectLabel(param, chip, i, shunt)
    const maxIdx = part === 'delay' ? scdDelayMaxIndex(chip, param) : 15
    const out: { label: string; value: number }[] = []
    for (let i = 0; i <= maxIdx; i++) out.push({ label: fn(i), value: i })
    return out
  }
  return {
    ocd: { level: build('ocd', 'level'), delay: build('ocd', 'delay') },
    scd: { level: build('scd', 'level'), delay: build('scd', 'delay') },
  }
})

/** 根据芯片方案生成 scd 下拉选项 */
function scdOptions(f: FieldState): { label: string; value: number }[] {
  const chip = j.chipType.value
  if (!isChipScdKnown(chip)) {
    return [{ label: '未知芯片方案，请先读取芯片类型', value: -1 }]
  }
  const param: 'ocd' | 'scd' = f.index === 40 ? 'ocd' : 'scd'
  const opts = scdOptionsCache.value[param][f.scdPart === 'delay' ? 'delay' : 'level']
  // 保护值(A) 由 mV÷检流电阻 折算：检流阻值未读取时为估算值，加 ≈ 前缀明示
  if (f.scdPart !== 'delay' && !shuntKnown.value) {
    return opts.map((o) => ({ label: '≈' + o.label, value: o.value }))
  }
  return opts
}

// ====== 密码确认入口（存为模板/导出配置共用） ======
export async function confirmThenSaveTemplate() {
  const ok = await confirmPassword({ title: '保存模板确认', hint: '保存为模板需要输入密码确认。', confirmText: '确认保存' })
  if (!ok) return
  await saveAsTemplate()
}
export async function confirmThenExportConfig() {
  const ok = await confirmPassword({ title: '导出配置确认', hint: '导出配置需要输入密码确认。', confirmText: '确认导出' })
  if (!ok) return
  await exportConfig()
}

/** ASCII 字段输入：直接存字符串并标脏 */
function onAsciiInput(f: FieldState, v: any) {
  f.value = typeof v === 'string' ? v : ''
  f.dirty = true
}

/** raw → 日期串 YYYY-MM-DD */
function rawToDateStr(raw: number): string {
  const day = raw & 0x1f
  const month = (raw >> 5) & 0x0f
  const year = 2000 + ((raw >> 9) & 0x7f)
  if (!day || !month || year < 2000) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 日期输入显示值：由已读取的 raw 推导 */
function dateInputText(f: FieldState): string {
  return f.value != null && f.value !== 0 ? rawToDateStr(f.value as number) : ''
}

/** 生产日期 raw ↔ Date：raw = 日(bit0~4) | 月<<5(bit5~8) | (年-2000)<<9(bit9~15) */
function dateToRaw(d: Date): number {
  const day = d.getDate() & 0x1f
  const month = (d.getMonth() + 1) & 0x0f
  const year = Math.max(0, Math.min(0x7f, d.getFullYear() - 2000))
  return (day | (month << 5) | (year << 9)) & 0xffff
}

/** 生产日期输入：YYYY-MM-DD → raw 存值并标脏。越界 → 置空，禁止下发。 */
function onDateInput(f: FieldState, v: any) {
  const text = typeof v === 'string' ? v : ''
  if (!text) { f.value = null; f.dirty = true; return }
  const [y, m, d] = text.split('-').map(Number)
  if (y >= 2000 && y <= 2127 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    f.value = dateToRaw(new Date(y, m - 1, d))
    f.dirty = true
  } else {
    f.value = null
  }
}

function disableOutOfRangeDate(date: Date): boolean {
  return date < new Date(2000, 0, 1) || date > new Date(2127, 11, 31)
}

/** 自定义展示字段值（芯片类型/NTC 数/序列号等） */
function customDisplayValue(f: FieldState): string {
  if (f.customDisplay === 'chipType') return j.chipTypeName.value
  if (f.customDisplay === 'hwVersion') return j.hwVersion.value || '—'
  if (f.customDisplay === 'ntcCount') return String(ntcCount.value)
  if (f.customDisplay === 'date' && f.value !== null && f.value !== undefined) return paramFormat(5, f.value)
  if (f.customDisplay === 'serialRaw' && f.value !== null && f.value !== undefined) {
    return '0x' + ((f.value & 0xffff).toString(16).toUpperCase().padStart(4, '0'))
  }
  if (f.customDisplay === 'resetCount') {
    const e = j.protectList.value.find((x) => x.key === '系统重启')
    return e && e.count != null ? String(e.count) : '—'
  }
  return '—'
}

function popcount(n: number): number {
  let c = 0
  while (n) { c += n & 1; n >>>= 1 }
  return c
}
const ntcCount = computed(() => {
  const v = regMirror.value[30]
  return v === undefined ? 0 : popcount(v & 0xffff)
})

/* ------------------------------------------------------------------ */
/* 0xFA 应答等待：只接受「状态 0x00 + 回显寄存器一致 + 数量一致」的帧     */
/* （与 JBDTools txn 同口径：迟到/脏帧丢弃后继续等剩余预算）             */
/* ------------------------------------------------------------------ */
async function awaitSegmentResponse(expectStart: number, expectCount: number, timeoutMs = SEG_TIMEOUT_MS): Promise<Frame | null> {
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

/** 单寄存器（或小块）读取应答：数量 ≥ minCount 即可（回读用） */
async function awaitParamResponse(expectReg: number, timeoutMs = SEG_TIMEOUT_MS, minCount = 1): Promise<Frame | null> {
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

function frameWords(resp: Frame | null, count: number): number[] | null {
  if (!resp || resp.timeout || resp.status !== 0x00 || !resp.data) return null
  if (resp.data.length < 3 + count * 2) return null
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    out.push((((resp.data[3 + 2 * k] & 0xff) << 8) | (resp.data[4 + 2 * k] & 0xff)) & 0xffff)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 字段值 → 原始值                                                      */
/* ------------------------------------------------------------------ */
function rawOfField(f: FieldState): number {
  if (f.value == null) return 0
  if (f.kind === 'hvd') {
    // reg42 硬件过欠压延时（凹凸 7717 实测）：bit0-1=过压延时档、bit2-4=欠压延时档，值=2^档位 秒；bit5+ 保留
    const peer = scdPeer(f)
    const self = Number(f.value) & 0x07
    const peerGear = peer && peer.value != null ? Number(peer.value) & 0x07 : 0
    const ovGear = f.hvdPart === 'ov' ? self : peerGear
    const uvGear = f.hvdPart === 'uv' ? self : peerGear
    const keep = regMirror.value[42] ?? 0
    return ((keep & 0xffe0) | (uvGear << 2) | ovGear) & 0xffff
  } if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = Number(f.value)
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    // 保留 reg40/41 高位「过流及短路保护值翻倍」(bit15)：scd 档位只合成低 8 位
    const dbl = f.index !== undefined ? (regMirror.value[f.index] ?? 0) & 0x8000 : 0
    return (combineScd(level, delay) | dbl) & 0xffff
  }
  if (f.index === undefined) return 0
  return paramDisplayToRaw(f.index, Number(f.value)) & 0xffff
}

/** 把字段当前值写进镜像（九段写的数据源；不发送任何帧） */
function applyFieldsToMirror(fields: FieldState[]) {
  for (const f of fields) {
    if (f.bitIndex !== undefined) {
      const cur = regMirror.value[f.bitIndex] ?? 0
      regMirror.value[f.bitIndex] = (cur & ~(1 << (f.bit ?? 0))) | ((f.value ? 1 : 0) << (f.bit ?? 0))
      continue
    }
    if (f.index === undefined) continue
    if (f.ascii) {
      asciiMirror.value[f.index] = String(f.value ?? '')
      continue
    }
    regMirror.value[f.index] = rawOfField(f) & 0xffff
  }
}

/** 镜像 → 全部字段回填（九段读完成后调用） */
function syncAllFromMirror() {
  for (const g of columns.value.flat()) {
    for (const f of g.fields) {
      f.dirty = false
      f.status = 'idle'
      if (isBitSwitch(f)) {
        const raw = regMirror.value[f.bitIndex!] ?? 0
        f.value = ((raw >> (f.bit ?? 0)) & 1) === 1
        continue
      }
      if (f.ascii) {
        f.value = asciiMirror.value[f.index!] ?? ''
        continue
      }
      if (f.index === undefined) continue
      if (f.customDisplay === 'chipType') continue
      const raw = regMirror.value[f.index]
      if (raw === undefined) continue
      if (f.kind === 'scd') {
        const parts = splitScd(raw)
        f.value = f.scdPart === 'delay' ? parts.delay : parts.level
      } else if (f.kind === 'hvd') {
        f.value = f.hvdPart === 'uv' ? (raw >> 2) & 0x07 : raw & 0x03
      } else if (f.customDisplay === 'date' || f.customDisplay === 'serialRaw') {
        f.value = raw
      } else {
        f.value = paramRawToDisplay(f.index, raw)
      }
    }
  }
}

/** 九段读完成后，把某一段的回读字同步进镜像并回填相关字段（单字段下发回读用）。
 *  只回填该段覆盖的字段：全量 sync 会把其他字段未下发的待写值冲回设备旧值。 */
function applyReadbackWords(start: number, words: number[]) {
  if (ASCII_BLOCK_STARTS.has(start)) {
    asciiRawMirror.value[start] = [...words]
    asciiMirror.value[start] = decodeAsciiWords(words)
  } else {
    for (let k = 0; k < words.length; k++) regMirror.value[start + k] = words[k] & 0xffff
  }
  syncFieldsInSegments([{ start, count: words.length }])
}

/** 只回填/清脏指定段覆盖的字段（镜像 → 字段，逻辑同 syncAllFromMirror 的单字段分支） */
function syncFieldsInSegments(segs: Segment[]) {
  const ranges = segs.map((s) => ({ start: s.start, end: s.start + s.count - 1 }))
  const inRange = (idx: number) => ranges.some((r) => idx >= r.start && idx <= r.end)
  for (const g of columns.value.flat()) {
    for (const f of g.fields) {
      if (isBitSwitch(f)) {
        if (f.bitIndex !== undefined && inRange(f.bitIndex)) {
          const raw = regMirror.value[f.bitIndex] ?? 0
          f.value = ((raw >> (f.bit ?? 0)) & 1) === 1
          f.dirty = false
          f.status = 'idle'
        }
        continue
      }
      const idx = f.index
      if (idx === undefined || !inRange(idx)) continue
      if (f.ascii) {
        if (asciiMirror.value[idx] === undefined) continue
        f.value = asciiMirror.value[idx] ?? ''
        f.dirty = false
        f.status = 'idle'
        continue
      }
      if (f.customDisplay === 'chipType') continue
      const raw = regMirror.value[idx]
      if (raw === undefined) continue
      f.dirty = false
      f.status = 'idle'
      if (f.kind === 'scd') {
        const parts = splitScd(raw)
        f.value = f.scdPart === 'delay' ? parts.delay : parts.level
      } else if (f.kind === 'hvd') {
        f.value = f.hvdPart === 'uv' ? (raw >> 2) & 0x07 : raw & 0x03
      } else if (f.customDisplay === 'date' || f.customDisplay === 'serialRaw') {
        f.value = raw
      } else {
        f.value = paramRawToDisplay(idx, raw)
      }
    }
  }
}

/** 字段集合涉及的数据段（写失败后定向回读用，避免整包 10 段重读） */
function segmentsForFields(fields: FieldState[]): Segment[] {
  const idxs = new Set<number>()
  for (const f of fields) {
    if (f.index === undefined) continue
    idxs.add(f.index)
    if (f.ascii) for (let k = 1; k < (f.ascii_len ?? 8); k++) idxs.add(f.index + k)
  }
  return READ_SEGMENTS.filter((s) => {
    for (let i = s.start; i < s.start + s.count; i++) if (idxs.has(i)) return true
    return false
  })
}

/** 定向回读若干段并回填字段；失败返回 false（调用方决定是否整包 readAll 兜底） */
async function readSegmentsBack(segs: Segment[]): Promise<boolean> {
  busy.value = true
  try {
    for (const seg of segs) {
      segNote.value = `回读 ${seg.start}~${seg.start + seg.count - 1}（${seg.note}）`
      jbdBus.send(buildReadParam(seg.start, seg.count))
      const resp = await awaitSegmentResponse(seg.start, seg.count)
      const words = frameWords(resp, seg.count)
      if (!words) return false
      if (ASCII_BLOCK_STARTS.has(seg.start)) {
        asciiRawMirror.value[seg.start] = words
        asciiMirror.value[seg.start] = decodeAsciiWords(words)
      } else {
        for (let k = 0; k < seg.count; k++) regMirror.value[seg.start + k] = words[k] & 0xffff
      }
    }
    syncFieldsInSegments(segs)
    return true
  } finally {
    busy.value = false
    segNote.value = ''
  }
}

/* ------------------------------------------------------------------ */
/* 读取参数：芯片类型 + 九段批量读（与 JBDTools 逐帧一致）               */
/* ------------------------------------------------------------------ */
export async function readAll(): Promise<boolean> {
  if (!j.connected.value) { ElMessage.warning('请先连接串口'); return false }
  busy.value = true
  progress.value = 0
  try {
    // 1) 芯片类型（0x00）
    segNote.value = '芯片类型 (0x00)'
    j.chipType.value = null
    await j.readChip()

    const regs: Record<number, number> = {}
    const ascii: Record<number, string> = {}
    const asciiRaw: Record<number, number[]> = {}

    // 2) 九段批量读
    for (let i = 0; i < READ_SEGMENTS.length; i++) {
      const seg = READ_SEGMENTS[i]
      segNote.value = `寄存器 ${seg.start}~${seg.start + seg.count - 1}（${seg.note}）`
      progress.value = Math.round(((i + 1) / (READ_SEGMENTS.length + 1)) * 100)
      jbdBus.send(buildReadParam(seg.start, seg.count))
      const resp = await awaitSegmentResponse(seg.start, seg.count)
      const words = frameWords(resp, seg.count)
      if (!words) {
        throw new Error(`段 ${seg.start}~${seg.start + seg.count - 1}（${seg.note}）读取失败${resp ? `（状态 0x${resp.status.toString(16)}）` : '：超时或无响应'}`)
      }
      if (ASCII_BLOCK_STARTS.has(seg.start)) {
        asciiRaw[seg.start] = words
        ascii[seg.start] = decodeAsciiWords(words)
      } else {
        for (let k = 0; k < seg.count; k++) regs[seg.start + k] = words[k]
      }
    }

    regMirror.value = regs
    asciiMirror.value = ascii
    asciiRawMirror.value = asciiRaw
    paramsLoaded.value = true
    mirrorComplete.value = true
    syncAllFromMirror()
    progress.value = 100
    ElMessage.success(`参数读取完成：${MIRROR_SIZE} 个寄存器 + ${Object.keys(ascii).length} 个 ASCII 块`)
    return true
  } catch (e: any) {
    progress.value = 0
    ElMessage.error('参数读取失败：' + (e?.message || e))
    return false
  } finally {
    busy.value = false
    segNote.value = ''
  }
}

/* ------------------------------------------------------------------ */
/* 九段写：进工厂 + 九段 0xFA 批量写 + 退工厂（整包 11 帧，成功后不回读） */
/* ------------------------------------------------------------------ */
function segmentPayload(seg: Segment): number[] {
  if (ASCII_BLOCK_STARTS.has(seg.start)) {
    const raw = asciiRawMirror.value[seg.start]
    const text = asciiMirror.value[seg.start] ?? ''
    // 未改动：原样回写设备原始字（设备块格式不规则，实测长度字节/填充与编码规则未必一致）
    if (raw && raw.length === seg.count && decodeAsciiWords(raw) === text) return raw.slice()
    return encodeAsciiBlock(text, seg.count)
  }
  const words: number[] = []
  for (let k = 0; k < seg.count; k++) words.push((regMirror.value[seg.start + k] ?? 0) & 0xffff)
  return words
}

/** 满充容量(112) 镜像随标称容量(0) 同步：UI 无 reg112 字段，直接写镜像。
 *  JBDTools 口径：写标称容量时成对带满充容量（两者单位/精度一致，raw 相同）。 */
function syncFullChargeMirror(fields: FieldState[]) {
  const nominal = fields.find((f) => f.index === 0)
  if (nominal && nominal.value != null) {
    regMirror.value[112] = paramDisplayToRaw(0, Number(nominal.value)) & 0xffff
  }
}

async function writeParamsNine(): Promise<boolean> {
  busy.value = true
  let inFactory = false
  try {
    progress.value = 0
    segNote.value = '进入工厂模式'
    const entered = await enterFactory()
    if (!entered) throw new Error('进入工厂模式失败')
    inFactory = true
    progress.value = Math.round((1 / (READ_SEGMENTS.length + 2)) * 100)

    for (let i = 0; i < READ_SEGMENTS.length; i++) {
      const seg = READ_SEGMENTS[i]
      segNote.value = `写入 ${seg.start}~${seg.start + seg.count - 1}（${seg.note}）`
      progress.value = Math.round(((i + 2) / (READ_SEGMENTS.length + 2)) * 100)
      const words = segmentPayload(seg)
      if (words.length !== seg.count) throw new Error(`段 ${seg.start} 数据长度异常`)
      if (seg.start + words.length > MIRROR_SIZE) throw new Error(`段 ${seg.start} 越界`)
      const resp = await jbdBus.sendAck(buildWriteParam(seg.start, wordsToBytes(words)))
      if (!resp || resp.timeout) throw new Error(`段 ${seg.start} 写入超时`)
      if (resp.status >= 0x80) throw new Error(`段 ${seg.start} 写入被拒（0x${resp.status.toString(16)}）`)
    }

    segNote.value = '退出工厂模式'
    return true
  } catch (e: any) {
    ElMessage.error('参数写入失败：' + (e?.message || e))
    return false
  } finally {
    if (inFactory) await exitFactory()
    busy.value = false
    segNote.value = ''
  }
}

/* ------------------------------------------------------------------ */
/* 行内单字段下发：进工厂 → 0xFA 写 → 回读（宽松回填）→ 退工厂           */
/* ------------------------------------------------------------------ */
async function writeSegmentSingle(start: number, words: number[]): Promise<boolean> {
  let inFactory = false
  busy.value = true // 置 batchBusy：行内下发期间暂停 2s 自动轮询，避免普通读帧插进工厂模式帧序列
  try {
    const entered = await enterFactory()
    if (!entered) return false
    inFactory = true
    const resp = await jbdBus.sendAck(buildWriteParam(start, wordsToBytes(words)))
    if (!resp || resp.timeout) throw new Error('写入超时')
    if (resp.status >= 0x80) throw new Error(`写入被拒（0x${resp.status.toString(16)}）`)
    applyReadbackWords(start, words)
    // 回读：宽松回填设备真实值（不判失败，与 JBDTools 一致）
    jbdBus.send(buildReadParam(start, words.length))
    const back = await awaitParamResponse(start, SEG_TIMEOUT_MS, words.length)
    const backWords = frameWords(back, words.length)
    if (backWords) applyReadbackWords(start, backWords)
    return true
  } finally {
    if (inFactory) await exitFactory()
    busy.value = false
  }
}

/** 行内「下发」：单字段 / ASCII 块 / scd 整寄存器 */
export async function writeField(f: FieldState): Promise<boolean> {
  if (!ensureDispatchAllowed()) return false
  if (!canWrite(f)) return false
  f.status = 'writing'
  // 检流阻值等需密码校验：先弹窗确认，密码不正确则中止下发
  if (f.needPassword) {
    const ok = await confirmPassword()
    if (!ok) {
      f.status = 'fail'
      ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
      return false
    }
  }
  let start: number
  let words: number[]
  if (f.ascii) {
    start = f.index!
    words = encodeAsciiBlock(String(f.value ?? ''), f.ascii_len ?? 8)
  } else {
    start = f.index!
    words = [rawOfField(f)]
  }
  try {
    const ok = await writeSegmentSingle(start, words)
    f.status = ok ? 'ok' : 'fail'
    if (ok) {
      f.dirty = false
      ElMessage.success(`写参数[${f.label}]成功`)
      void uploadDispatchSnapshot()
    } else {
      ElMessage.error(`写参数[${f.label}]失败`)
    }
    return ok
  } catch (e: any) {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: ${e?.message || e}`)
    return false
  }
}

/** 分组位图整字下发（功能配置/NTC 配置的「应用」按钮） */
export async function writeGroupBitmap(g: { title: string; fields: FieldState[] }, bitIndex: number) {
  if (!ensureDispatchAllowed()) return
  const bitFields = g.fields.filter((f) => isBitSwitch(f) && f.bitIndex === bitIndex)
  if (!bitFields.length) return
  // 镜像里没有该寄存器（未读取过）则先读一次
  if (regMirror.value[bitIndex] === undefined) {
    jbdBus.send(buildReadParam(bitIndex, 1))
    const resp = await awaitParamResponse(bitIndex)
    const words = frameWords(resp ?? null, 1)
    if (!words) { ElMessage.error(`读取位图[${bitIndex}]失败`); return }
    regMirror.value[bitIndex] = words[0]
  }
  applyFieldsToMirror(bitFields)
  const raw = regMirror.value[bitIndex] ?? 0
  const ok = await writeSegmentSingle(bitIndex, [raw & 0xffff])
  if (ok) {
    for (const f of bitFields) { f.dirty = false; f.status = 'ok' }
    ElMessage.success(`[${g.title}] 位图下发完成：0x${(regMirror.value[bitIndex] ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
    void uploadDispatchSnapshot()
  }
}

// 字段行内「复位 MCU」：发送控制指令（进工厂 → 控制指令 → 退工厂）
export async function confirmResetMcu() {
  if (!ensureDispatchAllowed()) return
  try {
    await ElMessageBox.confirm('确定要复位 MCU 吗？设备将重新启动。', '复位 MCU', { type: 'warning' })
  } catch {
    return
  }
  let tmpFactory = false
  if (autoFactory.value && !inFactory.value) {
    tmpFactory = await enterFactory()
  }
  await jbdBus.send(buildControlCommand(CONTROL_FUNC.RESET_MCU))
  if (tmpFactory && autoFactory.value) await exitFactory()
  ElMessage.success('已发送复位 MCU 指令')
}

/* ------------------------------------------------------------------ */
/* 写入参数（脏字段）/ 强制下发（整包）：统一走九段写（11 帧）           */
/* ------------------------------------------------------------------ */
/** 「全部写入 / 强制下发」的字段筛选口径：有寄存器、非只读、非位开关（位图随镜像整包写）、
 *  非密码字段（检流电阻例外：不随批量下发），且值非空。 */
function canBatchDispatch(f: FieldState): boolean {
  if (f.customDisplay && f.customDisplay !== 'date') return false
  if (f.readOnly) return false
  if (isBitSwitch(f)) return false
  if (f.index === undefined) return false
  if (f.needPassword) return false
  return f.value !== null && f.value !== undefined
}

/** 当前可整包下发的字段数（强制下发按钮小字展示） */
export const batchDispatchCount = computed(() => allFields.value.filter(canBatchDispatch).length)

export async function writeAll() {
  if (!ensureDispatchAllowed()) return
  if (!paramsLoaded.value) { ElMessage.warning('请先「读取参数」'); return }
  const fields = allFields.value.filter(canBatchDispatch)
  if (!fields.length) { ElMessage.warning('暂无可写入的参数'); return }
  // 写入确认：回车即执行（MessageBox 默认聚焦确定键）
  try {
    await ElMessageBox.confirm(
      `即将把 ${fields.length} 项参数写入设备，覆盖设备现有参数。确定执行？`,
      '写入参数确认',
      { type: 'warning', confirmButtonText: '确定写入', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // 下发前重读芯片类型（SCD 档位解释用；不动页面参数值）
  j.chipType.value = null
  await j.readChip()
  applyFieldsToMirror(fields)
  syncFullChargeMirror(fields)
  // 导入后免读取写入：静默补读镜像缺口段（文件未覆盖的寄存器取设备现值），避免全 0 覆盖
  if (!mirrorComplete.value) {
    if (!(await fillMirrorGaps())) {
      ElMessage.error('缺失寄存器自动补读失败，请先「读取参数」再写入')
      return
    }
    mirrorComplete.value = true
  }
  const ok = await writeParamsNine()
  if (!ok) {
    // 定向回读受影响段；定向失败（如链路异常）再整包回读兜底
    const segs = segmentsForFields(fields)
    if (!segs.length || !(await readSegmentsBack(segs))) await readAll()
    ElMessage.error('写入参数失败，已回读设备真实状态')
    return
  }
  for (const f of fields) { f.dirty = false; f.status = 'ok' }
  ElMessage.success('写入参数成功')
  // 本地落地 + 后台上传（与强制下发同口径）
  const btField = fields.find((f) => f.key === 'bt-name')
  const btName = btField && btField.value != null ? String(btField.value) : '—'
  const params: DispatchParam[] = fields.map((f) => ({ label: f.label, index: f.index, value: f.value }))
  addDispatchRecord({ btName, params })
  ElMessage.info('已记录本次写入到本地历史')
  if (shouldUploadDispatchResult({ ok: fields.length, fail: 0 })) await uploadDispatchSnapshot()
}

export async function forceWriteAll() {
  if (!ensureDispatchAllowed()) return
  if (!paramsLoaded.value) { ElMessage.warning('暂无可下发的参数（请先读取设备参数）'); return }
  const fields = allFields.value.filter(canBatchDispatch)
  if (!fields.length) { ElMessage.warning('暂无可下发的参数（请先读取设备参数）'); return }
  try {
    await ElMessageBox.confirm(
      `即将把当前读取到的 ${fields.length} 项参数按九段整包下发到设备，覆盖设备现有参数。检流阻值（reg28）不在其中，需口令单独下发。\n帧序列：进工厂 1 + 九段写 9 + 退工厂 1 = 11 帧，成功后不回读。`,
      '⚠ 强制下发确认',
      { type: 'warning', confirmButtonText: '确定下发', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // 下发前重读芯片类型（不读参数、不动字段值）：换电池不重连时 chipType 仍是
  // 上一台的缓存，会导致二级过流/短路下拉框用错档位表。
  j.chipType.value = null
  await j.readChip()
  applyFieldsToMirror(fields)
  syncFullChargeMirror(fields)
  if (!mirrorComplete.value) {
    if (!(await fillMirrorGaps())) {
      ElMessage.error('缺失寄存器自动补读失败，请先「读取参数」再下发')
      return
    }
    mirrorComplete.value = true
  }
  const ok = await writeParamsNine()
  if (!ok) {
    const segs = segmentsForFields(fields)
    if (!segs.length || !(await readSegmentsBack(segs))) await readAll()
    ElMessage.error(`强制下发失败（${fields.length} 项），已回读设备真实状态`)
    return
  }
  ElMessage.success(`强制下发完成：${fields.length} 项`)
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
  if (shouldUploadDispatchResult({ ok: fields.length, fail: 0 })) await uploadDispatchSnapshot()
}

/* ------------------------------------------------------------------ */
/* 导入 / 导出（.json / .fig；检流电阻 reg28 自动跳过）                  */
/* ------------------------------------------------------------------ */
export function onFileChange(uploadFile: any) {
  const file = uploadFile?.raw as File | undefined
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const text = reader.result as string
      let source = '文件：' + file.name
      let list: ImportedParam[]
      if (isFigText(text)) {
        const parsed = parseFig(text)
        if (parsed.hit === 0) { ElMessage.error('未识别到任何参数行，请确认是嘉佰达导出的 .fig 文件'); return }
        list = []
        parsed.regs.forEach((raw, i) => {
          if (raw === undefined || i === 28) return
          const d = fieldByIndex(i)
          list.push({ index: i, label: d?.label ?? `寄存器[${i}]`, unit: d?.unit ?? '', value: paramRawToDisplay(i, raw), raw })
        })
        for (const [k, v] of Object.entries(parsed.ascii)) {
          const idx = Number(k)
          const d = fieldByIndex(idx)
          const sv = String(v ?? '')
          if (!sv.trim() || !d?.ascii) continue
          list.push({ index: idx, label: d.label, unit: '', value: sv, raw: 0, ascii: sv })
        }
        if (!list.length) { ElMessage.error('文件里没有可导入的参数'); return }
        source += '（.fig）'
      } else {
        const data = JSON.parse(text)
        const r = parseJsonImport(data)
        if ('error' in r) { ElMessage.error(r.error); return }
        list = r.list
        if (r.skippedSense) ElMessage.info('已跳过检流电阻（reg28），该参数需单独下发')
      }
      importedSourceName.value = source
      applyImport(list)
    } catch (e: any) {
      ElMessage.error('解析失败：' + (e?.message || '文件格式错误'))
    }
  }
  reader.onerror = () => ElMessage.error('文件读取失败')
  reader.readAsText(file, 'UTF-8')
}

function parseJsonImport(data: any): { list: ImportedParam[]; skippedSense?: boolean } | { error: string } {
  const rawList: any[] = Array.isArray(data) ? data : (data?.params ?? [])
  if (!Array.isArray(rawList)) return { error: '配置文件格式不支持（需为 JBD 参数 JSON）' }
  const out: ImportedParam[] = []
  let skippedSense = false
  for (const item of rawList) {
    const index = Number(item?.index ?? item?.reg)
    if (typeof item?.ascii === 'string') {
      if (!Number.isInteger(index) || index < 0 || index > 65535) continue
      const def = fieldByIndex(index)
      if (!def?.ascii) continue
      out.push({ index, label: item?.label || def.label, unit: '', value: String(item.ascii), raw: 0, ascii: String(item.ascii) })
      continue
    }
    const raw = Number(item?.raw ?? item?.value)
    if (!Number.isInteger(index) || index < 0 || index > 65535) continue
    if (!Number.isFinite(raw)) continue
    if (index === 28) { skippedSense = true; continue }
    const r = ((Math.trunc(raw) & 0xffff) >>> 0) & 0xffff
    const def = fieldByIndex(index)
    if (!def) continue
    out.push({ index, label: item?.label || def.label || `寄存器[${index}]`, unit: item?.unit || def.unit || '', value: paramRawToDisplay(index, r), raw: r })
  }
  if (!out.length) return { error: '未找到有效参数（请检查文件内容）' }
  return { list: out, skippedSense }
}

function applyImport(list: ImportedParam[]) {
  const appliedFields = new Set<FieldState>()
  for (const p of list) {
    const def = fieldByIndex(p.index)
    if (!def) continue
    // SCD 拆分字段：从组合 raw 中还原 level + delay，分别回填到两个 UI 字段
    if (def.kind === 'scd') {
      const { level, delay } = splitScd(p.raw)
      const peer = scdPeer(def)
      const currentLevel = def.value ?? null
      const currentDelay = peer?.value ?? null
      if (!appliedFields.has(def)) {
        def.value = level; def.dirty = true; def.status = 'idle'
        appliedFields.add(def)
      }
      if (peer && !appliedFields.has(peer)) {
        peer.value = delay; peer.dirty = true; peer.status = 'idle'
        appliedFields.add(peer)
      }
      p.current = currentLevel
      continue
    }
    // reg42 硬件过欠压延时：raw 档位拆到 过压延时(bit0-1)/欠压延时(bit2-4) 两个字段
    if (def.kind === 'hvd') {
      const peer = scdPeer(def)
      const ov = p.raw & 0x03
      const uv = (p.raw >> 2) & 0x07
      if (!appliedFields.has(def)) {
        def.value = def.hvdPart === 'uv' ? uv : ov; def.dirty = true; def.status = 'idle'
        appliedFields.add(def)
      }
      if (peer && !appliedFields.has(peer)) {
        peer.value = peer.hvdPart === 'uv' ? uv : ov; peer.dirty = true; peer.status = 'idle'
        appliedFields.add(peer)
      }
      p.current = null
      continue
    }
    // reg42 硬件过欠压延时：raw 高/低字节拆到 过压延时/欠压延时 两个字段
    if (def.kind === 'hvd') {
      const peer = scdPeer(def)
      const ov = p.raw & 0xff
      const uv = (p.raw >> 8) & 0xff
      if (!appliedFields.has(def)) {
        def.value = def.hvdPart === 'uv' ? uv : ov; def.dirty = true; def.status = 'idle'
        appliedFields.add(def)
      }
      if (peer && !appliedFields.has(peer)) {
        peer.value = peer.hvdPart === 'uv' ? uv : ov; peer.dirty = true; peer.status = 'idle'
        appliedFields.add(peer)
      }
      p.current = null
      continue
    }
    const current = def.value ?? null
    p.current = current
    def.value = p.ascii !== undefined ? p.ascii : p.value
    def.dirty = true
    def.status = 'idle'
  }
  importedParams.value = list
  // 导入即视为「已加载参数」：可直接写入，无需先读取设备。
  // 镜像缺口（文件未覆盖的寄存器）在写入前由 fillMirrorGaps 自动从设备补读，避免全 0 覆盖。
  paramsLoaded.value = true
  mirrorComplete.value = false
  ElMessage.success(`导入参数成功（${list.length} 项），核对无误后点击「写入参数」`)
}

/** 补齐镜像缺口：只读「导入文件未覆盖、且镜像缺项」所在的段，设备值填缺项，
 *  已有值（含导入待写值）不动。全部补齐返回 true。 */
async function fillMirrorGaps(): Promise<boolean> {
  const segs = READ_SEGMENTS.filter((s) => {
    for (let i = s.start; i < s.start + s.count; i++) if (regMirror.value[i] === undefined) return true
    return false
  })
  if (!segs.length) return true
  busy.value = true
  try {
    for (const seg of segs) {
      segNote.value = `补读 ${seg.start}~${seg.start + seg.count - 1}（${seg.note}）`
      jbdBus.send(buildReadParam(seg.start, seg.count))
      const resp = await awaitSegmentResponse(seg.start, seg.count)
      const words = frameWords(resp, seg.count)
      if (!words) return false
      if (ASCII_BLOCK_STARTS.has(seg.start)) {
        if (asciiRawMirror.value[seg.start] === undefined) {
          asciiRawMirror.value[seg.start] = words
          asciiMirror.value[seg.start] = decodeAsciiWords(words)
        }
        // ASCII 块已有导入文本时保留文本（写入时走重新编码路径），只补原始字缺项
        else if (asciiRawMirror.value[seg.start]!.length !== seg.count) {
          asciiRawMirror.value[seg.start] = words
        }
      } else {
        for (let k = 0; k < seg.count; k++) {
          const idx = seg.start + k
          if (regMirror.value[idx] === undefined) regMirror.value[idx] = words[k] & 0xffff
        }
      }
    }
    return true
  } finally {
    busy.value = false
    segNote.value = ''
  }
}

export function clearImport() { importedParams.value = [] }

export function currentParamValue(p: ImportedParam): string {
  if (p.current === null || p.current === undefined) return '—'
  return `${p.current} ${p.unit}`
}

// 下发值（配置文件）与设备当前值不同 → 需要高亮提示
export function isSendDiff(p: ImportedParam): boolean {
  const c = p.current
  if (c === null || c === undefined) return false
  if (p.ascii !== undefined || typeof c === 'string') return String(c).trim() !== String(p.value).trim()
  return Number(c) !== p.value
}

export async function sendAllImported() {
  if (!ensureDispatchAllowed()) return
  if (!importedParams.value.length) return
  if (!paramsLoaded.value) {
    const okBase = await readAll()
    if (!okBase) { ElMessage.error('读取设备参数失败，已取消下发'); return }
  }
  // 导入值写入镜像（检流电阻 reg28 不覆盖）；ASCII 块写文本
  for (const p of importedParams.value) {
    if (p.index === 28) continue
    if (p.ascii !== undefined) {
      asciiMirror.value[p.index] = p.ascii
      const af = allFields.value.find((x) => x.index === p.index && x.ascii)
      if (af) { af.value = p.ascii; af.dirty = true }
      continue
    }
    regMirror.value[p.index] = p.raw & 0xffff
    for (const f of allFields.value.filter((x) => x.index === p.index && !isBitSwitch(x))) {
      f.value = f.kind === 'scd' ? (f.scdPart === 'delay' ? splitScd(p.raw).delay : splitScd(p.raw).level)
        : paramRawToDisplay(p.index, p.raw & 0xffff)
      f.dirty = true
    }
  }
  // 满充容量(112) 与 标称容量(0) 一致：导入含标称容量时镜像强制带上满充容量
  const nominal = importedParams.value.find((p) => p.index === 0)
  if (nominal) {
    regMirror.value[112] = paramDisplayToRaw(0, Number(nominal.value)) & 0xffff
    const full = allFields.value.find((f) => f.index === 112)
    if (full) full.value = nominal.value
  }
  const n = importedParams.value.length
  const ok = await writeParamsNine()
  if (!ok) {
    await readAll()
    ElMessage.error(`一键下发失败，已回读设备真实状态`)
    return
  }
  ElMessage.success(`一键下发完成：${n} 项`)
  importDialogVisible.value = false
  if (shouldUploadDispatchResult({ ok: n, fail: 0 })) await uploadDispatchSnapshot()
}

// 构造与导出文件同构的配置对象（供「导出配置」与「存为模板」共用）
function buildExportData() {
  const params: any[] = []
  const emitted = new Set<number>()
  for (const f of allFields.value) {
    if (f.value === null || f.index === undefined || f.customDisplay || f.readOnly || f.bitIndex !== undefined) continue
    if (f.needPassword) continue // 检流电阻等受保护参数不导出
    if (f.ascii) {
      if (f.key !== 'mfr') continue
      const text = String(f.value ?? '').trim()
      if (!text) continue
      params.push({ index: f.index, label: f.label, unit: '', value: text, ascii: text })
      continue
    }
    if (f.kind === 'scd' && f.scdPart === 'delay') continue
    let raw: number
    let value: number
    if (f.kind === 'scd' && f.scdPart === 'level') {
      const peer = scdPeer(f)
      const levelVal = f.value as number
      const delayVal = peer?.value ?? 0
      raw = combineScd(levelVal, delayVal) & 0xffff
      value = levelVal
      emitted.add(f.index)
    } else {
      raw = paramDisplayToRaw(f.index!, f.value as number)
      value = f.value as number
    }
    params.push({ index: f.index!, label: f.label, unit: f.unit || '', value, raw })
  }
  return { type: 'jbd-param-config', version: '1.0', exportedAt: new Date().toISOString(), params }
}

/** 导出参数（JBDTools 同款 .fig）：Alf-YYYYMMDDhhmmss.fig，全 184 寄存器 + ASCII 块 + 芯片类型 */
async function exportConfig() {
  if (!paramsLoaded.value) { ElMessage.warning('请先「读取参数」再导出'); return }
  // 镜像不完整（仅导入未读取）时：已连接则静默补齐缺口段，避免导出文件出现全 0 寄存器；未连接则原样导出
  if (!mirrorComplete.value && j.connected.value) {
    const ok = await fillMirrorGaps()
    if (!ok) { ElMessage.error('缺失寄存器自动补读失败，导出内容可能不完整'); return }
    mirrorComplete.value = true
  }
  const regs = new Array(MIRROR_SIZE).fill(0)
  for (const [k, v] of Object.entries(regMirror.value)) regs[Number(k)] = v & 0xffff
  const text = buildFig(regs, asciiMirror.value, j.chipType.value ?? 0)
  const blob = new Blob([text], { type: 'text/plain;charset=ascii' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = figFileName()
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success('已导出参数文件：' + a.download)
}

// ====== 统一导出（页面消费面） ======
export function useDispatch() {
  return {
    // 上下文
    j, busy, progress, segNote, paramsLoaded, autoFactory, inFactory,
    // 字段与分组
    columns, groups, allFields, dirtyCount, tripleRows,
    isBitSwitch, isReadOnly, shouldShowUnit, canWrite,
    onBitChange, onNumInput, onAsciiInput, onSelectChange,
    onDateInput, dateInputText, disableOutOfRangeDate, formatFieldValue, customDisplayValue,
    numDisplay, onNumEdit, onNumFocus, onNumBlur,
    scdOptions,
    // 动作
    readAll, writeAll, writeField, forceWriteAll, writeGroupBitmap, confirmResetMcu,
    batchDispatchCount,
    // 导入/导出/模板
    importedParams, importedSourceName, importDialogVisible,
    onFileChange, onFileChangeFromDialog, openTemplateDialog, importFromTemplate,
    templates, templateDialogVisible, renameTemplate, deleteTemplate, formatDate,
    confirmThenSaveTemplate, confirmThenExportConfig, exportConfig,
    clearImport, currentParamValue, isSendDiff, sendAllImported,
    // 密码弹窗（App.vue 全局渲染 dlg-pwd）
    pwdVisible, pwdInput, pwdError, pwdTitle, pwdHint, pwdConfirmText,
    confirmPassword, onPwdConfirm, onPwdCancel,
    // 镜像（调试/扩展用）
    regMirror,
  }
}
