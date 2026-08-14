<template>
  <div class="tpc">
    <div class="tpc-head">
      <div class="tpc-title">天一 BMS 参数下发</div>
      <div class="tpc-actions">
        <span class="tpc-proto">Modbus-RTU · 从机 0x{{ slaveHex }}</span>
        <button class="btn" :disabled="!connected || reading" @click="loadGroup(activeTab)">
          {{ reading ? '读取中…' : '读取当前' }}
        </button>
        <button class="btn btn-primary" :disabled="!connected || writing || dirtyCount(activeTab) === 0" @click="writeAll">
          写入全部已修改 ({{ dirtyCount(activeTab) }})
        </button>
        <button class="btn" @click="fileInput?.click()">导入</button>
        <button class="btn" @click="exportConfig">导出</button>
        <button class="btn" @click="saveAsTemplate">存为模板</button>
        <button class="btn" @click="openTemplateDialog">模板</button>
        <input ref="fileInput" type="file" accept="application/json,.json" style="display:none" @change="onImportFile" />
      </div>
    </div>

    <div v-if="!connected" class="tpc-offline">
      未连接串口：参数表已可浏览与编辑，导入 / 模板可离线准备；「读取当前 / 写入」需先建立连接。
    </div>

    <div class="tpc-tabs">
      <button
        v-for="g in GROUP_META"
        :key="g.key"
        class="tpc-tab"
        :class="{ active: activeTab === g.key }"
        :title="g.hint"
        @click="activeTab = g.key"
      >
        {{ g.title }}
      </button>
    </div>

    <div class="tpc-body">
      <!-- 控制页（写专用） -->
      <div v-if="activeTab === 'control'" class="ctrl-grid">
        <div v-for="def in paramsOf('control')" :key="def.reg" class="ctrl-card">
          <div class="ctrl-name">{{ def.label }}</div>
          <div class="ctrl-reg num">0x{{ def.reg.toString(16).toUpperCase() }}</div>
          <div class="ctrl-hint">{{ def.hint }}</div>
          <button class="btn btn-danger" :disabled="!connected || writing" @click="writeControl(def)">执行（写 0x0001）</button>
        </div>
      </div>

      <!-- 参数表 -->
      <div v-else class="param-table">
        <div class="pt-head">
          <span class="c-name">参数</span>
          <span class="c-var">变量</span>
          <span class="c-cur">当前值</span>
          <span class="c-edit">修改值</span>
          <span class="c-unit">单位</span>
          <span class="c-range">范围 / 说明</span>
          <span class="c-op">操作</span>
        </div>
        <div
          v-for="def in paramsOf(activeTab)"
          :key="def.reg"
          class="pt-row"
          :class="{ dirty: isDirty(def) }"
        >
          <span class="c-name">{{ def.label }}</span>
          <span class="c-var num">{{ def.name }}</span>
          <span class="c-cur num">{{ curDisplay(def) }}</span>
          <span class="c-edit">
            <el-select
              v-if="def.options"
              v-model="editMap[def.reg]"
              size="small"
              class="cell-select"
            >
              <el-option
                v-for="o in def.options"
                :key="o.value"
                :label="o.label"
                :value="String(o.value)"
              />
            </el-select>
            <input
              v-else
              class="cell-input num"
              v-model="editMap[def.reg]"
              :placeholder="curDisplay(def)"
            />
          </span>
          <span class="c-unit">{{ def.unit || '' }}</span>
          <span class="c-range">
            {{ rangeText(def) }}<span v-if="def.hint" class="ph"> · {{ def.hint }}</span>
          </span>
          <span class="c-op">
            <button class="btn btn-sm" :disabled="!isDirty(def) || writing || !connected" @click="writeOne(def)">写入</button>
          </span>
        </div>
      </div>
    </div>

    <!-- 本地模板对话框 -->
    <el-dialog v-model="templateDialogVisible" title="参数模板" width="560px">
      <div class="tip">选择本地已保存的模板可直接导入，无需再次选择文件；也可从文件导入，或先「存为模板」保存当前配置。</div>
      <div class="tpl-actions">
        <button class="btn" @click="fileInput?.click()">从文件导入</button>
        <span class="tpl-count">共 {{ templates.length }} 个模板</span>
      </div>
      <div v-if="!templates.length" class="tpl-empty">
        暂无模板，点击「从文件导入」或先「存为模板」保存当前配置。
      </div>
      <div v-for="t in templates" :key="t.id" class="tpl-item">
        <div class="tpl-meta">
          <span class="tpl-name">{{ t.name }}</span>
          <span class="tpl-time">{{ fmtTime(t.updatedAt) }}</span>
        </div>
        <div class="tpl-btns">
          <button class="btn btn-sm" @click="importFromTemplate(t)">导入</button>
          <button class="btn btn-sm" @click="renameTemplate(t)">重命名</button>
          <button class="btn btn-sm btn-ghost" @click="deleteTemplate(t)">删除</button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PARAM_DEFS, GROUP_READ, GROUP_META, paramsOf,
  rawToDisplay, displayToRaw, formatDisplay,
  type TianyiParamDef, type TianyiGroup,
} from '../tianyi/tianyi-params'
import { tianyiBus } from '../tianyi/tianyi-bus'
import { buildReadHoldingRegisters, buildWriteSingleRegister, readU16, type ModbusFrame } from '../tianyi/tianyi-protocol'
import { ui } from '../store'

const props = defineProps<{ connected: boolean }>()

const slave = computed(() => ui.slaveAddr)
const slaveHex = computed(() => slave.value.toString(16).padStart(2, '0').toUpperCase())

const activeTab = ref<TianyiGroup>('config')
const rawMap = reactive<Record<number, number>>({})
const editMap = reactive<Record<number, string>>({})
const reading = ref(false)
const writing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function curDisplay(def: TianyiParamDef): string {
  const raw = rawMap[def.reg]
  return raw === undefined ? '--' : formatDisplay(def, raw)
}

function isDirty(def: TianyiParamDef): boolean {
  const edited = editMap[def.reg]
  if (edited === undefined || edited === '') return false
  const raw = rawMap[def.reg]
  // 未读取（离线）但已填写 → 视为待写
  if (raw === undefined) return true
  return edited !== formatDisplay(def, raw)
}

function dirtyCount(group: TianyiGroup): number {
  return paramsOf(group).filter((d) => isDirty(d)).length
}

function rangeText(def: TianyiParamDef): string {
  if (def.options) return '枚举'
  if (def.min !== undefined && def.max !== undefined) return `${def.min}–${def.max}`
  return '0–65535'
}

// ===== 读取整组 =====
async function loadGroup(group: TianyiGroup) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (group === 'control') return // 控制区只读专用，无需读取
  const range = GROUP_READ[group]
  if (!range) return
  reading.value = true
  try {
    const frame = await tianyiBus.sendAck(buildReadHoldingRegisters(slave.value, range.start, range.count))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`读取失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
      return
    }
    const defs = paramsOf(group)
    for (const def of defs) {
      const idx = def.reg - range.start
      if (idx < 0) continue
      const byteOff = idx * 2
      if (byteOff + 1 >= frame.data.length) continue
      const raw = readU16(frame.data, byteOff)
      rawMap[def.reg] = raw
      editMap[def.reg] = formatDisplay(def, raw)
    }
    ElMessage.success(`已读取 ${group} 区 ${defs.length} 项`)
  } catch (e: any) {
    ElMessage.error('读取异常：' + (e?.message || e))
  } finally {
    reading.value = false
  }
}

// ===== 单条写入 =====
async function writeOne(def: TianyiParamDef) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  const key = def.reg
  const raw = rawMap[key]
  if (raw === undefined) { ElMessage.warning('请先读取当前值'); return }

  let value: number
  if (def.options) {
    value = parseInt(editMap[key], 10)
    if (!Number.isFinite(value)) { ElMessage.error(`${def.label}：取值无效`); return }
  } else {
    const v = parseFloat(editMap[key])
    if (!Number.isFinite(v)) { ElMessage.error(`${def.label}：请输入有效数字`); return }
    if (def.min !== undefined && v < def.min) { ElMessage.error(`${def.label}：低于最小值 ${def.min}`); return }
    if (def.max !== undefined && v > def.max) { ElMessage.error(`${def.label}：超出最大值 ${def.max}`); return }
    value = displayToRaw(def, v)
  }

  // 保护 / 校准为高风险区，写前二次确认
  if (def.group === 'protect' || def.group === 'calib') {
    try {
      await ElMessageBox.confirm(
        `确认将「${def.label}」(${def.name}) 写入为 ${def.options ? editMap[key] : editMap[key] + (def.unit ? ' ' + def.unit : '')}？`,
        '写参数确认',
        { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消' },
      )
    } catch {
      return // 用户取消
    }
  }

  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`写入失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
      return
    }
    rawMap[key] = value
    editMap[key] = formatDisplay(def, value)
    ElMessage.success(`已写入 ${def.label}`)
  } catch (e: any) {
    ElMessage.error('写入异常：' + (e?.message || e))
  } finally {
    writing.value = false
  }
}

// ===== 批量写入当前页已修改 =====
async function writeAll() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  const defs = paramsOf(activeTab.value).filter((d) => isDirty(d))
  if (!defs.length) return
  writing.value = true
  let ok = 0
  let fail = 0
  for (const def of defs) {
    const key = def.reg
    let value: number
    if (def.options) {
      value = parseInt(editMap[key], 10)
    } else {
      const v = parseFloat(editMap[key])
      if (!Number.isFinite(v) || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) {
        fail++; continue
      }
      value = displayToRaw(def, v)
    }
    try {
      const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
      if (frame.timeout || frame.exception) { fail++; continue }
      rawMap[key] = value
      editMap[key] = formatDisplay(def, value)
      ok++
    } catch {
      fail++
    }
  }
  writing.value = false
  if (fail === 0) ElMessage.success(`已写入全部 ${ok} 项`)
  else ElMessage.warning(`完成：成功 ${ok} / 失败 ${fail}`)
}

// ===== 控制类写专用（RESET / RECOVERY）=====
async function writeControl(def: TianyiParamDef) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  try {
    await ElMessageBox.confirm(
      `确认执行「${def.label}」？${def.hint || ''}`,
      '控制指令确认',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, 0x0001))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`执行失败：${frame.timeout ? '超时无响应' : '设备异常应答'}`)
      return
    }
    ElMessage.success(`已执行 ${def.label}`)
  } catch (e: any) {
    ElMessage.error('执行异常：' + (e?.message || e))
  } finally {
    writing.value = false
  }
}

// ===== 导出配置（JSON）=====
function buildExportData() {
  const params: any[] = []
  for (const def of PARAM_DEFS) {
    if (def.group === 'control') continue
    const edit = editMap[def.reg]
    const raw = rawMap[def.reg]
    let display: number
    let rawVal: number
    if (edit !== undefined && edit !== '') {
      const v = parseFloat(edit)
      if (!Number.isFinite(v)) continue
      display = v
      rawVal = displayToRaw(def, v)
    } else if (raw !== undefined) {
      display = rawToDisplay(def, raw)
      rawVal = raw
    } else {
      continue // 既无编辑也无读取，跳过
    }
    params.push({
      reg: def.reg,
      name: def.name,
      label: def.label,
      unit: def.unit || '',
      value: Number(display.toFixed(def.decimals ?? 0)),
      raw: rawVal & 0xffff,
    })
  }
  return {
    type: 'tianyi-param-config',
    version: '1.0',
    protocol: 'TIANYI',
    slave: slave.value,
    exportedAt: new Date().toISOString(),
    params,
  }
}

function exportConfig() {
  const data = buildExportData()
  if (!data.params.length) { ElMessage.warning('当前没有可导出的参数（请先读取或填写）'); return }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `天一参数配置_${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${data.params.length} 个参数`)
}

// ===== 导入配置（JSON 文件）→ 回填修改值列（离线可用）=====
function onImportFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result))
      applyImport(data)
    } catch (err: any) {
      ElMessage.error('导入失败：' + (err?.message || '文件解析错误'))
    } finally {
      target.value = ''
    }
  }
  reader.readAsText(file)
}

function applyImport(data: any) {
  const rawList: any[] = Array.isArray(data) ? data : (data?.params ?? [])
  if (!Array.isArray(rawList)) { ElMessage.error('配置文件格式不支持（需为天一参数 JSON）'); return }
  let n = 0
  for (const item of rawList) {
    const reg = Number(item?.reg ?? item?.index)
    if (!Number.isInteger(reg) || reg < 0 || reg > 0xffff) continue
    const def = PARAM_DEFS.find((d) => d.reg === reg && d.group !== 'control')
    if (!def) continue
    let rawVal: number
    if (item?.raw !== undefined && Number.isFinite(Number(item.raw))) rawVal = Number(item.raw) & 0xffff
    else if (item?.value !== undefined && Number.isFinite(Number(item.value))) rawVal = displayToRaw(def, Number(item.value))
    else continue
    // 仅回填修改值列，不写 rawMap，使离线导入项标记为待写（dirty）
    editMap[reg] = formatDisplay(def, rawVal)
    n++
  }
  if (!n) { ElMessage.error('未找到有效参数（请检查文件内容）'); return }
  ElMessage.success(`已导入 ${n} 个参数（已在修改值列标红，连接后可下发）`)
}

// ===== 本地模板（localStorage，参照 JBD 参数配置页范式）=====
interface ConfigTemplate {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  data: any
}
const TEMPLATE_KEY = 'tianyi-param-templates'
const templateDialogVisible = ref(false)
const templates = ref<ConfigTemplate[]>([])

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    templates.value = raw ? JSON.parse(raw) : []
    if (!Array.isArray(templates.value)) templates.value = []
  } catch {
    templates.value = []
  }
}
function persistTemplates() {
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates.value)) } catch { /* 忽略写入失败 */ }
}
function genId(): string {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return iso }
}

function openTemplateDialog() {
  loadTemplates()
  templateDialogVisible.value = true
}

async function saveAsTemplate() {
  const data = buildExportData()
  if (!data.params.length) { ElMessage.warning('当前没有可保存的参数（请先读取或填写）'); return }
  try {
    const { value } = await ElMessageBox.prompt('请输入模板名称', '保存为模板', {
      inputValue: `模板 ${templates.value.length + 1}`,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    const name = (value || '').trim() || `模板 ${templates.value.length + 1}`
    const now = new Date().toISOString()
    templates.value.push({ id: genId(), name, createdAt: now, updatedAt: now, data })
    persistTemplates()
    ElMessage.success(`已保存模板「${name}」`)
  } catch {
    /* 用户取消 */
  }
}

function importFromTemplate(t: ConfigTemplate) {
  templateDialogVisible.value = false
  applyImport(t.data)
}

async function renameTemplate(t: ConfigTemplate) {
  try {
    const { value } = await ElMessageBox.prompt('修改模板名称', '重命名模板', {
      inputValue: t.name,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
    const name = (value || '').trim()
    if (!name) return
    t.name = name
    t.updatedAt = new Date().toISOString()
    persistTemplates()
    ElMessage.success('已重命名')
  } catch {
    /* 用户取消 */
  }
}

async function deleteTemplate(t: ConfigTemplate) {
  try {
    await ElMessageBox.confirm(`确定删除模板「${t.name}」吗？此操作不可恢复。`, '删除模板', { type: 'warning' })
    templates.value = templates.value.filter((x) => x.id !== t.id)
    persistTemplates()
    ElMessage.success('已删除')
  } catch {
    /* 用户取消 */
  }
}

onMounted(loadTemplates)

// 切换页签 / 连接建立后自动读取当前页（仅连接时）
watch(activeTab, (g) => { if (props.connected) loadGroup(g) })
watch(() => props.connected, (c) => { if (c) loadGroup(activeTab.value) })
</script>

<style scoped>
.tpc { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-6); min-height: 0; overflow-y: auto; }
.tpc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.tpc-title { font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.tpc-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.tpc-proto { font-size: var(--fs-caption); color: var(--text-tertiary); font-family: var(--font-mono); }

.tpc-offline {
  padding: var(--space-3) var(--space-4);
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  color: var(--warning);
  font-size: var(--fs-caption);
}

.tpc-tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--border-default); flex-wrap: wrap; }
.tpc-tab {
  padding: var(--space-3) var(--space-5); background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--text-secondary); cursor: pointer;
  font-size: var(--fs-body-sm); font-weight: var(--fw-medium);
}
.tpc-tab:hover { color: var(--text-primary); }
.tpc-tab.active { color: var(--text-primary); border-bottom-color: var(--brand); font-weight: var(--fw-semibold); }

.tpc-body { flex: 1; min-height: 0; }

/* 参数表 */
.param-table { display: flex; flex-direction: column; border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden; }
.pt-head, .pt-row {
  display: grid;
  grid-template-columns: 1.4fr 1.4fr 1fr 1.3fr 0.7fr 2.2fr 0.9fr;
  align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.pt-head { background: var(--bg-base); border-bottom: 1px solid var(--border-default); font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: var(--fw-semibold); }
.pt-row { border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface); }
.pt-row:last-child { border-bottom: none; }
.pt-row.dirty { background: var(--warning-bg); }
.c-name { font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: var(--fw-medium); }
.c-var { font-size: var(--fs-caption); color: var(--text-tertiary); }
.c-cur { font-size: var(--fs-body-sm); color: var(--text-primary); }
.c-unit { font-size: var(--fs-caption); color: var(--text-tertiary); }
.c-range { font-size: var(--fs-caption); color: var(--text-secondary); }
.c-range .ph { color: var(--warning); }
.cell-input {
  width: 100%; height: 28px; padding: 0 var(--space-3);
  background: var(--bg-canvas); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-body-sm);
}
.cell-input:focus { outline: none; border-color: var(--brand); }
.cell-select { width: 100%; }
.c-op { display: flex; justify-content: flex-end; }

/* 控制页 */
.ctrl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-5); }
.ctrl-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--space-5); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md);
}
.ctrl-name { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ctrl-reg { font-size: var(--fs-caption); color: var(--text-tertiary); }
.ctrl-hint { font-size: var(--fs-caption); color: var(--warning); flex: 1; }

/* 模板对话框 */
.tip { font-size: var(--fs-caption); color: var(--text-secondary); margin-bottom: var(--space-4); }
.tpl-actions { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-4); }
.tpl-count { font-size: var(--fs-caption); color: var(--text-tertiary); }
.tpl-empty { font-size: var(--fs-caption); color: var(--text-tertiary); padding: var(--space-4) 0; }
.tpl-item {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-4);
  padding: var(--space-3) var(--space-4); border: 1px solid var(--border-default);
  border-radius: var(--radius-sm); margin-bottom: var(--space-2); background: var(--bg-surface);
}
.tpl-meta { display: flex; flex-direction: column; gap: 2px; }
.tpl-name { font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: var(--fw-medium); }
.tpl-time { font-size: var(--fs-caption); color: var(--text-tertiary); }
.tpl-btns { display: flex; gap: var(--space-2); }

/* 按钮 */
.btn {
  height: 30px; padding: 0 var(--space-4); border-radius: var(--radius-sm);
  background: var(--bg-canvas); border: 1px solid var(--border-default); color: var(--text-secondary);
  font-size: var(--fs-caption); cursor: pointer; white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-strong); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--brand-bg-subtle); border-color: var(--brand); color: var(--brand-text); font-weight: var(--fw-semibold); }
.btn-primary:hover:not(:disabled) { background: var(--brand-bg); }
.btn-sm { height: 26px; padding: 0 var(--space-3); }
.btn-danger { background: var(--critical-bg); border-color: var(--critical-border); color: var(--critical); font-weight: var(--fw-semibold); }
.btn-danger:hover:not(:disabled) { background: var(--critical-bg); filter: brightness(1.15); }
.btn-ghost { background: transparent; border-color: var(--border-default); color: var(--text-tertiary); }
</style>
