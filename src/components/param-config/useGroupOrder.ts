/** 分组拖动排序：左右两列各自可拖拽重排，也支持跨列移动；顺序持久化到 localStorage */
import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { GroupObj } from './types'
import { buildColumnsFromTitles } from './groupDefs'

const DRAG_ORDER_KEY = 'jbd-param-group-order'

export function useGroupOrder(columns: Ref<GroupObj[][]>, defaultOrder: string[][]) {
  const dragMode = ref(false)
  const draggedTitle = ref<string | null>(null)

  // 在左右两列中查找某分组当前所在位置
  function findGroup(title: string): { col: 0 | 1; idx: number } | null {
    for (const c of [0, 1] as const) {
      const idx = columns.value[c].findIndex((g) => g.title === title)
      if (idx >= 0) return { col: c, idx }
    }
    return null
  }

  function applySavedOrder() {
    let saved: string[][] | null = null
    try {
      const raw = localStorage.getItem(DRAG_ORDER_KEY)
      if (raw) {
        const v = JSON.parse(raw)
        if (Array.isArray(v)) {
          if (v.every((c) => Array.isArray(c))) {
            // 新格式：[[左列...],[右列...]]
            saved = (v as unknown[]).map((c) => (c as unknown[]).filter((x) => typeof x === 'string')) as string[][]
          } else if (v.every((x) => typeof x === 'string')) {
            // 旧版单数组格式兼容：按半分迁移到两列
            const mid = Math.ceil(v.length / 2)
            saved = [v.slice(0, mid), v.slice(mid)]
          }
        }
      }
    } catch { /* 忽略损坏的本地存储 */ }
    if (!saved) return
    const pool = new Map(columns.value.flat().map((g) => [g.title, g]))
    const left: GroupObj[] = []
    const right: GroupObj[] = []
    for (const t of saved[0] ?? []) {
      const g = pool.get(t)
      if (g) { left.push(g); pool.delete(t) }
    }
    for (const t of saved[1] ?? []) {
      const g = pool.get(t)
      if (g) { right.push(g); pool.delete(t) }
    }
    // 新增/缺失的分组补到右列末尾，避免丢失
    for (const g of pool.values()) right.push(g)
    columns.value = [left, right]
  }

  function saveOrder() {
    try {
      localStorage.setItem(
        DRAG_ORDER_KEY,
        JSON.stringify(columns.value.map((col) => col.map((g) => g.title))),
      )
    } catch { /* 忽略写入失败（如隐私模式） */ }
  }
  applySavedOrder()

  function onDragStart(g: { title: string }) {
    draggedTitle.value = g.title
  }
  // 拖到某分组卡片上：插入到该卡片所在位置（可在同列或跨列）
  function onDropGroup(targetTitle: string, targetCol: number) {
    const fromTitle = draggedTitle.value
    draggedTitle.value = null
    if (!fromTitle || fromTitle === targetTitle) return
    const moved = findGroup(fromTitle)
    if (!moved) return
    const node = columns.value[moved.col][moved.idx]
    // 先从原列移除
    columns.value[moved.col] = columns.value[moved.col].filter((g) => g.title !== fromTitle)
    // 再插入目标列指定位置
    const targetArr = columns.value[targetCol].slice()
    const ti = targetArr.findIndex((g) => g.title === targetTitle)
    if (ti < 0) targetArr.push(node)
    else targetArr.splice(ti, 0, node)
    columns.value[targetCol] = targetArr
    saveOrder()
  }
  // 拖到列空白区：追加到该列末尾（支持跨列移动）
  function onDropColumn(targetCol: number) {
    const fromTitle = draggedTitle.value
    draggedTitle.value = null
    if (!fromTitle) return
    const moved = findGroup(fromTitle)
    if (!moved || moved.col === targetCol) return
    const node = columns.value[moved.col][moved.idx]
    columns.value[moved.col] = columns.value[moved.col].filter((g) => g.title !== fromTitle)
    const targetArr = columns.value[targetCol].slice()
    targetArr.push(node)
    columns.value[targetCol] = targetArr
    saveOrder()
  }
  function onDragEnd() {
    draggedTitle.value = null
  }
  // 恢复出厂默认顺序（清掉本地存储的拖拽结果，回退到代码固化 defaultColumnOrder）
  function resetToDefault() {
    try { localStorage.removeItem(DRAG_ORDER_KEY) } catch { /* 忽略 */ }
    columns.value = buildColumnsFromTitles(defaultOrder)
    ElMessage.success('已恢复默认顺序')
  }

  return { dragMode, draggedTitle, onDragStart, onDropGroup, onDropColumn, onDragEnd, resetToDefault }
}
