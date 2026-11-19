<!--
  DispatchLog — 下发记录页（基准：design/preview.html 页面 4）
  强制下发本地历史表格：搜索 / 刷新 / 清空 / 删除 / 展开参数明细（subtable）。
-->
<template>
  <div class="page-dlog">
    <div class="card">
      <div class="hd">
        <span class="t">强制下发记录</span>
        <span class="aux">本地 JSON 持久化 · 断电不丢失</span>
      </div>
      <div class="bd">
        <div class="searchbar">
          <input v-model="keyword" type="text" placeholder="搜索 蓝牙名称 / 参数名 / 值" class="sb-input">
          <button class="btn sm" @click="onRefresh">刷新</button>
          <button class="btn sm danger-plain" :disabled="!records.length" @click="onClear">清空记录</button>
          <span class="sb-meta num">共 {{ filtered.length }} 条</span>
        </div>

        <div v-if="!filtered.length" class="empty">暂无下发记录（点击「产线下发 → 强制下发」后自动生成）</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th style="width:52px">#</th>
              <th style="width:180px">时间</th>
              <th>蓝牙名称</th>
              <th style="width:96px">参数项数</th>
              <th style="width:150px">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in filtered" :key="r.id">
              <tr class="row">
                <td class="num">{{ i + 1 }}</td>
                <td class="num">{{ fmtTime(r.time) }}</td>
                <td class="num bt-name">{{ r.btName }}</td>
                <td style="text-align:center">{{ r.params.length }}</td>
                <td>
                  <span class="link" @click="toggleDetail(r.id)">{{ expanded.has(r.id) ? '收起' : '查看参数' }}</span>
                  <span class="link del" @click="onRemove(r.id)">删除</span>
                </td>
              </tr>
              <tr v-if="expanded.has(r.id)" class="detail-row">
                <td colspan="5">
                  <div class="detail-title">下发参数（{{ r.params.length }} 项）</div>
                  <div class="subtable-wrap">
                    <table class="subtable">
                      <tbody>
                        <tr v-for="(p, pi) in r.params" :key="pi">
                          <td>{{ p.label }}</td>
                          <td class="num">{{ regHex(p) }}</td>
                          <td class="num">{{ fmtValue(p.value) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getDispatchRecords,
  clearDispatchRecords,
  removeDispatchRecord,
  type DispatchRecord,
  type DispatchParam,
} from '@/db/dispatchLog'

const records = ref<DispatchRecord[]>([])
const keyword = ref('')
const expanded = ref(new Set<string>())

function load() {
  records.value = getDispatchRecords()
}
onMounted(load)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return records.value
  return records.value.filter(
    (r) =>
      (r.btName && r.btName.toLowerCase().includes(k)) ||
      r.params.some(
        (p) =>
          p.label.toLowerCase().includes(k) || String(p.value).toLowerCase().includes(k),
      ),
  )
})

function toggleDetail(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '开' : '关'
  return String(v)
}

function regHex(p: DispatchParam): string {
  return p.index != null ? '0x' + p.index.toString(16).toUpperCase() : '—'
}

async function onRefresh() {
  load()
  ElMessage.info('已刷新')
}

async function onClear() {
  try {
    await ElMessageBox.confirm('确定清空全部下发记录吗？此操作不可恢复。', '清空记录', {
      type: 'warning',
    })
  } catch {
    return
  }
  clearDispatchRecords()
  expanded.value = new Set()
  load()
  ElMessage.success('已清空全部记录')
}

async function onRemove(id: string) {
  try {
    await ElMessageBox.confirm('删除这条记录？', '删除记录', { type: 'warning' })
  } catch {
    return
  }
  removeDispatchRecord(id)
  const next = new Set(expanded.value)
  next.delete(id)
  expanded.value = next
  load()
}
</script>

<style scoped>
.page-dlog {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.card > .hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
}
.card > .hd .t { font-weight: 700; font-size: 13.5px; color: var(--t1); }
.card > .hd .aux { margin-left: auto; color: var(--t3); font-size: 11.5px; }
.card > .bd { padding: 12px 14px; }

/* 搜索条 */
.searchbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sb-input {
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  outline: none;
}
.sb-input:focus { border-color: var(--brand); }
.sb-meta { color: var(--t3); font-size: 12px; }

.empty {
  padding: 40px 0;
  text-align: center;
  color: var(--t3);
  font-size: 12.5px;
}

/* preview .table */
.table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.table th {
  text-align: left;
  color: var(--t2);
  font-weight: 600;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--inset);
  white-space: nowrap;
}
.table td { padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--t1); }
/* .num 全局右对齐约定在表格单元格中回到左对齐（对齐设计稿） */
.table td.num { text-align: left; }
.table tr.row:hover td { background: var(--hover); }
.table .bt-name { font-weight: 700; }
.table .link { color: var(--brand); cursor: pointer; font-weight: 600; margin-right: 12px; }
.table .link.del { color: var(--err); }
.detail-row td { background: var(--inset); padding: 10px 14px; }
.detail-title { color: var(--t2); font-size: 12px; margin-bottom: 6px; }
.subtable-wrap { max-height: 340px; overflow-y: auto; }
.subtable { width: 100%; border-collapse: collapse; font-size: 12px; }
.subtable td { padding: 6px 10px; border-bottom: 1px dashed var(--border); color: var(--t1); }
.subtable td:first-child { color: var(--t2); }
.subtable tr:last-child td { border-bottom: none; }
</style>
