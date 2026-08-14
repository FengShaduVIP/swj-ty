<template>
  <div class="tpc">
    <div class="tpc-head">
      <div class="tpc-title">天一 BMS 参数下发</div>
      <div class="tpc-actions">
        <span class="tpc-proto">Modbus-RTU · 从机 0x{{ slaveHex }}</span>
        <button class="btn" :disabled="!connected || reading || readingAll" @click="loadAll">
          {{ readingAll ? '读取全部中…' : '读取全部' }}
        </button>
        <button class="btn" :disabled="!connected || reading || readingAll" @click="loadGroup(activeTab)">
          {{ reading ? '读取中…' : '读取当前' }}
        </button>
        <span class="tpc-sep" />
        <button class="btn btn-primary" :disabled="!connected || writing || readingAll || dirtyCount(activeTab) === 0" @click="writeAll">
          写入全部已修改 ({{ dirtyCount(activeTab) }})
        </button>
        <span class="tpc-sep" />
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
      <div v-if="activeTab === 'control'" class="field-grid" style="--cols: 6">
        <div v-for="def in paramsOf('control')" :key="def.reg" class="field">
          <div class="field-label">
            <span class="field-label-text" :title="def.hint">{{ def.label }}</span>
          </div>
          <div class="field-row">
            <el-input :model-value="'—'" readonly size="small" style="flex: 1" />
            <el-button size="small" type="danger" :loading="statusMap[def.reg] === 'writing'" :disabled="!connected || writing" @click="writeControl(def)">执行</el-button>
          </div>
        </div>
      </div>

      <!-- 参数卡片网格：每行 6 列 -->
      <div v-else class="field-grid" style="--cols: 6">
        <div
          v-for="def in paramsOf(activeTab)"
          :key="def.reg"
          class="field"
          :class="{ 'field--dirty': isDirty(def), ok: statusMap[def.reg] === 'ok', fail: statusMap[def.reg] === 'fail' }"
        >
          <div class="field-label">
            <span class="field-label-text" :title="def.hint">{{ def.label }}</span>
          </div>
          <div class="field-row">
            <el-select
              v-if="def.options"
              :model-value="editMap[def.reg] ?? ''"
              size="small"
              style="flex: 1"
              @update:model-value="(v: any) => { editMap[def.reg] = String(v); statusMap[def.reg] = '' }"
            >
              <el-option
                v-for="o in def.options"
                :key="o.value"
                :label="o.label"
                :value="String(o.value)"
              />
            </el-select>
            <el-input
              v-else
              :model-value="editMap[def.reg] ?? ''"
              type="number"
              size="small"
              style="flex: 1"
              :step="def.step ?? Math.pow(10, -(def.decimals ?? 0))"
              :min="def.min"
              :max="def.max"
              placeholder="—"
              @update:model-value="(v: any) => { editMap[def.reg] = String(v); statusMap[def.reg] = '' }"
            >
              <template v-if="def.unit" #suffix>{{ def.unit }}</template>
            </el-input>
            <el-button
              size="small"
              type="primary"
              :loading="statusMap[def.reg] === 'writing'"
              :disabled="!isDirty(def) || !connected || writing"
              @click="writeOne(def)"
            >下发</el-button>
          </div>
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
const statusMap = reactive<Record<number, 'ok' | 'fail' | 'writing' | ''>>({})
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
  if (raw === undefined) return true
  return edited !== formatDisplay(def, raw)
}

function dirtyCount(group: TianyiGroup): number {
  return paramsOf(group).filter((d) => isDirty(d)).length
}

// ===== 读取整组（内部，不含 loading 标记）=====
async function readGroupInternal(group: TianyiGroup): Promise<boolean> {
  if (group === 'control') return false
  const range = GROUP_READ[group]
  if (!range) return false
  const frame = await tianyiBus.sendAck(buildReadHoldingRegisters(slave.value, range.start, range.count))
  if (frame.timeout || frame.exception) {
    ElMessage.error(`读取 ${group} 失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
    return false
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
    statusMap[def.reg] = ''
  }
  return true
}

// 读取当前页（按页签）
async function loadGroup(group: TianyiGroup) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  reading.value = true
  try {
    const ok = await readGroupInternal(group)
    if (ok) ElMessage.success(`已读取 ${group} 区 ${paramsOf(group).length} 项`)
  } catch (e: any) {
    ElMessage.error('读取异常：' + (e?.message || e))
  } finally {
    reading.value = false
  }
}

// 读取全部（配置/保护/校准/休眠 四组顺序读取，复用总线 500ms 间隔）
const readingAll = ref(false)
async function loadAll() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (readingAll.value) return
  readingAll.value = true
  const groups: TianyiGroup[] = ['config', 'protect', 'calib', 'sleep']
  let okCount = 0
  try {
    for (const g of groups) {
      const ok = await readGroupInternal(g)
      if (ok) okCount++
    }
    if (okCount === groups.length) {
      ElMessage.success(`已读取全部 ${okCount} 组参数（共 ${PARAM_DEFS.filter((d) => d.group !== 'control').length} 项）`)
    } else {
      ElMessage.warning(`读取完成：成功 ${okCount}/${groups.length} 组`)
    }
  } catch (e: any) {
    ElMessage.error('读取全部异常：' + (e?.message || e))
  } finally {
    readingAll.value = false
  }
}

// ===== 单条写入 =====
async function writeOne(def: TianyiParamDef) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }

  let value: number
  if (def.options) {
    value = parseInt(editMap[def.reg], 10)
    if (!Number.isFinite(value)) { ElMessage.error(`${def.label}：取值无效`); return }
  } else {
    const v = parseFloat(editMap[def.reg])
    if (!Number.isFinite(v)) { ElMessage.error(`${def.label}：请输入有效数字`); return }
    if (def.min !== undefined && v < def.min) { ElMessage.error(`${def.label}：低于最小值 ${def.min}`); return }
    if (def.max !== undefined && v > def.max) { ElMessage.error(`${def.label}：超出最大值 ${def.max}`); return }
    value = displayToRaw(def, v)
  }

  if (def.group === 'protect' || def.group === 'calib') {
    try {
      await ElMessageBox.confirm(
        `确认将「${def.label}」写入为 ${def.options ? editMap[def.reg] : editMap[def.reg] + (def.unit ? ' ' + def.unit : '')}？`,
        '写参数确认',
        { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }

  statusMap[def.reg] = 'writing'
  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
    if (frame.timeout || frame.exception) {
      statusMap[def.reg] = 'fail'
      ElMessage.error(`写入失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
      return
    }
    rawMap[def.reg] = value
    editMap[def.reg] = formatDisplay(def, value)
    statusMap[def.reg] = 'ok'
    ElMessage.success(`已写入 ${def.label}`)
  } catch (e: any) {
    statusMap[def.reg] = 'fail'
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
    statusMap[key] = 'writing'
    try {
      const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
      if (frame.timeout || frame.exception) { statusMap[key] = 'fail'; fail++; continue }
      rawMap[key] = value
      editMap[key] = formatDisplay(def, value)
      statusMap[key] = 'ok'
      ok++
    } catch {
      statusMap[key] = 'fail'
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
  statusMap[def.reg] = 'writing'
  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, 0x0001))
    if (frame.timeout || frame.exception) {
      statusMap[def.reg] = 'fail'
      ElMessage.error(`执行失败：${frame.timeout ? '超时无响应' : '设备异常应答'}`)
      return
    }
    statusMap[def.reg] = 'ok'
    ElMessage.success(`已执行 ${def.label}`)
  } catch (e: any) {
    statusMap[def.reg] = 'fail'
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
      continue
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
    editMap[reg] = formatDisplay(def, rawVal)
    statusMap[reg] = ''
    n++
  }
  if (!n) { ElMessage.error('未找到有效参数（请检查文件内容）'); return }
  ElMessage.success(`已导入 ${n} 个参数（已在卡片标红，连接后可下发）`)
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
.tpc-sep { width: 1px; height: 20px; background: var(--border-default); margin: 0 var(--space-1); }

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

/* 与 JBD 参数配置页对齐的卡片网格 */
.field-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 6), minmax(0, 1fr));
  gap: var(--space-4);
}
.field {
  position: relative;
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
  min-width: 0;
}
.field.ok { box-shadow: inset 2px 0 0 var(--ok); }
.field.fail { box-shadow: inset 2px 0 0 var(--critical); }
.field--dirty { box-shadow: inset 2px 0 0 var(--warning); }
.field--dirty::after {
  content: ''; position: absolute; top: 6px; right: 6px;
  width: 6px; height: 6px; border-radius: var(--radius-pill); background: var(--warning);
}
.field-label {
  display: flex; align-items: center; gap: var(--space-2);
  font-size: var(--fs-caption); color: var(--text-secondary);
  margin-bottom: var(--space-3); min-height: 18px;
}
.field-label-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.field-row {
  display: flex; align-items: center; gap: var(--space-2);
  min-width: 0;
}

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
.btn-ghost { background: transparent; border-color: var(--border-default); color: var(--text-tertiary); }
</style>
