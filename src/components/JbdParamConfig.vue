<template>
  <div class="param-config">
    <!-- 顶部操作栏 -->
    <el-card class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><Setting /></el-icon> JBD 参数配置</span>
        <div class="header-actions">
          <el-tag v-if="inFactory" type="success" size="small">工厂模式</el-tag>
          <el-button size="small" :disabled="!connected" :loading="busy" @click="readAll"><el-icon><Refresh /></el-icon> 读取全部</el-button>
          <el-button size="small" type="primary" :disabled="!connected || !dirtyCount" :loading="busy" @click="writeAll"><el-icon><Upload /></el-icon> 全部写入({{ dirtyCount }})</el-button>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept=".json,application/json"
            :on-change="onFileChange"
            style="display: inline-flex"
          >
            <el-button size="small"><el-icon><FolderOpened /></el-icon> 导入配置</el-button>
          </el-upload>
          <el-button size="small" @click="exportConfig"><el-icon><Download /></el-icon> 导出配置</el-button>
        </div>
      </template>
      <div class="tip">按分组读取/写入 0xFA 参数寄存器；点击每行右侧「读」或「写」可单独操作。写参数时程序会自动进入→写入→退出工厂模式，无需手动操作。</div>
    </el-card>

    <div v-if="busy" class="progress-bar"><el-progress :percentage="progress" :stroke-width="4" color="#00BFA5" /></div>

    <!-- 导入配置预览 -->
    <el-card v-if="importedParams.length" class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><Files /></el-icon> 已导入配置预览（{{ importedParams.length }} 项）</span>
        <div class="header-actions">
          <el-button size="small" type="primary" :disabled="!connected || busy" :loading="busy" @click="sendAllImported">
            <el-icon><Promotion /></el-icon> 一键下发所有参数
          </el-button>
          <el-button size="small" text :disabled="busy" @click="clearImport">清除</el-button>
        </div>
      </template>
      <div class="tip">以下为配置文件解析出的参数（中文文件名亦可），核对无误后点击「一键下发所有参数」批量写入目标设备，下发结果将在此处实时反馈。</div>
      <div class="import-table">
        <div class="import-row import-head">
          <span class="c-idx">寄存器</span>
          <span class="c-label">参数名</span>
          <span class="c-value">下发值</span>
          <span class="c-current">当前值</span>
          <span class="c-raw">原始值(HEX)</span>
          <span class="c-status">状态</span>
        </div>
        <div v-for="(p, i) in importedParams" :key="i" class="import-row" :class="p.status">
          <span class="c-idx">[{{ p.index }}]</span>
          <span class="c-label">{{ p.label }}</span>
          <span class="c-value">{{ p.value }} {{ p.unit }}</span>
          <span class="c-current">{{ currentParamValue(p) }}</span>
          <span class="c-raw">0x{{ p.raw.toString(16).padStart(4, '0').toUpperCase() }}</span>
          <span class="c-status">
            <span v-if="p.status === 'ok'" class="dot ok" />
            <span v-else-if="p.status === 'fail'" class="dot fail" />
            <span v-else class="muted">待下发</span>
          </span>
        </div>
      </div>
    </el-card>

    <!-- 分组表单 -->
    <div class="groups">
      <el-card v-for="g in groups" :key="g.title" class="sec group-card" shadow="never">
        <template #header>
          <span class="group-title">{{ g.title }}</span>
          <el-button size="small" text :disabled="!connected" @click="readGroup(g)"><el-icon><Refresh /></el-icon> 读本组</el-button>
        </template>
        <div class="field-grid">
          <div v-for="f in g.fields" :key="f.index" class="field" :class="f.status">
            <div class="field-label">
              <span>{{ f.label }}</span>
              <el-tag v-if="f.note" type="info" size="small">{{ f.note }}</el-tag>
            </div>
            <div class="field-row">
              <el-input-number
                v-model="f.value"
                :disabled="f.status === 'reading'"
                :precision="f.decimals"
                :step="f.step ?? 1"
                :min="f.min"
                :max="f.max"
                size="small"
                controls-position="right"
                style="flex: 1"
                @change="f.dirty = true"
              />
              <span class="unit">{{ f.unit }}</span>
              <el-button size="small" text :loading="f.status === 'reading'" :disabled="!connected" @click="readField(f)">读</el-button>
              <el-button size="small" type="primary" text :loading="f.status === 'writing'" :disabled="!connected || f.value === null" @click="writeField(f)">下发</el-button>
              <span v-if="f.status === 'ok'" class="dot ok" />
              <span v-else-if="f.status === 'fail'" class="dot fail" title="失败/超时" />
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting, Refresh, Upload, FolderOpened, Download, Files, Promotion } from '@element-plus/icons-vue'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildReadParam, buildWriteParam,
  buildEnterFactory, buildExitFactory,
} from '@/jbd/jbd-protocol'
import { paramRawToDisplay, paramDisplayToRaw } from '@/jbd/jbd-params'

type FieldStatus = 'idle' | 'reading' | 'writing' | 'ok' | 'fail'

interface FieldDef {
  label: string
  index: number
  unit: string
  decimals: number
  step?: number
  min?: number
  max?: number
  note?: string
}

interface FieldState extends FieldDef {
  value: number | null
  dirty: boolean
  status: FieldStatus
}

const props = defineProps<{ connected: boolean }>()

// ===== 导入配置预览 =====
type ImportStatus = 'ok' | 'fail' | undefined
interface ImportedParam {
  index: number
  label: string
  unit: string
  value: number
  raw: number
  status?: ImportStatus
}
const importedParams = ref<ImportedParam[]>([])

function fieldByIndex(index: number): FieldState | undefined {
  return allFields.value.find((f) => f.index === index)
}

const autoFactory = ref(true)
const inFactory = ref(false)
const busy = ref(false)
const progress = ref(0)

function makeField(def: FieldDef): FieldState {
  return { ...def, value: null, dirty: false, status: 'idle' }
}

const GROUP_DEFS: { title: string; fields: FieldDef[] }[] = [
  {
    title: '容量/均衡配置',
    fields: [
      { label: '标称容量', index: 0, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '循环容量', index: 1, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '均衡开启电压', index: 26, unit: 'mV', decimals: 0 },
      { label: '均衡开启压差', index: 27, unit: 'mV', decimals: 0 },
      { label: '短路释放延时', index: 43, unit: 'S', decimals: 0 },
      { label: '短路保护设置', index: 41, unit: '', decimals: 0, note: '见IC' },
      { label: '硬件过欠压延时', index: 42, unit: '', decimals: 0, note: '见IC' },
      { label: '二级过流保护设置', index: 40, unit: '', decimals: 0, note: '见IC' },
      { label: '检流电阻值', index: 28, unit: 'mΩ', decimals: 2, step: 0.1 },
    ],
  },
  {
    title: '过压/欠压参数',
    fields: [
      { label: '单体过压保护值', index: 20, unit: 'mV', decimals: 0 },
      { label: '单体过压释放值', index: 21, unit: 'mV', decimals: 0 },
      { label: '单体过压延时', index: 51, unit: 'S', decimals: 0 },
      { label: '单体欠压保护值', index: 22, unit: 'mV', decimals: 0 },
      { label: '单体欠压释放值', index: 23, unit: 'mV', decimals: 0 },
      { label: '单体欠压延时', index: 50, unit: 'S', decimals: 0 },
      { label: '总压过压保护值', index: 16, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总压过压释放值', index: 17, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总压高压延时', index: 49, unit: 'S', decimals: 0 },
      { label: '总压低压保护值', index: 18, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总压低压释放值', index: 19, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总压低压延时', index: 48, unit: 'S', decimals: 0 },
    ],
  },
  {
    title: '高温/低温参数',
    fields: [
      { label: '充电高温保护值', index: 8, unit: '℃', decimals: 1 },
      { label: '充电高温释放值', index: 9, unit: '℃', decimals: 1 },
      { label: '充电高温延时', index: 45, unit: 'S', decimals: 0 },
      { label: '充电低温保护值', index: 10, unit: '℃', decimals: 1 },
      { label: '充电低温释放值', index: 11, unit: '℃', decimals: 1 },
      { label: '充电低温延时', index: 44, unit: 'S', decimals: 0 },
      { label: '放电高温保护值', index: 12, unit: '℃', decimals: 1 },
      { label: '放电高温释放值', index: 13, unit: '℃', decimals: 1 },
      { label: '放电高温延时', index: 47, unit: 'S', decimals: 0 },
      { label: '放电低温保护值', index: 14, unit: '℃', decimals: 1 },
      { label: '放电低温释放值', index: 15, unit: '℃', decimals: 1 },
      { label: '放电低温延时', index: 46, unit: 'S', decimals: 0 },
    ],
  },
  {
    title: '过流参数',
    fields: [
      { label: '充电过流保护值', index: 24, unit: 'mA', decimals: 0, step: 10 },
      { label: '充电过流延时', index: 52, unit: 'S', decimals: 0 },
      { label: '充电过流释放延时', index: 53, unit: 'S', decimals: 0 },
      { label: '放电过流保护值', index: 25, unit: 'mA', decimals: 0, step: 10 },
      { label: '放电过流延时', index: 54, unit: 'S', decimals: 0 },
      { label: '放电过流释放延时', index: 55, unit: 'S', decimals: 0 },
    ],
  },
]

const groups = ref(GROUP_DEFS.map((g) => ({ title: g.title, fields: g.fields.map(makeField) })))
const allFields = computed(() => groups.value.flatMap((g) => g.fields))
const dirtyCount = computed(() => allFields.value.filter((f) => f.dirty).length)

async function enterFactory(): Promise<boolean> {
  jbdBus.send(buildEnterFactory())
  const r = await jbdBus.onceResponse(1500, 0x00)
  if (r.timeout || r.status !== 0x00) {
    ElMessage.error('进入工厂模式失败: ' + (r.timeout ? '超时' : `0x${r.status.toString(16)}`))
    return false
  }
  inFactory.value = true
  return true
}
async function exitFactory(): Promise<boolean> {
  jbdBus.send(buildExitFactory())
  const r = await jbdBus.onceResponse(1500, 0x01)
  if (r.timeout || r.status !== 0x00) {
    ElMessage.error('退出工厂模式失败: ' + (r.timeout ? '超时' : `0x${r.status.toString(16)}`))
    return false
  }
  inFactory.value = false
  return true
}
function parseParamResponse(resp: any): number | null {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return null
  if (resp.data.length < 5) return null
  const reg = (resp.data[0] << 8) | resp.data[1]
  const count = resp.data[2]
  if (count < 1 || resp.data.length < 5 + (count - 1) * 2) return null
  const raw = ((resp.data[3] << 8) | resp.data[4]) & 0xffff
  return raw
}

async function readField(f: FieldState): Promise<boolean> {
  if (!props.connected) return false
  f.status = 'reading'
  jbdBus.send(buildReadParam(f.index, 1))
  const resp = await jbdBus.onceResponse(1500, 0xfa)
  const raw = parseParamResponse(resp)
  if (raw === null) {
    f.status = 'fail'
    return false
  }
  f.value = paramRawToDisplay(f.index, raw)
  f.dirty = false
  f.status = 'ok'
  return true
}

async function writeField(f: FieldState): Promise<boolean> {
  if (!props.connected || f.value === null) return false
  f.status = 'writing'
  if (autoFactory.value && !inFactory.value) {
    const ok = await enterFactory()
    if (!ok) { f.status = 'fail'; return false }
  }
  const raw = paramDisplayToRaw(f.index, f.value)
  jbdBus.send(buildWriteParam(f.index, [(raw >> 8) & 0xff, raw & 0xff]))
  const resp = await jbdBus.onceResponse(1500, 0xfa)
  if (!resp || resp.timeout || resp.status !== 0x00) {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    return false
  }
  f.status = 'ok'
  f.dirty = false
  if (autoFactory.value) await exitFactory()
  return true
}

async function readGroup(g: { title: string; fields: FieldState[] }) {
  if (!props.connected) return
  busy.value = true
  let ok = 0, fail = 0
  for (const f of g.fields) {
    const r = await readField(f)
    if (r) ok++; else fail++
  }
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`本组读取完成：${ok} 成功，${fail} 失败`)
}

async function readAll() {
  if (!props.connected) return
  busy.value = true
  const fields = allFields.value
  let ok = 0, fail = 0
  for (let i = 0; i < fields.length; i++) {
    progress.value = Math.round(((i) / fields.length) * 100)
    const r = await readField(fields[i])
    if (r) ok++; else fail++
  }
  progress.value = 100
  busy.value = false
  if (fail) {
    ElMessage.warning(`全部读取完成：${ok} 成功，${fail} 失败`)
  } else {
    ElMessage.success('全部读取成功')
  }
}

async function writeAll() {
  if (!props.connected || !dirtyCount.value) return
  const dirty = allFields.value.filter((f) => f.dirty)
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  for (let i = 0; i < dirty.length; i++) {
    progress.value = Math.round(((i) / dirty.length) * 100)
    dirty[i].status = 'writing'
    const raw = paramDisplayToRaw(dirty[i].index, dirty[i].value!)
    jbdBus.send(buildWriteParam(dirty[i].index, [(raw >> 8) & 0xff, raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) {
      dirty[i].status = 'fail'
      fail++
      ElMessage.error(`写参数[${dirty[i].label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    } else {
      dirty[i].status = 'ok'
      dirty[i].dirty = false
      ok++
    }
  }
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`全部写入完成：${ok} 成功，${fail} 失败`)
}

// ===== 配置文件导入 / 导出 =====
function onFileChange(uploadFile: any) {
  const file = uploadFile?.raw as File | undefined
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const text = reader.result as string
      const data = JSON.parse(text)
      applyImport(data)
    } catch (e: any) {
      ElMessage.error('解析失败：' + (e?.message || '文件格式错误'))
    }
  }
  reader.onerror = () => ElMessage.error('文件读取失败')
  reader.readAsText(file, 'UTF-8')
}

function applyImport(data: any) {
  const rawList: any[] = Array.isArray(data) ? data : (data?.params ?? [])
  if (!Array.isArray(rawList)) {
    ElMessage.error('配置文件格式不支持（需为 JBD 参数 JSON）')
    return
  }
  const out: ImportedParam[] = []
  for (const item of rawList) {
    const index = Number(item?.index ?? item?.reg)
    const raw = Number(item?.raw ?? item?.value)
    if (!Number.isInteger(index) || index < 0 || index > 65535) continue
    if (!Number.isFinite(raw)) continue
    const r = ((Math.trunc(raw) & 0xffff) >>> 0) & 0xffff
    const def = fieldByIndex(index)
    const display = def ? paramRawToDisplay(index, r) : r
    out.push({
      index,
      label: item?.label || def?.label || `寄存器[${index}]`,
      unit: item?.unit || def?.unit || '',
      value: display,
      raw: r,
    })
  }
  if (!out.length) {
    ElMessage.error('未找到有效参数（请检查文件内容）')
    return
  }
  importedParams.value = out
  // 将已知字段同步到表单并标记为已修改
  for (const p of out) {
    const f = fieldByIndex(p.index)
    if (f) {
      f.value = p.value
      f.dirty = true
      f.status = 'idle'
    }
  }
  ElMessage.success(`已导入 ${out.length} 个参数，可在预览中核对后下发`)
}

function clearImport() {
  importedParams.value = []
}

function currentParamValue(p: ImportedParam): string {
  const f = fieldByIndex(p.index)
  if (!f || f.value === null) return '—'
  return `${f.value} ${f.unit}`
}

async function sendAllImported() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (!importedParams.value.length) return
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  const list = importedParams.value
  for (let i = 0; i < list.length; i++) {
    progress.value = Math.round((i / list.length) * 100)
    const p = list[i]
    jbdBus.send(buildWriteParam(p.index, [(p.raw >> 8) & 0xff, p.raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) {
      fail++
      p.status = 'fail'
      ElMessage.error(`写参数[${p.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    } else {
      ok++
      p.status = 'ok'
      const f = fieldByIndex(p.index)
      if (f) { f.status = 'ok'; f.dirty = false }
    }
  }
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`一键下发完成：${ok} 成功，${fail} 失败`)
}

function exportConfig() {
  const params = allFields.value
    .filter((f) => f.value !== null)
    .map((f) => ({
      index: f.index,
      label: f.label,
      unit: f.unit,
      value: f.value,
      raw: paramDisplayToRaw(f.index, f.value!),
    }))
  if (!params.length) {
    ElMessage.warning('当前没有可导出的参数（请先读取或填写）')
    return
  }
  const data = {
    type: 'jbd-param-config',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    params,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `JBD参数配置_${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${params.length} 个参数`)
}
</script>

<style scoped>
.param-config {
  padding: 16px;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.param-config > * { min-width: 0; }
.sec { background: #1a1e24; border: 1px solid #2a2e34; }
.sec :deep(.el-card__header) {
  padding: 10px 14px;
  border-bottom: 1px solid #2a2e34;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sec-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #f0f1f2; }
.sec-title .el-icon { color: #00BFA5; }
.header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tip { font-size: 12px; color: #6a6e74; }
.progress-bar { padding: 0 14px; }
.groups { display: flex; flex-direction: column; gap: 12px; }
.group-title { font-size: 14px; font-weight: 600; color: #f0f1f2; }
.field-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
@media (max-width: 1100px) {
  .field-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 700px) {
  .field-grid { grid-template-columns: 1fr; }
}
.field {
  background: #0c0e10;
  border: 1px solid #2a2e34;
  border-radius: 6px;
  padding: 8px 10px;
}
.field.ok { border-left: 3px solid #67C23A; }
.field.fail { border-left: 3px solid #F56C6C; }
.field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #b0b4ba;
  margin-bottom: 6px;
}
.field-label .reg { margin-left: auto; color: #6a6e74; font-family: monospace; }
.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-row .unit {
  font-size: 12px;
  color: #8a8e94;
  min-width: 28px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot.ok { background: #67C23A; }
.dot.fail { background: #F56C6C; }
.import-table { margin-top: 10px; border: 1px solid #2a2e34; border-radius: 6px; overflow: hidden; }
.import-row {
  display: grid;
  grid-template-columns: 80px 1.4fr 1.2fr 1.2fr 130px 80px;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  border-bottom: 1px solid #1a1e24;
  align-items: center;
}
.import-row:last-child { border-bottom: none; }
.import-head {
  background: #161a1f;
  color: #8a8e94;
  font-size: 12px;
}
.import-row.ok .c-status { color: #67C23A; }
.import-row.fail .c-status { color: #F56C6C; }
.import-row .c-raw { font-family: 'JetBrains Mono', monospace; color: #b0b4ba; }
.import-row .c-label { color: #f0f1f2; }
.import-row .c-value { color: #00BFA5; }
.import-row .muted { color: #6a6e74; }
</style>
