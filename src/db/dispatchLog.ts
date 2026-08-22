// 下发记录本地历史（localStorage 持久化，无需后端 / 第三方依赖）
// 与 App.vue 中 Rail 折叠状态的持久化方式一致，Electron 渲染进程内可靠可读写。
//
// v2 结构升级（2026-08）：
//   - 记录所有下发入口（强制/全部写入/导入/单字段/位图/重新下发），见 DispatchOpType
//   - 记录每参数的下发结果与原始 raw 值，及整单状态统计（ok/partial/fail）
//   - 记录设备上下文（芯片类型 / SN / 软件版本 / 串口），多电池作业可追溯
//   - 写入容量保护：localStorage 满时按最旧 20% 淘汰后重写，不再静默丢失整单
// 旧 v1 记录读取时自动迁移（opType 默认 force、无结果的参数按成功计）。

/** 下发操作类型 */
export type DispatchOpType = 'force' | 'writeAll' | 'import' | 'single' | 'bitmap' | 'resend'

export const DISPATCH_OP_LABEL: Record<DispatchOpType, string> = {
  force: '强制下发',
  writeAll: '全部写入',
  import: '导入下发',
  single: '单字段下发',
  bitmap: '位图配置',
  resend: '重新下发',
}

/** 整单状态：全成功 / 部分失败 / 全失败 */
export type DispatchStatus = 'ok' | 'partial' | 'fail'

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  ok: '全成功',
  partial: '部分失败',
  fail: '失败',
}

/** 单参数下发结果 */
export type DispatchResult = 'ok' | 'fail' | 'verifyFail'

export const DISPATCH_RESULT_LABEL: Record<DispatchResult, string> = {
  ok: '成功',
  fail: '失败',
  verifyFail: '校验不一致',
}

export interface DispatchParam {
  /** 参数中文名（如「额定充电电压」） */
  label: string
  /** 寄存器地址（0xFA 保护参数索引） */
  index?: number
  /** 下发值（数值 / 字符串 / 布尔等原始值） */
  value: unknown
  /** 下发的 16 位原始值（scd 为 level+delay 组合字；ASCII 字段无） */
  raw?: number
  /** 下发结果（缺省视为成功，兼容旧记录） */
  result?: DispatchResult
}

export interface DispatchRecord {
  id: string
  /** 下发时间，epoch 毫秒 */
  time: number
  opType: DispatchOpType
  status: DispatchStatus
  okCount: number
  failCount: number
  verifyFailCount: number
  /** 蓝牙名称（来自参数页 蓝牙名称 字段） */
  btName: string
  /** 设备上下文（下发给哪块电池） */
  chipTypeName?: string
  sn?: string
  swVersion?: string
  portPath?: string
  /** 本次下发的全部参数快照 */
  params: DispatchParam[]
}

const KEY = 'jbd_dispatch_log_v1'
const MAX = 500

/** 由参数结果推导整单统计与状态 */
function summarize(params: DispatchParam[]) {
  let ok = 0, fail = 0, verifyFail = 0
  for (const p of params) {
    if (p.result === 'fail') fail++
    else if (p.result === 'verifyFail') verifyFail++
    else ok++
  }
  const status: DispatchStatus = fail + verifyFail === 0 ? 'ok' : ok > 0 ? 'partial' : 'fail'
  return { okCount: ok, failCount: fail, verifyFailCount: verifyFail, status }
}

/** 旧版（v1）记录迁移：补默认 opType / 统计字段 */
function migrate(raw: any): DispatchRecord {
  const params: DispatchParam[] = Array.isArray(raw?.params)
    ? raw.params.map((p: any) => ({ label: String(p?.label ?? ''), index: p?.index, value: p?.value, raw: p?.raw }))
    : []
  return {
    id: String(raw?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
    time: Number(raw?.time ?? Date.now()),
    opType: (raw?.opType as DispatchOpType) ?? 'force',
    btName: String(raw?.btName ?? '—'),
    chipTypeName: raw?.chipTypeName,
    sn: raw?.sn,
    swVersion: raw?.swVersion,
    portPath: raw?.portPath,
    params,
    ...summarize(params),
  }
}

/** 写入（带容量保护）：超上限裁剪；写满时淘汰最旧 20% 重试 */
function persist(records: DispatchRecord[]): void {
  if (records.length > MAX) records = records.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
  } catch {
    // localStorage 满（约 5MB）：淘汰最旧 20% 后重写（新记录在前，故保留头部），仍失败则放弃本次写入
    const keep = Math.max(1, Math.floor(records.length * 0.8))
    try { localStorage.setItem(KEY, JSON.stringify(records.slice(0, keep))) } catch { /* 彻底写不下 */ }
  }
}

export function getDispatchRecords(): DispatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(migrate) : []
  } catch {
    return []
  }
}

export function addDispatchRecord(rec: {
  opType: DispatchOpType
  btName: string
  params: DispatchParam[]
  chipTypeName?: string
  sn?: string
  swVersion?: string
  portPath?: string
}): DispatchRecord {
  const full: DispatchRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    time: Date.now(),
    opType: rec.opType,
    btName: rec.btName,
    chipTypeName: rec.chipTypeName,
    sn: rec.sn,
    swVersion: rec.swVersion,
    portPath: rec.portPath,
    params: rec.params,
    ...summarize(rec.params),
  }
  const all = getDispatchRecords()
  all.unshift(full)
  persist(all)
  return full
}

/** 批量删除指定 id 的记录 */
export function removeRecords(ids: string[]): void {
  if (!ids.length) return
  const set = new Set(ids)
  persist(getDispatchRecords().filter((r) => !set.has(r.id)))
}

/** 删除 N 天前的记录，返回删除条数 */
export function removeRecordsOlderThan(days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const all = getDispatchRecords()
  const kept = all.filter((r) => r.time >= cutoff)
  const removed = all.length - kept.length
  if (removed > 0) persist(kept)
  return removed
}

export function clearDispatchRecords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
