import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDispatchRecords, addDispatchRecord, removeRecords, removeRecordsOlderThan,
  clearDispatchRecords, type DispatchParam,
} from '../dispatchLog'

// Node 环境无 localStorage：内存 stub（模块在调用时读取 globalThis.localStorage）
function installStorage(opts: { failSetItemTimes?: number } = {}) {
  const store = new Map<string, string>()
  let failLeft = opts.failSetItemTimes ?? 0
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem(k: string, v: string) {
      if (failLeft > 0) { failLeft--; throw new Error('QuotaExceededError') }
      store.set(k, v)
    },
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  }
  return store
}

beforeEach(() => installStorage())

describe('addDispatchRecord 统计', () => {
  it('由参数结果推导 ok/fail/verifyFail 计数与整单状态', () => {
    const params: DispatchParam[] = [
      { label: 'a', index: 1, value: 1, raw: 1, result: 'ok' },
      { label: 'b', index: 2, value: 2, raw: 2, result: 'fail' },
      { label: 'c', index: 3, value: 3, raw: 3, result: 'verifyFail' },
    ]
    const rec = addDispatchRecord({ opType: 'force', btName: 'T1', params })
    expect(rec.okCount).toBe(1)
    expect(rec.failCount).toBe(1)
    expect(rec.verifyFailCount).toBe(1)
    expect(rec.status).toBe('partial')
    // 新记录在最前
    expect(getDispatchRecords()[0].id).toBe(rec.id)
  })

  it('全部失败 → fail；无 result（旧数据风格）按成功计 → ok', () => {
    const allFail = addDispatchRecord({
      opType: 'single', btName: 'T',
      params: [{ label: 'x', index: 1, value: 1, result: 'fail' }],
    })
    expect(allFail.status).toBe('fail')
    const legacy = addDispatchRecord({
      opType: 'single', btName: 'T',
      params: [{ label: 'x', index: 1, value: 1 }],
    })
    expect(legacy.status).toBe('ok')
    expect(legacy.okCount).toBe(1)
  })
})

describe('旧版（v1）记录迁移', () => {
  it('缺少 opType/统计字段的旧记录读取时补默认值', () => {
    const legacy = [{
      id: 'old1', time: 1700000000000, btName: 'OLD',
      params: [{ label: '标称容量', index: 0, value: 60 }, { label: '置满电压', index: 2, value: 3550 }],
    }]
    localStorage.setItem('jbd_dispatch_log_v1', JSON.stringify(legacy))
    const recs = getDispatchRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0].opType).toBe('force')
    expect(recs[0].status).toBe('ok')
    expect(recs[0].okCount).toBe(2)
    expect(recs[0].params[0].value).toBe(60)
  })
})

describe('容量保护', () => {
  it('写入失败时按最旧 20% 淘汰后重写', () => {
    // 预置 10 条
    for (let i = 0; i < 10; i++) {
      addDispatchRecord({ opType: 'force', btName: `B${i}`, params: [{ label: 'p', index: 1, value: i, result: 'ok' }] })
    }
    expect(getDispatchRecords()).toHaveLength(10)
    // 让下一次 setItem 失败一次（模拟 localStorage 满）
    ;(globalThis as any).localStorage.setItem = (() => {
      let failed = false
      const orig = (globalThis as any).localStorage.setItem.bind(globalThis as any)
      return (k: string, v: string) => {
        if (!failed) { failed = true; throw new Error('QuotaExceededError') }
        orig(k, v)
      }
    })()
    const rec = addDispatchRecord({ opType: 'force', btName: 'NEW', params: [{ label: 'p', index: 1, value: 99, result: 'ok' }] })
    const recs = getDispatchRecords()
    // 10+1 条 → 淘汰最旧 20% → 保留 floor(11*0.8)=8 条
    expect(recs.length).toBe(8)
    expect(recs[0].id).toBe(rec.id)
    expect(recs.some((r) => r.btName === 'B0')).toBe(false) // 最旧的被淘汰
  })
})

describe('删除与清理', () => {
  it('removeRecords 批量删除指定 id', () => {
    const a = addDispatchRecord({ opType: 'force', btName: 'A', params: [] })
    const b = addDispatchRecord({ opType: 'force', btName: 'B', params: [] })
    const c = addDispatchRecord({ opType: 'force', btName: 'C', params: [] })
    removeRecords([a.id, c.id])
    const left = getDispatchRecords()
    expect(left.map((r) => r.id)).toEqual([b.id])
  })

  it('removeRecordsOlderThan 只删 N 天前，返回删除条数', () => {
    const DAY = 86400_000
    const oldTime = Date.now() - 40 * DAY
    // 直接预置一条 40 天前的旧记录（走存储绕过 addDispatchRecord 的当前时间）
    localStorage.setItem('jbd_dispatch_log_v1', JSON.stringify([
      { id: 'old', time: oldTime, opType: 'force', btName: 'OLD', params: [] },
    ]))
    addDispatchRecord({ opType: 'force', btName: 'NOW', params: [] })
    expect(getRecords()).toHaveLength(2)
    const removed = removeRecordsOlderThan(30)
    expect(removed).toBe(1)
    const left = getRecords()
    expect(left).toHaveLength(1)
    expect(left[0].btName).toBe('NOW')
  })

  it('clearDispatchRecords 清空', () => {
    addDispatchRecord({ opType: 'force', btName: 'A', params: [] })
    clearDispatchRecords()
    expect(getDispatchRecords()).toHaveLength(0)
  })
})

function getRecords() { return getDispatchRecords() }
