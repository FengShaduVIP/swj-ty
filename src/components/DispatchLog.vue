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
  load()
}
</script>

<template>
  <div class="dispatch-log">
    <div class="dl-toolbar">
      <div class="dl-title">强制下发记录</div>
      <div class="dl-actions">
        <el-input
          v-model="keyword"
          placeholder="搜索 蓝牙名称 / 参数名 / 值"
          clearable
          size="default"
          style="width: 260px"
        />
        <el-button @click="onRefresh">刷新</el-button>
        <el-button type="danger" plain :disabled="!records.length" @click="onClear">
          清空记录
        </el-button>
      </div>
    </div>
    <div class="dl-meta">共 {{ records.length }} 条记录（本地保存，断电不丢失）</div>

    <el-table
      :data="filtered"
      stripe
      style="width: 100%"
      empty-text="暂无下发记录（点击「参数配置 → 强制下发」后自动生成）"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="dl-detail">
            <div class="dl-detail-title">下发参数（{{ row.params.length }} 项）</div>
            <el-table :data="row.params" size="small" :border="false" max-height="340">
              <el-table-column prop="label" label="参数" min-width="180" />
              <el-table-column label="寄存器" width="96">
                <template #default="{ row: p }">{{ regHex(p) }}</template>
              </el-table-column>
              <el-table-column label="下发值" min-width="160">
                <template #default="{ row: p }">{{ fmtValue(p.value) }}</template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-table-column>

      <el-table-column type="index" label="#" width="48" />
      <el-table-column label="时间" min-width="170">
        <template #default="{ row }">{{ fmtTime(row.time) }}</template>
      </el-table-column>
      <el-table-column prop="btName" label="蓝牙名称" min-width="150" show-overflow-tooltip />
      <el-table-column label="参数项数" width="100" align="center">
        <template #default="{ row }">{{ row.params.length }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button type="danger" link size="small" @click="onRemove(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.dispatch-log {
  padding: 16px 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.dl-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.dl-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.dl-actions {
  display: flex;
  gap: 8px;
}
.dl-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 8px 0 6px;
}
.dl-detail {
  padding: 6px 14px 10px;
}
.dl-detail-title {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
</style>
