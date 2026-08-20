// 强制下发的本地历史记录（localStorage 持久化，无需后端 / 第三方依赖）
// 与 App.vue 中 Rail 折叠状态的持久化方式一致，Electron 渲染进程内可靠可读写。

export interface DispatchParam {
  /** 参数中文名（如「额定充电电压」） */
  label: string
  /** 寄存器地址（0xFA 保护参数索引） */
  index?: number
  /** 下发值（数值 / 字符串 / 布尔等原始值） */
  value: unknown
}

export interface DispatchRecord {
  id: string
  /** 下发时间，epoch 毫秒 */
  time: number
  /** 蓝牙名称（来自参数页 蓝牙名称 字段） */
  btName: string
  /** 本次下发的全部参数快照 */
  params: DispatchParam[]
}

const KEY = 'jbd_dispatch_log_v1'
const MAX = 500

export function getDispatchRecords(): DispatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function addDispatchRecord(rec: { btName: string; params: DispatchParam[] }): DispatchRecord {
  const full: DispatchRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    time: Date.now(),
    btName: rec.btName,
    params: rec.params,
  }
  const all = getDispatchRecords()
  all.unshift(full)
  if (all.length > MAX) all.length = MAX
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* 存储满 / 隐私模式等：忽略，不阻断下发 */
  }
  return full
}

export function removeDispatchRecord(id: string): void {
  const all = getDispatchRecords().filter((r) => r.id !== id)
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export function clearDispatchRecords(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
