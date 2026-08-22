<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Delete, Download, Promotion, Switch } from '@element-plus/icons-vue'
import {
  getDispatchRecords,
  addDispatchRecord,
  removeRecords,
  removeRecordsOlderThan,
  clearDispatchRecords,
  DISPATCH_OP_LABEL, DISPATCH_STATUS_LABEL, DISPATCH_RESULT_LABEL,
  type DispatchRecord, type DispatchParam, type DispatchOpType, type DispatchResult,
} from '@/db/dispatchLog'
import { jbdBus } from '@/jbd/jbd-bus'
import { buildSetBtName } from '@/jbd/jbd-protocol'
import { readRegMap, readRegRaw, writeRegs, enterFactory, exitFactory, planReadChunks } from '@/jbd/jbd-reg-io'
import { useJbd } from '@/jbd/useJbd'
import { ui } from '@/store'
import { fmtDateTime } from '@/utils/time'

const props = defineProps<{ connected: boolean }>()

const j = useJbd()
const records = ref<DispatchRecord[]>([])
const keyword = ref('')
const btNameFilter = ref('')
const opTypeFilter = ref<DispatchOpType | ''>('')
const timeRange = ref<'all' | 'today' | '3d' | '7d' | '30d'>('all')

// ===== 筛选 =====
const btNameOptions = computed(() => {
  const set = new Set(records.value.map((r) => r.btName).filter((n) => n && n !== '—'))
  return [...set].sort()
})
function inTimeRange(t: number): boolean {
  const now = new Date()
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  switch (timeRange.value) {
    case 'today': return t >= today0
    case '3d': return t >= today0 - 2 * 86400_000
    case '7d': return t >= today0 - 6 * 86400_000
    case '30d': return t >= today0 - 29 * 86400_000
    default: return true
  }
}
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return records.value.filter((r) => {
    if (btNameFilter.value && r.btName !== btNameFilter.value) return false
    if (opTypeFilter.value && r.opType !== opTypeFilter.value) return false
    if (!inTimeRange(r.time)) return false
    if (!k) return true
    return (
      (r.btName && r.btName.toLowerCase().includes(k)) ||
      r.params.some(
        (p) =>
          p.label.toLowerCase().includes(k) || String(p.value).toLowerCase().includes(k),
      )
    )
  })
})

// ===== 分页（翻页清空勾选） =====
const page = ref(1)
const pageSize = ref(20)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
const globalIndex = (i: number) => i + 1 + (page.value - 1) * pageSize.value

function load() {
  records.value = getDispatchRecords()
  page.value = 1
}
onMounted(load)

async function onRefresh() {
  load()
  ElMessage.info('已刷新')
}

// ===== 格式化 =====
const fmtTime = (t: number) => fmtDateTime(t)
function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '开' : '关'
  return String(v)
}
function regHex(p: DispatchParam): string {
  return p.index != null ? '0x' + p.index.toString(16).toUpperCase() : '—'
}
function rawHex(p: DispatchParam): string {
  return typeof p.raw === 'number' ? '0x' + (p.raw & 0xffff).toString(16).toUpperCase().padStart(4, '0') : '—'
}
const OP_TAG: Record<DispatchOpType, 'danger' | 'primary' | 'warning' | 'info' | 'success' | ''> = {
  force: 'danger', writeAll: 'primary', import: 'warning', single: 'info', bitmap: 'success', resend: '',
}
const RESULT_TAG: Record<DispatchResult, 'success' | 'danger' | 'warning'> = {
  ok: 'success', fail: 'danger', verifyFail: 'warning',
}
/** 模板辅助（el-table 插槽 row 为 any，索引需走类型化函数） */
const opLabel = (r: DispatchRecord) => DISPATCH_OP_LABEL[r.opType]
const opTag = (r: DispatchRecord) => OP_TAG[r.opType]
const statusLabel = (r: DispatchRecord) => DISPATCH_STATUS_LABEL[r.status]
const resultTag = (p: DispatchParam) => (p.result ? RESULT_TAG[p.result] : 'success')
const resultLabel = (p: DispatchParam) => (p.result ? DISPATCH_RESULT_LABEL[p.result] : '成功')
function deviceText(r: DispatchRecord): string {
  const parts = [r.chipTypeName, r.sn ? `SN ${r.sn}` : '', r.swVersion ? `V${r.swVersion}` : '', r.portPath].filter(Boolean)
  return parts.join(' · ') || '—'
}

// ===== 删除 / 清空 =====
const selection = ref<DispatchRecord[]>([])
function onSelectionChange(rows: DispatchRecord[]) { selection.value = rows }
async function onRemove(id: string) {
  try {
    await ElMessageBox.confirm('删除这条记录？', '删除记录', { type: 'warning' })
  } catch { return }
  removeRecords([id])
  load()
}
async function onBatchRemove() {
  if (!selection.value.length) return
  const n = selection.value.length
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${n} 条记录吗？`, '批量删除', { type: 'warning' })
  } catch { return }
  removeRecords(selection.value.map((r) => r.id))
  ElMessage.success(`已删除 ${n} 条记录`)
  load()
}
async function onClearAll() {
  try {
    await ElMessageBox.confirm('确定清空全部下发记录吗？此操作不可恢复。', '清空记录', { type: 'warning' })
  } catch { return }
  clearDispatchRecords()
  load()
  ElMessage.success('已清空全部记录')
}
async function onClearOld() {
  try {
    await ElMessageBox.confirm('删除 30 天前的全部下发记录？', '清理旧记录', { type: 'warning' })
  } catch { return }
  const n = removeRecordsOlderThan(30)
  load()
  ElMessage[n ? 'success' : 'info'](n ? `已删除 ${n} 条 30 天前的记录` : '没有 30 天前的记录')
}

// ===== 导出 CSV（带 BOM，Excel 直接打开） =====
function csvEscape(v: unknown): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"'
}
function downloadCsv(rows: string[][], kind: string) {
  const csv = '\ufeff' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `下发记录_${kind}_${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function exportList() {
  const rows = [['时间', '操作类型', '状态', '成功', '失败', '校验不一致', '蓝牙名称', '参数项数', '设备']]
  for (const r of filtered.value) {
    rows.push([
      fmtTime(r.time), DISPATCH_OP_LABEL[r.opType], DISPATCH_STATUS_LABEL[r.status],
      String(r.okCount), String(r.failCount), String(r.verifyFailCount),
      r.btName, String(r.params.length), deviceText(r),
    ])
  }
  downloadCsv(rows, '列表')
  ElMessage.success(`已导出 ${filtered.value.length} 条记录`)
}
function exportDetail() {
  const rows = [['时间', '操作类型', '状态', '蓝牙名称', '参数名', '寄存器', '下发值', '原始值', '结果']]
  let n = 0
  for (const r of filtered.value) {
    for (const p of r.params) {
      rows.push([
        fmtTime(r.time), DISPATCH_OP_LABEL[r.opType], DISPATCH_STATUS_LABEL[r.status], r.btName,
        p.label, regHex(p), fmtValue(p.value), rawHex(p), p.result ? DISPATCH_RESULT_LABEL[p.result] : '成功',
      ])
      n++
    }
  }
  downloadCsv(rows, '明细')
  ElMessage.success(`已导出 ${n} 条参数明细`)
}

// ===== 在线对比当前设备 =====
const compareMaps = reactive<Record<string, Record<number, number>>>({})
const comparing = ref<string | null>(null)
/** 分段批量读（失败回退单读），返回 reg → raw */
async function batchReadRegs(regs: number[]): Promise<Record<number, number>> {
  const map: Record<number, number> = {}
  for (const ch of planReadChunks(regs)) {
    const batch = await readRegMap(ch.start, ch.count)
    if (batch) Object.assign(map, batch)
    else {
      for (let r = ch.start; r < ch.start + ch.count; r++) {
        const raw = await readRegRaw(r)
        if (raw !== null) map[r] = raw
      }
    }
  }
  return map
}
async function compareRecord(row: DispatchRecord) {
  if (!props.connected || comparing.value) return
  const regs = [...new Set(row.params.filter((p) => typeof p.index === 'number' && typeof p.raw === 'number').map((p) => p.index!))]
  if (!regs.length) { ElMessage.warning('该记录没有可对比的寄存器参数'); return }
  comparing.value = row.id
  try {
    compareMaps[row.id] = await batchReadRegs(regs)
    ElMessage.success('已读取设备当前值')
  } catch (e) {
    ElMessage.error('读取设备当前值失败: ' + (e as Error).message)
  } finally {
    comparing.value = null
  }
}
function currentValueOf(row: DispatchRecord, p: DispatchParam): { text: string; diff: boolean } | null {
  const map = compareMaps[row.id]
  if (!map || typeof p.index !== 'number' || typeof p.raw !== 'number') return null
  const cur = map[p.index]
  if (cur === undefined) return { text: '未读到', diff: true }
  return { text: '0x' + (cur & 0xffff).toString(16).toUpperCase().padStart(4, '0'), diff: (cur & 0xffff) !== (p.raw & 0xffff) }
}

// ===== 重新下发（原样重发该记录的参数，含回读校验，并留痕） =====
const resending = ref<string | null>(null)
function ctxOf(row: DispatchRecord) {
  return {
    chipTypeName: j.chipTypeName.value !== '—' ? j.chipTypeName.value : undefined,
    sn: row.sn,
    swVersion: j.basicInfo.value?.swVersion || undefined,
    portPath: ui.portPath || undefined,
  }
}
async function resendRecord(row: DispatchRecord) {
  if (!props.connected || resending.value) return
  const numeric = row.params.filter((p) => typeof p.index === 'number' && typeof p.raw === 'number')
  const nameParam = row.params.find((p) => p.index === 88 && typeof p.value === 'string' && p.value)
  if (!numeric.length && !nameParam) { ElMessage.warning('该记录没有可重发的参数'); return }
  try {
    await ElMessageBox.confirm(
      `将把该记录的 ${numeric.length} 个寄存器参数${nameParam ? '及蓝牙名称' : ''}原样重新下发到当前连接的设备。确定继续吗？`,
      '重新下发', { type: 'warning', confirmButtonText: '确定下发', cancelButtonText: '取消' },
    )
  } catch { return }
  resending.value = row.id
  const outParams: DispatchParam[] = []
  try {
    if (!(await enterFactory())) throw new Error('进入工厂模式失败')
    try {
      for (const p of numeric) {
        const raw = p.raw! & 0xffff
        const wrote = await writeRegs(p.index!, [(raw >> 8) & 0xff, raw & 0xff])
        outParams.push({ ...p, result: wrote ? 'ok' : 'fail' })
      }
      if (nameParam) {
        const resp = await jbdBus.sendAck(buildSetBtName(String(nameParam.value)))
        outParams.push({ ...nameParam, result: !resp.timeout && resp.status === 0x00 ? 'ok' : 'fail' })
      }
    } finally {
      await exitFactory()
    }
    // 批量回读校验（与参数页 verifyQueueBatch 同源策略：整字比对）
    if (numeric.length) {
      const regs = [...new Set(numeric.map((p) => p.index!))]
      const cur = await batchReadRegs(regs)
      for (const p of outParams) {
        if (typeof p.index !== 'number' || typeof p.raw !== 'number' || p.result !== 'ok') continue
        if (cur[p.index] === undefined || (cur[p.index] & 0xffff) !== (p.raw & 0xffff)) p.result = 'verifyFail'
      }
    }
  } catch (e) {
    ElMessage.error('重新下发失败: ' + (e as Error).message)
  } finally {
    resending.value = null
  }
  const rec = addDispatchRecord({ opType: 'resend', btName: row.btName, params: outParams, ...ctxOf(row) })
  load()
  const bad = rec.failCount + rec.verifyFailCount
  ElMessage[bad ? 'warning' : 'success'](`重新下发完成：${rec.okCount} 成功 / ${bad} 失败或校验不一致`)
}
</script>

<template>
  <div class="dispatch-log">
    <!-- 工具栏 -->
    <div class="dl-toolbar">
      <div class="dl-filters">
        <el-input v-model="keyword" clearable placeholder="搜索 蓝牙名称 / 参数名 / 值" size="small" style="width: 220px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="btNameFilter" clearable placeholder="蓝牙名称" size="small" style="width: 140px">
          <el-option v-for="n in btNameOptions" :key="n" :label="n" :value="n" />
        </el-select>
        <el-select v-model="opTypeFilter" clearable placeholder="操作类型" size="small" style="width: 120px">
          <el-option v-for="(label, v) in DISPATCH_OP_LABEL" :key="v" :label="label" :value="v" />
        </el-select>
        <el-select v-model="timeRange" size="small" style="width: 104px">
          <el-option label="全部时间" value="all" />
          <el-option label="今天" value="today" />
          <el-option label="近 3 天" value="3d" />
          <el-option label="近 7 天" value="7d" />
          <el-option label="近 30 天" value="30d" />
        </el-select>
      </div>
      <div class="dl-actions">
        <el-button size="small" @click="onRefresh"><el-icon><Refresh /></el-icon> 刷新</el-button>
        <el-dropdown @command="(cmd: string) => cmd === 'list' ? exportList() : exportDetail()">
          <el-button size="small">
            <el-icon><Download /></el-icon> 导出 CSV <el-icon class="el-icon--right"><Switch /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="list">导出列表（当前筛选）</el-dropdown-item>
              <el-dropdown-item command="detail">导出参数明细（当前筛选）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown @command="(cmd: string) => cmd === 'all' ? onClearAll() : onClearOld()">
          <el-button size="small" type="danger" plain :disabled="!records.length">
            <el-icon><Delete /></el-icon> 清理
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="old">清空 30 天前的记录</el-dropdown-item>
              <el-dropdown-item command="all" divided>清空全部记录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div v-if="selection.length" class="dl-batchbar">
      已选 {{ selection.length }} 条
      <el-button size="small" type="danger" @click="onBatchRemove">批量删除</el-button>
    </div>

    <div class="dl-meta">共 {{ filtered.length }} 条 / 库存 {{ records.length }} 条（本地保存，断电不丢失；重新下发需连接设备）</div>

    <div class="dl-table">
      <el-table
        :data="paged"
        stripe
        style="width: 100%"
        empty-text="暂无下发记录（任何参数下发操作都会自动记录到此）"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="dl-detail">
              <div class="dl-detail-head">
                <div class="dl-detail-title">下发参数（{{ row.params.length }} 项 · 成功 {{ row.okCount }} / 失败 {{ row.failCount }} / 校验不一致 {{ row.verifyFailCount }}）</div>
                <el-button
                  size="small"
                  :disabled="!connected"
                  :loading="comparing === row.id"
                  @click="compareRecord(row)"
                ><el-icon><Switch /></el-icon> {{ compareMaps[row.id] ? '重新对比' : '对比当前设备' }}</el-button>
              </div>
              <el-table :data="row.params" size="small" :border="false" max-height="340">
                <el-table-column prop="label" label="参数" min-width="170" />
                <el-table-column label="寄存器" width="86">
                  <template #default="{ row: p }">{{ regHex(p) }}</template>
                </el-table-column>
                <el-table-column label="下发值" min-width="140">
                  <template #default="{ row: p }">{{ fmtValue(p.value) }}</template>
                </el-table-column>
                <el-table-column label="原始值" width="86">
                  <template #default="{ row: p }">{{ rawHex(p) }}</template>
                </el-table-column>
                <el-table-column label="结果" width="92">
                  <template #default="{ row: p }">
                    <el-tag v-if="p.result" :type="resultTag(p)" size="small" effect="plain">
                      {{ resultLabel(p) }}
                    </el-tag>
                    <span v-else class="muted">成功</span>
                  </template>
                </el-table-column>
                <el-table-column v-if="compareMaps[row.id]" label="当前设备值" width="120">
                  <template #default="{ row: p }">
                    <span v-if="currentValueOf(row, p)" :class="{ 'dl-diff': currentValueOf(row, p)!.diff }">
                      {{ currentValueOf(row, p)!.text }}
                    </span>
                    <span v-else class="muted">—</span>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="compareMaps[row.id]" class="dl-compare-tip">当前设备值为寄存器原始值（HEX）；红色表示与下发值不一致</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column type="index" label="#" width="52" :index="globalIndex" />
        <el-table-column label="时间" min-width="152">
          <template #default="{ row }">{{ fmtTime(row.time) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="opTag(row)" size="small" effect="plain">{{ opLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <span :class="['dl-status', `dl-status--${row.status}`]">{{ statusLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="btName" label="蓝牙名称" min-width="130" show-overflow-tooltip />
        <el-table-column label="结果" width="110">
          <template #default="{ row }">
            <span class="num">
              <span class="dl-ok-n">{{ row.okCount }}</span>
              <span v-if="row.failCount" class="dl-bad-n"> / 失败{{ row.failCount }}</span>
              <span v-if="row.verifyFailCount" class="dl-warn-n"> / 校验{{ row.verifyFailCount }}</span>
              <span v-if="!row.failCount && !row.verifyFailCount" class="muted"> 全成功</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="设备" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ deviceText(row) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary" link size="small"
              :disabled="!connected && resending !== row.id"
              :loading="resending === row.id"
              @click="resendRecord(row)"
            >重新下发</el-button>
            <el-button type="danger" link size="small" @click="onRemove(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="filtered.length"
      :page-sizes="[20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      small
      background
      class="dl-pager"
    />
  </div>
</template>

<style scoped>
.dispatch-log {
  padding: var(--space-6);
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--text-primary);
  box-sizing: border-box;
  overflow-y: auto;
}
.dl-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.dl-filters { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.dl-actions { display: flex; gap: var(--space-2); }

.dl-batchbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  background: var(--brand-bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
.dl-meta { color: var(--text-tertiary); font-size: var(--fs-caption); }

.dl-table {
  flex: 1;
  min-height: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}

.dl-detail { padding: var(--space-2) var(--space-4); }
.dl-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}
.dl-detail-title { font-size: var(--fs-caption); color: var(--text-secondary); }
.dl-compare-tip { margin-top: var(--space-2); font-size: var(--fs-micro); color: var(--text-tertiary); }

/* 状态徽标（复用语义色板） */
.dl-status { font-size: var(--fs-caption); font-weight: 600; }
.dl-status--ok { color: var(--ok); }
.dl-status--partial { color: var(--warning); }
.dl-status--fail { color: var(--critical); }

.dl-ok-n { color: var(--ok); font-weight: 600; }
.dl-bad-n { color: var(--critical); }
.dl-warn-n { color: var(--warning); }
.dl-diff { color: var(--critical); font-weight: 700; }
.muted { color: var(--text-tertiary); }
.num { font-variant-numeric: tabular-nums; }

.dl-pager { justify-content: flex-end; }
</style>
