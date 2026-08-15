<template>
  <div class="param-config">
    <!-- 顶部操作栏 -->
    <section class="panel sec">
      <header class="sec-h">
        <span class="panel-title"><el-icon><Setting /></el-icon> JBD 参数配置</span>
        <div class="header-actions">
          <StatusBadge :status="inFactory ? 'brand' : 'neutral'" :label="inFactory ? '工厂模式' : '普通模式'" />
          <el-button size="small" :disabled="!connected" :loading="busy" @click="readAll"><el-icon><Refresh /></el-icon> 读取全部</el-button>
          <el-button size="small" type="primary" :disabled="!connected || !dirtyCount" :loading="busy" @click="writeAll"><el-icon><Upload /></el-icon> 全部写入({{ dirtyCount }})</el-button>
          <el-button size="small" @click="openTemplateDialog"><el-icon><FolderOpened /></el-icon> 导入配置</el-button>
          <el-button size="small" @click="saveAsTemplate"><el-icon><Files /></el-icon> 存为模板</el-button>
          <el-button size="small" @click="exportConfig"><el-icon><Download /></el-icon> 导出配置</el-button>
          <el-button size="small" :type="dragMode ? 'warning' : 'default'" @click="dragMode = !dragMode">
            <el-icon><Operation /></el-icon> {{ dragMode ? '完成排序' : '拖动排序' }}
          </el-button>
          <el-button size="small" @click="resetToDefault"><el-icon><RefreshLeft /></el-icon> 恢复默认顺序</el-button>
        </div>
      </header>
    </section>

    <div v-if="busy" class="progress-bar">
      <el-progress :percentage="progress" :stroke-width="4" :color="brandColor" />
    </div>

    <!-- 导入配置预览（弹窗） -->
    <el-dialog
      v-model="importDialogVisible"
      title="已导入参数配置预览"
      width="760px"
      :close-on-click-modal="false"
      @closed="clearImport"
    >
      <div class="tip">以下为配置文件解析出的参数，核对无误后点击「一键下发所有参数」批量写入目标设备，下发结果将在此处实时反馈。</div>
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
          <span class="c-value" :class="{ 'value-diff': isSendDiff(p) }">{{ p.value }} {{ p.unit }}</span>
          <span class="c-current">{{ currentParamValue(p) }}</span>
          <span class="c-raw">0x{{ p.raw.toString(16).padStart(4, '0').toUpperCase() }}</span>
          <span class="c-status">
            <span v-if="p.status === 'ok'" class="dot ok" />
            <span v-else-if="p.status === 'fail'" class="dot fail" />
            <span v-else class="muted">待下发</span>
          </span>
        </div>
      </div>
      <template #footer>
        <el-button size="small" text :disabled="busy" @click="importDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :disabled="!connected || busy" :loading="busy" @click="sendAllImported">
          <el-icon><Promotion /></el-icon> 一键下发所有参数
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入配置模板列表（弹窗） -->
    <el-dialog
      v-model="templateDialogVisible"
      title="导入配置模板"
      width="640px"
      :close-on-click-modal="false"
    >
      <div class="tip">选择本地已保存的配置模板可直接导入，无需再次选择文件；也可从文件导入，或先「存为模板」保存当前配置。</div>
      <div class="tpl-toolbar">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".json,application/json"
          :on-change="onFileChangeFromDialog"
          style="display: inline-flex"
        >
          <el-button size="small"><el-icon><FolderOpened /></el-icon> 从文件导入</el-button>
        </el-upload>
        <span class="tpl-count">共 {{ templates.length }} 个模板</span>
      </div>
      <div class="tpl-list">
        <div v-if="!templates.length" class="tpl-empty">
          暂无模板，点击「从文件导入」或先「存为模板」保存当前配置。
        </div>
        <div v-for="t in templates" :key="t.id" class="tpl-item">
          <div class="tpl-main">
            <div class="tpl-name">{{ t.name }}</div>
            <div class="tpl-meta">{{ formatDate(t.updatedAt) }} · {{ (t.data?.params?.length) || 0 }} 个参数</div>
          </div>
          <div class="tpl-actions">
            <el-button size="small" type="primary" @click="importFromTemplate(t)">导入</el-button>
            <el-button size="small" text @click="renameTemplate(t)"><el-icon><Edit /></el-icon> 重命名</el-button>
            <el-button size="small" text @click="deleteTemplate(t)"><el-icon><Delete /></el-icon></el-button>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 下发密码校验弹窗（仅检流阻值等 needPassword 字段） -->
    <el-dialog
      v-model="pwdDialogVisible"
      title="下发确认"
      width="360px"
      :close-on-click-modal="false"
      :show-close="false"
      @closed="onPwdCancel"
    >
      <div class="tip" style="margin-bottom: 12px">该参数下发需要输入密码确认。</div>
      <el-input
        v-model="pwdInput"
        type="password"
        show-password
        placeholder="请输入下发密码"
        @keyup.enter="onPwdConfirm"
      />
      <div v-if="pwdError" class="pwd-error">{{ pwdError }}</div>
      <template #footer>
        <el-button size="small" @click="onPwdCancel">取消</el-button>
        <el-button size="small" type="primary" @click="onPwdConfirm">确认下发</el-button>
      </template>
    </el-dialog>

    <!-- 分组表单：左右两列容器布局（每组内字段 3 列网格）；
         拖动模式下卡片可「列内重排」并支持「跨列移动」，顺序持久化到 localStorage -->
    <div class="pc-toolbar">
      <el-input v-model="searchText" size="small" clearable placeholder="搜索参数名称…" style="width: 260px">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button size="small" @click="toggleCollapseAll">{{ allCollapsed ? '展开全部' : '折叠全部' }}</el-button>
      <span class="pc-count" v-if="searchText">匹配 {{ matchCount }} 项</span>
    </div>
    <div class="groups" :class="{ dragging: dragMode }">
      <div
        v-for="(colArr, ci) in displayColumns"
        :key="ci"
        class="group-col"
        :class="{ 'col-dragging': dragMode }"
        @dragover.prevent
        @drop="onDropColumn(ci)"
      >
      <section
        v-for="g in colArr"
        :key="g.title"
        class="panel sec group-card"
        :class="{ 'is-dragging': dragMode }"
        :draggable="dragMode"
        @dragstart="onDragStart(g)"
        @dragover.prevent
        @drop.stop="onDropGroup(g.title, ci)"
        @dragend="onDragEnd"
      >
        <header class="sec-h">
          <el-icon v-if="dragMode" class="drag-handle"><Rank /></el-icon>
          <span class="group-title">{{ g.title }}</span>
          <el-button size="small" text class="collapse-btn" @click="toggleCollapse(g.title)">
            <el-icon><component :is="isCollapsed(g.title) ? ArrowRight : ArrowDown" /></el-icon>
          </el-button>
          <el-button size="small" text :disabled="!connected" style="margin-left:auto" @click="readGroup(g)"><el-icon><Refresh /></el-icon> 读本组</el-button>
        </header>
        <div class="sec-b" v-if="!isCollapsed(g.title) || !!searchText.trim()">
          <div class="field-grid" :style="{ gridTemplateColumns: `repeat(${g.cols ?? 3}, 1fr)` }">
            <div
              v-for="f in g.fields"
              :key="f.key ?? f.label"
              class="field"
              :class="[f.status, { 'field--dirty': f.dirty, 'field--ro': isReadOnly(f), 'field--full': f.fullWidth }]"
            >
              <div class="field-label">
                <span class="field-label-text">{{ f.label }}</span>
                <el-tag v-if="f.note" type="info" size="small" effect="plain">{{ f.note }}</el-tag>
              </div>
              <div class="field-row">
                <!-- ASCII 字段：可编辑文本输入 + 下发按钮（ascii_len 个寄存器 → ascii_len*2 字节） -->
                <el-input
                  v-if="f.ascii"
                  :model-value="f.value ?? ''"
                  :readonly="isReadOnly(f)"
                  size="small"
                  style="flex: 1"
                  placeholder="—"
                  :maxlength="(f.ascii_len ?? 8) * 2 - 1"
                  show-word-limit
                  @update:model-value="(v: any) => onAsciiInput(f, v)"
                >
                  <template v-if="shouldShowUnit(f)" #suffix>{{ f.unit }}</template>
                  <template #append>
                    <el-button
                      size="small"
                      type="primary"
                      :loading="f.status === 'writing'"
                      :disabled="!canWrite(f)"
                      @click="writeField(f)"
                    >下发</el-button>
                  </template>
                </el-input>
                <!-- 均衡方式：单选按钮（bit 3 of index 29） -->
                <el-radio-group
                  v-else-if="f.customDisplay === 'balanceMode'"
                  :model-value="f.value ? 'charge' : 'static'"
                  size="small"
                  :disabled="!connected || f.status === 'reading'"
                  @change="(v: any) => onBalanceModeChange(f, v)"
                >
                  <el-radio-button value="static">静态均衡</el-radio-button>
                  <el-radio-button value="charge">充电均衡</el-radio-button>
                </el-radio-group>
                <!-- 位开关字段（与 bitIndex/bit 配合） -->
                <el-switch
                  v-else-if="isBitSwitch(f)"
                  v-model="f.value"
                  :disabled="f.status === 'reading' || !connected"
                  @change="onBitChange(f); f.dirty = true"
                />
                <!-- 自定义展示字段（来自 useJbd / 派生） -->
                <span v-else-if="f.customDisplay" class="custom-val mono">{{ customDisplayValue(f) }}</span>
                <!-- TODO / 只读字段（无可写寄存器） -->
                <span v-else-if="f.readOnly" class="custom-val mono">—</span>
                <!-- 下拉选项字段 / 复合保护字段(scd)：显示友好名称，下发原始 value -->
                <template v-else-if="f.options || f.kind === 'scd'">
                  <el-select
                    :model-value="f.value"
                    size="small"
                    style="flex: 1"
                    :disabled="!connected || f.status === 'reading'"
                    @update:model-value="(v: any) => onSelectChange(f, v)"
                  >
                    <el-option
                      v-for="opt in (f.kind === 'scd' ? scdOptions(f) : f.options)"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                  <el-button
                    size="small"
                    type="primary"
                    :loading="f.status === 'writing'"
                    :disabled="!canWrite(f)"
                    @click="writeField(f)"
                  >下发</el-button>
                </template>
                <!-- 普通数值字段：单位放 suffix，下发按钮放 append -->
                <el-input
                  v-else
                  :model-value="f.value"
                  type="number"
                  size="small"
                  style="flex: 1"
                  :step="f.step ?? 1"
                  :min="f.min"
                  :max="f.max"
                  @update:model-value="(v: any) => onNumInput(f, v)"
                >
                  <template v-if="shouldShowUnit(f)" #suffix>{{ f.unit }}</template>
                  <template #append>
                    <el-button
                      size="small"
                      type="primary"
                      :loading="f.status === 'writing'"
                      :disabled="!canWrite(f)"
                      @click="writeField(f)"
                    >下发</el-button>
                  </template>
                </el-input>
                <el-button
                  v-if="f.resetMcu"
                  size="small"
                  type="warning"
                  :disabled="!connected"
                  @click="confirmResetMcu"
                >复位MCU</el-button>
                <span v-if="f.status === 'ok'" class="dot ok" />
                <span v-else-if="f.status === 'fail'" class="dot fail" title="失败/超时" />
              </div>
            </div>
          </div>
          <!-- 分组级位图下发按钮（如功能设置/温度探头配置的"应用配置"） -->
          <div v-if="g.action" class="group-action">
            <el-button
              size="small"
              type="primary"
              :loading="busy"
              :disabled="!connected"
              @click="g.action.fn(g)"
            >
              <el-icon><Promotion /></el-icon> {{ g.action.label }}
            </el-button>
          </div>
        </div>
        <div v-else class="sec-collapsed">已折叠 · {{ g.fields.length }} 项</div>
      </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting, Refresh, Upload, FolderOpened, Download, Files, Promotion, Rank, Operation, RefreshLeft, Delete, Edit, Search, ArrowDown, ArrowRight } from '@element-plus/icons-vue'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildReadParam, buildWriteParam, buildSetBtName,
  buildEnterFactory, buildExitFactory,
  buildControlCommand, CONTROL_FUNC,
} from '@/jbd/jbd-protocol'
import { paramRawToDisplay, paramDisplayToRaw, paramFormat, splitScd, combineScd, scdProtectLabel, scdDelayLabelMs } from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import StatusBadge from './StatusBadge.vue'

type FieldStatus = 'idle' | 'reading' | 'writing' | 'ok' | 'fail'
type CustomDisplayKind = 'chipType' | 'hwVersion' | 'ntcCount' | 'balanceMode' | 'date' | 'serialRaw'

interface FieldDef {
  label: string
  index?: number
  unit?: string
  decimals?: number
  step?: number
  min?: number
  max?: number
  note?: string
  /** 唯一 key（用于 v-for；当 index 不可用时用 label 兜底） */
  key?: string
  /** ASCII 块字段：读取 N 个连续寄存器并解码为字符串（只读） */
  ascii?: boolean
  ascii_len?: number
  /** 位开关字段（与 bitIndex/bit 配合） */
  bitIndex?: number
  bit?: number
  /** 只读字段（不可下发，常用于设备标识 / 协议未涵盖） */
  readOnly?: boolean
  /** 自定义展示：值为 customDisplayValue() 返回值；不参与 0xFA 读写 */
  customDisplay?: CustomDisplayKind
  /** 跨列占满（用于检流阻值等） */
  fullWidth?: boolean
  /** 字段行内附带「复位 MCU」按钮（与设备控制页功能一致） */
  resetMcu?: boolean
  /** 下拉选项字段：value 为下发到 BMS 的原始寄存器值 */
  options?: { label: string; value: number }[]
  /** 复合保护字段：单个寄存器 16 位，低字节高半字节=保护值档位(level)、低字节低半字节=延迟档位(delay) */
  kind?: 'scd'
  scdPart?: 'level' | 'delay'
  /** 下发前需要输入密码校验（如检流阻值） */
  needPassword?: boolean
}

interface FieldState extends FieldDef {
  value: any
  dirty: boolean
  status: FieldStatus
}

const props = defineProps<{ connected: boolean }>()

type ImportStatus = 'ok' | 'fail' | undefined
interface ImportedParam {
  index: number; label: string; unit: string; value: number; raw: number; status?: ImportStatus
  current?: number | null  // 导入前设备上真实的当前值，用于与下发值比对
}
const importedParams = ref<ImportedParam[]>([])
const importDialogVisible = ref(false)

// ====== 本地配置模板（localStorage） ======
interface ConfigTemplate {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  data: any  // 与导出文件同构：{ type, version, params: [...] }
}
const TEMPLATE_KEY = 'jbd-param-templates'
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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
function formatDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function openTemplateDialog() {
  loadTemplates()
  templateDialogVisible.value = true
}

// 从模板列表中选择一个模板直接导入
function importFromTemplate(t: ConfigTemplate) {
  templateDialogVisible.value = false
  applyImport(t.data)
}

// 模板对话框内的「从文件导入」：关闭对话框后用原流程解析
function onFileChangeFromDialog(uploadFile: any) {
  templateDialogVisible.value = false
  onFileChange(uploadFile)
}

// 当前配置保存为本地模板
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
    const now = Date.now()
    templates.value.push({ id: genId(), name, createdAt: now, updatedAt: now, data })
    persistTemplates()
    ElMessage.success(`已保存模板「${name}」`)
  } catch { /* 用户取消 */ }
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
    t.updatedAt = Date.now()
    persistTemplates()
  } catch { /* 用户取消 */ }
}

async function deleteTemplate(t: ConfigTemplate) {
  try {
    await ElMessageBox.confirm(`确定删除模板「${t.name}」吗？此操作不可恢复。`, '删除模板', { type: 'warning' })
    templates.value = templates.value.filter((x) => x.id !== t.id)
    persistTemplates()
  } catch { /* 用户取消 */ }
}

function fieldByIndex(index: number): FieldState | undefined {
  return allFields.value.find((f) => f.index === index)
}

const autoFactory = ref(true)
const inFactory = ref(false)
const busy = ref(false)
const progress = ref(0)
const brandColor = '#1F6FE0'

const j = useJbd()

// ====== ASCII 解析 ======
/** 从 0xFA 多寄存器应答中解码 ASCII 字串
 *  响应格式：[regH, regL, count, v0H, v0L, v1H, v1L, ...]
 *  按 PDF V12：条形码/BMS 编码/厂商信息均采用 ASCII 码传送，第一个字节 = 字符串长度，
 *  后续字节为 ASCII 字符。寄存器按大端存放（高字节在前），因此直接顺序取 data[3..] 即为字节流。
 */
function parseAsciiResponse(resp: any, maxBytes: number): string {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return ''
  const data = resp.data
  if (!data || data.length < 4) return ''
  const count = data[2]
  if (count < 1 || data.length < 3 + count * 2) return ''
  // 顺序取字节：data[3]=v0H, data[4]=v0L, data[5]=v1H, data[6]=v1L ...
  const total = Math.min(count * 2, maxBytes)
  const bytes = data.slice(3, 3 + total)
  // 第一字节为字符串长度（UTF-8 字节数），后续字节为名称的 UTF-8 编码
  const len = bytes[0] & 0xff
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text: string
  if (len > 0 && len < bytes.length) {
    text = decoder.decode(new Uint8Array(bytes.slice(1, 1 + len)))
  } else {
    // 无长度字节或长度为 0：把后续所有字节当字符串解码
    text = decoder.decode(new Uint8Array(bytes.slice(1)))
  }
  // 仅剔除控制字符（保留可打印 ASCII、CJK 等多字节字符）
  return text.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

// ====== 位开关共享位图 ======
/** reg -> raw bitmap (0~0xFFFF)；所有同 bitIndex 的位开关共用同一份位图 */
const bitmaps = ref<Record<number, number | null>>({})
function popcount(n: number): number {
  let c = 0
  while (n) { c += n & 1; n >>>= 1 }
  return c
}
/** NTC 使能数 = index 30 bitmap 共 16 位（温度探头_1~16，bit0~15）的 popcount
 *  按 PDF：寄存器 30 = 温度探头配置，2 字节，每 1 bit 对应一路探头使能。
 */
const ntcCount = computed(() => {
  const v = bitmaps.value[30]
  return v === null || v === undefined ? 0 : popcount(v & 0xffff)
})

/** 自定义展示字段值 */
function customDisplayValue(f: FieldState): string {
  if (f.customDisplay === 'chipType') return j.chipTypeName.value
  if (f.customDisplay === 'hwVersion') return j.hwVersion.value || '—'
  if (f.customDisplay === 'ntcCount') return String(ntcCount.value)
  if (f.customDisplay === 'date' && f.value !== null && f.value !== undefined) return paramFormat(5, f.value)
  if (f.customDisplay === 'serialRaw' && f.value !== null && f.value !== undefined) {
    return '0x' + ((f.value & 0xffff).toString(16).toUpperCase().padStart(4, '0'))
  }
  return '—'
}

function isBitSwitch(f: FieldState): boolean {
  return f.bitIndex !== undefined && f.bit !== undefined && f.customDisplay !== 'balanceMode'
}

function isReadOnly(f: FieldState): boolean {
  if (f.readOnly) return true
  if (f.customDisplay && f.customDisplay !== 'date') return true
  return false
}

function shouldShowUnit(f: FieldState): boolean {
  if (f.ascii) return false
  if (f.bitIndex !== undefined) return false
  if (f.customDisplay) return false
  if (f.readOnly) return false
  return !!f.unit
}

function canRead(f: FieldState): boolean {
  if (!props.connected) return false
  if (isBitSwitch(f)) return true
  if (f.customDisplay === 'date' && f.index !== undefined) return true
  if (f.customDisplay === 'serialRaw' && f.index !== undefined) return true
  if (f.customDisplay) return false
  if (f.readOnly && f.index === undefined) return false
  return f.index !== undefined
}

function canWrite(f: FieldState): boolean {
  if (!props.connected) return false
  if (f.readOnly) return false
  if (f.customDisplay) return false
  if (isBitSwitch(f)) return false  // 位开关通过 group.action 或 writeAll 下发
  // ASCII：值为字符串（可空串），index 必须存在
  if (f.ascii) return f.index !== undefined && typeof f.value === 'string'
  return f.value !== null && f.index !== undefined
}

/** 位开关变更 → 更新共享位图 */
function onBitChange(f: FieldState) {
  if (f.bitIndex === undefined || f.bit === undefined) return
  const cur = bitmaps.value[f.bitIndex] ?? 0
  bitmaps.value[f.bitIndex] = (cur & ~(1 << f.bit)) | ((f.value ? 1 : 0) << f.bit)
  f.dirty = true
}

/** 均衡方式 radio 变更 → 写入 bit 3 */
function onBalanceModeChange(f: FieldState, val: any) {
  if (f.bitIndex === undefined || f.bit === undefined) return
  f.value = val === 'charge'
  onBitChange(f)
  f.dirty = true
}

function makeField(def: FieldDef): FieldState {
  return { ...def, value: def.bitIndex !== undefined ? false : null, dirty: false, status: 'idle' }
}

/** 数值字段输入：el-input type=number 回传字符串，转 number；空值置 null */
function onNumInput(f: FieldState, v: any) {
  if (v === '' || v === null || v === undefined) f.value = null
  else {
    const n = Number(v)
    if (!Number.isNaN(n)) f.value = n
  }
  f.dirty = true
}

/** 下拉选项字段输入：直接存原始 value 并标脏 */
function onSelectChange(f: FieldState, v: any) {
  f.value = Number(v)
  f.dirty = true
}

// ====== 复合保护字段（scd）：一个寄存器 16 位，低字节高半字节=保护值档位(level)、低字节低半字节=延迟档位(delay) ======
/** 根据芯片方案生成下拉选项（0~15 共 16 档，label 显示具体物理量） */
function scdOptions(f: FieldState): { label: string; value: number }[] {
  const chip = j.chipType.value
  const shunt = shuntMOhm.value
  // 二级过流 = 寄存器 40；短路 = 寄存器 41
  const param: 'ocd' | 'scd' = f.index === 40 ? 'ocd' : 'scd'
  const fn: (i: number) => string = f.scdPart === 'delay'
    ? (i: number) => scdDelayLabelMs(param, chip, i)         // 延时统一 mS
    : (i: number) => scdProtectLabel(param, chip, i, shunt)   // 保护值统一显示电流(A)
  const out: { label: string; value: number }[] = []
  for (let i = 0; i <= 15; i++) out.push({ label: fn(i), value: i })
  return out
}
/** 取同 index 的另一个 part 字段（用于合成下发） */
function scdPeer(f: FieldState): FieldState | undefined {
  return allFields.value.find(
    (x) => x.index === f.index && x.kind === 'scd' && x.scdPart !== f.scdPart,
  )
}
// 检流电阻(mΩ)：取自「检流电阻」模块寄存器 28 字段的显示值（kind:'shunt' → mΩ）
const shuntMOhm = computed(() => {
  const f = allFields.value.find((x) => x.index === 28)
  const v = f?.value
  return typeof v === 'number' && v > 0 ? v : 0
})

// ====== 下发密码校验（仅检流阻值等 needPassword 字段） ======
const PWD_FIXED = 'tyln@1688'
const pwdDialogVisible = ref(false)
const pwdInput = ref('')
const pwdError = ref('')
const pwdResolve = ref<((ok: boolean) => void) | null>(null)

function confirmPassword(): Promise<boolean> {
  pwdInput.value = ''
  pwdError.value = ''
  pwdDialogVisible.value = true
  return new Promise((resolve) => { pwdResolve.value = resolve })
}
function onPwdConfirm() {
  if (pwdInput.value !== PWD_FIXED) {
    pwdError.value = '密码错误，请重试'
    return
  }
  pwdDialogVisible.value = false
  pwdResolve.value?.(true)
  pwdResolve.value = null
}
function onPwdCancel() {
  pwdDialogVisible.value = false
  pwdResolve.value?.(false)
  pwdResolve.value = null
}

/** ASCII 字段输入：直接存字符串并标脏 */
function onAsciiInput(f: FieldState, v: any) {
  f.value = typeof v === 'string' ? v : ''
  f.dirty = true
}

/** ASCII 字段编码：字符串 → (ascii_len 个寄存器 = ascii_len*2 字节)
 *  按 PDF 格式：第 1 字节为字符串长度（字符数），后面紧跟 ASCII 字符，不足补 0。
 */
function encodeAsciiValue(f: FieldState): number[] {
  const maxBytes = (f.ascii_len ?? 8) * 2
  const str = String(f.value ?? '')
  const bytes: number[] = [str.length & 0xff]
  for (let i = 0; i < maxBytes - 1; i++) {
    bytes.push(i < str.length ? (str.charCodeAt(i) & 0xff) : 0)
  }
  return bytes
}

// ====== 分组定义（1 排 2 列瀑布流布局，每组内字段 3 列网格，共 11 组） ======
type GroupAction = {
  label: string
  fn: (g: { title: string; fields: FieldState[] }) => void | Promise<void>
}

const GROUP_DEFS: { title: string; order: number; cols?: number; action?: GroupAction; fields: FieldDef[] }[] = [
  // 1. 基本设置（12 项 / 3 列 × 4 行）
  {
    title: '基本设置',
    order: 1,
    fields: [
      { label: '蓝牙名称', key: 'bt-name', index: 88, ascii: true, ascii_len: 16, fullWidth: true, resetMcu: true },
      { label: '芯片类型', key: 'chip-type', customDisplay: 'chipType' },
      { label: '电池SN码', key: 'sn', index: 6, customDisplay: 'serialRaw', readOnly: true },
      { label: '电池型号', key: 'battery-model', index: 158, ascii: true, ascii_len: 12, readOnly: true },
      { label: '电池生产商', key: 'mfr', index: 56, ascii: true, ascii_len: 16, readOnly: true },
      { label: 'BMS版本号', key: 'bms-ver', index: 72, ascii: true, ascii_len: 16, readOnly: true },
      { label: 'BMS型号', key: 'bms-hw-name', index: 176, ascii: true, ascii_len: 8, readOnly: true },
      { label: '生产日期', index: 5, customDisplay: 'date', readOnly: true },
      { label: '额定充电电压', index: 117, unit: 'V', decimals: 1, step: 0.1 },
      { label: '额定充电电流', index: 119, unit: 'A', decimals: 0 },
      { label: '额定放电电流', index: 118, unit: 'A', decimals: 0 },
      { label: '额定放电功率', index: 120, unit: 'W', decimals: 0 },
    ],
  },
  // 2. 电流设置（10 项 / 3 列 × 4 行）
  {
    title: '电流设置',
    order: 2,
    fields: [
      { label: '充电过流保护', index: 24, unit: 'mA', decimals: 0, step: 10 },
      { label: '充电过流延时', index: 52, unit: 'S', decimals: 0 },
      { label: '充电过流恢复延时', index: 53, unit: 'S', decimals: 0 },
      { label: '放电过流保护', index: 25, unit: 'mA', decimals: 0, step: 10 },
      { label: '放电过流延时', index: 54, unit: 'S', decimals: 0 },
      { label: '放电过流恢复延时', index: 55, unit: 'S', decimals: 0 },
      { label: '二级过流保护', index: 40, kind: 'scd', scdPart: 'level', note: '见IC' },
      { label: '二级过流延时', index: 40, kind: 'scd', scdPart: 'delay', note: '见IC' },
      { label: '短路保护', index: 41, kind: 'scd', scdPart: 'level', note: '见IC' },
      { label: '短路保护延时', index: 41, kind: 'scd', scdPart: 'delay', note: '见IC' },
      { label: '短路释放延时', index: 43, unit: 'S', decimals: 0 },
    ],
  },

  // 3. 容量电压（12 项 / 3 列 × 4 行）
  {
    title: '容量电压',
    order: 3,
    fields: [
      { label: '10%', index: 109, unit: 'mV', decimals: 0 },
      { label: '20%', index: 37, unit: 'mV', decimals: 0 },
      { label: '30%', index: 108, unit: 'mV', decimals: 0 },
      { label: '40%', index: 36, unit: 'mV', decimals: 0 },
      { label: '50%', index: 107, unit: 'mV', decimals: 0 },
      { label: '60%', index: 35, unit: 'mV', decimals: 0 },
      { label: '70%', index: 106, unit: 'mV', decimals: 0 },
      { label: '80%', index: 34, unit: 'mV', decimals: 0 },
      { label: '90%', index: 105, unit: 'mV', decimals: 0 },
      { label: '100%', index: 111, unit: 'mV', decimals: 0 },
      { label: '置满电压', index: 2, unit: 'mV', decimals: 0 },
      { label: '置空电压', index: 3, unit: 'mV', decimals: 0 },
    ],
  },
  // 5. 温度探头配置（序号 30 低字节：温度探头 1~8 使能，1 字节 8 bit / 3 列 × 3 行 + 应用配置按钮）
  {
    title: '温度探头配置',
    order: 5,
    action: { label: '应用配置', fn: (g) => writeGroupBitmap(g, 30) },
    fields: [
      { label: '温度探头_1',  key: 'probe-1',  bitIndex: 30, bit: 0  },
      { label: '温度探头_2',  key: 'probe-2',  bitIndex: 30, bit: 1  },
      { label: '温度探头_3',  key: 'probe-3',  bitIndex: 30, bit: 2  },
      { label: '温度探头_4',  key: 'probe-4',  bitIndex: 30, bit: 3  },
      { label: '温度探头_5',  key: 'probe-5',  bitIndex: 30, bit: 4  },
      { label: '温度探头_6',  key: 'probe-6',  bitIndex: 30, bit: 5  },
      { label: '温度探头_7',  key: 'probe-7',  bitIndex: 30, bit: 6  },
      { label: '温度探头_8',  key: 'probe-8',  bitIndex: 30, bit: 7  },
    ],
  },
  // 6. 均衡设置（2 项 / 3 列 × 1 行）
  {
    title: '均衡设置',
    order: 6,
    fields: [
      { label: '均衡电流', key: 'bal-current', readOnly: true, note: '需协议补充' },
      { label: '均衡精度', index: 27, unit: 'mV', decimals: 0 },
    ],
  },
  // 4. 系统设置（5 项 / 3 列 × 2 行）
  {
    title: '系统设置',
    order: 4,
    fields: [
      { label: '均衡电流', key: 'bal-current-2', readOnly: true, note: '需协议补充' },
      { label: '休眠时间', index: 122, unit: 'S', decimals: 0 },
      { label: '容量修正间隔', index: 113, unit: 'S', decimals: 0 },
      { label: '序列号', index: 6, customDisplay: 'serialRaw', readOnly: true },
      { label: '循环次数', index: 7, unit: '次', decimals: 0 },
    ],
  },
  // 8. 初始化设置（2 项 / 3 列 × 1 行）
  {
    title: '初始化设置',
    order: 8,
    fields: [
      { label: '标称容量', index: 0, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '循环容量', index: 1, unit: 'Ah', decimals: 2, step: 0.01 },
    ],
  },
  // 9. 温度设置（12 项 / 3 列 × 4 行）
  {
    title: '温度设置',
    order: 9,
    fields: [
      { label: '充电高温保护', index: 8, unit: '℃', decimals: 1 },
      { label: '充电高温恢复', index: 9, unit: '℃', decimals: 1 },
      { label: '充电高温延时', index: 45, unit: 'S', decimals: 0 },
      { label: '充电低温保护', index: 10, unit: '℃', decimals: 1 },
      { label: '充电低温恢复', index: 11, unit: '℃', decimals: 1 },
      { label: '充电低温延时', index: 44, unit: 'S', decimals: 0 },
      { label: '放电高温保护', index: 12, unit: '℃', decimals: 1 },
      { label: '放电高温恢复', index: 13, unit: '℃', decimals: 1 },
      { label: '放电高温延时', index: 47, unit: 'S', decimals: 0 },
      { label: '放电低温保护', index: 14, unit: '℃', decimals: 1 },
      { label: '放电低温恢复', index: 15, unit: '℃', decimals: 1 },
      { label: '放电低温延时', index: 46, unit: 'S', decimals: 0 },
    ],
  },
  // 10. 保护参数（14 项 / 3 列 × 5 行）
  {
    title: '保护参数',
    order: 10,
    fields: [
      { label: '单体过压保护', index: 20, unit: 'mV', decimals: 0 },
      { label: '单体过压恢复', index: 21, unit: 'mV', decimals: 0 },
      { label: '单体过压延时', index: 51, unit: 'S', decimals: 0 },
      { label: '单体欠压保护', index: 22, unit: 'mV', decimals: 0 },
      { label: '单体欠压恢复', index: 23, unit: 'mV', decimals: 0 },
      { label: '单体欠压延时', index: 50, unit: 'S', decimals: 0 },
      { label: '总体过压保护', index: 16, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体过压恢复', index: 17, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体过压延时', index: 49, unit: 'S', decimals: 0 },
      { label: '总体欠压保护', index: 18, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体欠压恢复', index: 19, unit: 'V', decimals: 2, step: 0.01 },
      { label: '总体欠压延时', index: 48, unit: 'S', decimals: 0 },
      { label: '硬件过压保护', index: 38, unit: 'mV', decimals: 0 },
      { label: '硬件欠压保护', index: 39, unit: 'mV', decimals: 0 },
    ],
  },

  // 11. 功能设置（11 项 / 3 列 × 4 行，末行 + 应用设置按钮）
  {
    title: '功能设置',
    order: 11,
    action: { label: '应用设置', fn: (g) => writeGroupBitmap(g, 29) },
    fields: [
      { label: '开关功能', key: 'cfg-sw', bitIndex: 29, bit: 0 },
      { label: '负载检测', key: 'cfg-load', bitIndex: 29, bit: 1 },
      { label: '均衡功能', key: 'cfg-bal', bitIndex: 29, bit: 2 },
      { label: '均衡方式', key: 'cfg-bal-mode', bitIndex: 29, bit: 3, customDisplay: 'balanceMode' },
      { label: 'LED', key: 'cfg-led', bitIndex: 29, bit: 4 },
      { label: 'LED数量', key: 'led-count', readOnly: true, note: '需协议补充' },
      { label: 'RTC', key: 'cfg-rtc', bitIndex: 29, bit: 5 },
      { label: 'FCC限制', key: 'cfg-fcc', bitIndex: 29, bit: 6 },
      { label: '充电握手', key: 'cfg-handshake', bitIndex: 29, bit: 7 },
      { label: 'GPS', key: 'cfg-gps', bitIndex: 29, bit: 8 },
      { label: '蜂鸣器续延', key: 'cfg-buzzer', bitIndex: 29, bit: 9 },
    ],
  },
  // 7. 检流电阻（独立模块：index 28；导入模板时不随下发）
  {
    title: '检流电阻',
    order: 7,
    cols: 1,
    fields: [
      { label: '检流阻值', index: 28, unit: 'mΩ', decimals: 2, step: 0.01, note: '独立配置', needPassword: true },
    ],
  },
]

type GroupObj = { title: string; cols?: number; action?: GroupAction; fields: FieldState[] }
const builtGroups: GroupObj[] = GROUP_DEFS.map((g) => ({ title: g.title, cols: g.cols, action: g.action, fields: g.fields.map(makeField) }))
// 出厂默认左右两列布局（用户拖拽确认后的顺序，已固化进代码）。
// 如需调整默认排布，直接改这里的标题顺序即可；GROUP_DEFS 中未列出的分组会自动补到右列末尾。
const defaultColumnOrder: [string[], string[]] = [
  ['基本设置', '电流设置', '保护参数', '温度探头配置', '检流电阻'],
  ['初始化设置', '容量电压', '温度设置', '功能设置', '系统设置', '均衡设置'],
]
function buildColumnsFromTitles(order: string[][]): GroupObj[][] {
  const pool = new Map(builtGroups.map((g) => [g.title, g]))
  const cols: GroupObj[][] = order.map((col) => {
    const arr: GroupObj[] = []
    for (const t of col) {
      const g = pool.get(t)
      if (g) { arr.push(g); pool.delete(t) }
    }
    return arr
  })
  for (const g of pool.values()) cols[cols.length - 1].push(g)
  return cols
}
const columns = ref<GroupObj[][]>(buildColumnsFromTitles(defaultColumnOrder))
// 兼容下游只读消费（字段汇总等）
const groups = computed(() => columns.value.flat())
const allFields = computed(() => groups.value.flatMap((g) => g.fields))
const dirtyCount = computed(() => allFields.value.filter((f) => f.dirty).length)

// ===== 参数搜索与分组折叠 =====
const searchText = ref('')
const collapsed = reactive<Record<string, boolean>>({})
function isCollapsed(t: string) { return !!collapsed[t] }
function toggleCollapse(t: string) { collapsed[t] = !collapsed[t] }
const allCollapsed = computed(() => columns.value.every((col) => col.every((g) => collapsed[g.title])))
function toggleCollapseAll() {
  const next = !allCollapsed.value
  for (const col of columns.value) for (const g of col) collapsed[g.title] = next
}
const matchCount = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return 0
  return allFields.value.filter((f) => (f.label || '').toLowerCase().includes(q)).length
})
// 搜索时按名称过滤字段并隐藏空分组；未搜索时原样返回（折叠由模板 v-if 处理）
const displayColumns = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return columns.value
  return columns.value.map((col) =>
    col
      .map((g) => ({ ...g, fields: g.fields.filter((f) => (f.label || '').toLowerCase().includes(q)) }))
      .filter((g) => g.fields.length > 0)
  )
})

// ====== 分组拖动排序（点击「拖动排序」进入拖动模式；左右两列各自可拖拽重排，也支持跨列移动；顺序持久化到 localStorage） ======
const DRAG_ORDER_KEY = 'jbd-param-group-order'
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
  columns.value = buildColumnsFromTitles(defaultColumnOrder)
  ElMessage.success('已恢复默认顺序')
}

// 字段行内「复位 MCU」按钮：与设备控制页 runControl(RESET_MCU) 同源，发送控制指令 0x03 0x00
async function confirmResetMcu() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  try {
    await ElMessageBox.confirm('确定要复位 MCU 吗？设备将重新启动。', '复位 MCU', { type: 'warning' })
  } catch {
    return // 用户取消
  }
  await jbdBus.send(buildControlCommand(CONTROL_FUNC.RESET_MCU))
  ElMessage.success('已发送复位 MCU 指令')
}

// ====== 工厂模式 ======
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

// ====== 读取/写入单个字段 ======
async function readField(f: FieldState): Promise<boolean> {
  if (!props.connected) return false
  // 不能读取：非 date/serialRaw 的 customDisplay、无 index 的 readOnly
  const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
  if ((f.customDisplay && !canReadCustomDisplay) || (f.readOnly && f.index === undefined)) {
    ElMessage.warning(`[${f.label}] 无可读取寄存器`)
    return false
  }
  f.status = 'reading'
  // 位开关：读一次位图，所有同位图字段同步
  if (isBitSwitch(f)) {
    jbdBus.send(buildReadParam(f.bitIndex!, 1))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    bitmaps.value[f.bitIndex!] = raw
    const peers = allFields.value.filter((x) => x.bitIndex === f.bitIndex)
    for (const p of peers) {
      p.value = ((raw >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
      p.status = 'ok'
    }
    return true
  }
  // ASCII 块：读 N 个寄存器
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    jbdBus.send(buildReadParam(f.index!, len))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) { f.status = 'fail'; return false }
    const text = parseAsciiResponse(resp, len * 2)
    f.value = text
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // date / serialRaw：读 raw 值，由 customDisplay 格式化
  if (canReadCustomDisplay && f.index !== undefined) {
    jbdBus.send(buildReadParam(f.index, 1))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    f.value = raw
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // 复合保护字段（scd）：高字节=保护值档位、低字节=延迟档位
  if (f.kind === 'scd') {
    jbdBus.send(buildReadParam(f.index!, 1))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    const { level, delay } = splitScd(raw)
    const peer = scdPeer(f)
    if (f.scdPart === 'level') f.value = level
    else f.value = delay
    if (peer) peer.value = f.scdPart === 'level' ? delay : level
    f.dirty = false
    f.status = 'ok'
    if (peer) { peer.dirty = false; peer.status = 'ok' }
    return true
  }
  // 下拉选项字段：value 直接存原始寄存器值
  if (f.options) {
    jbdBus.send(buildReadParam(f.index!, 1))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { f.status = 'fail'; return false }
    f.value = raw & 0xffff
    f.dirty = false
    f.status = 'ok'
    return true
  }
  // 普通数值
  jbdBus.send(buildReadParam(f.index!, 1))
  const resp = await jbdBus.onceResponse(1500, 0xfa)
  const raw = parseParamResponse(resp)
  if (raw === null) { f.status = 'fail'; return false }
  f.value = paramRawToDisplay(f.index!, raw)
  f.dirty = false
  f.status = 'ok'
  return true
}

/** 单个参数下发成功后：标记状态并弹出成功提示 */
function markWriteOk(f: FieldState): true {
  f.status = 'ok'
  f.dirty = false
  ElMessage.success(`写参数[${f.label}]成功`)
  return true
}

async function writeField(f: FieldState): Promise<boolean> {
  if (!canWrite(f)) return false
  f.status = 'writing'
  if (autoFactory.value && !inFactory.value) {
    const ok = await enterFactory()
    if (!ok) { f.status = 'fail'; return false }
  }
  // ASCII 字段：多寄存器写（ascii_len 个寄存器 → ascii_len*2 字节）
  if (f.ascii) {
    // 蓝牙名称：走专用修改指令 DD 5A A2 <len> <name...> <chk> 77（载荷 [长度][名称]，无填充，长度字段=名称长度+1）
    if (f.key === 'bt-name') {
      jbdBus.send(buildSetBtName(String(f.value ?? '')))
      const resp = await jbdBus.onceResponse(1500, 0xa2)
      if (autoFactory.value) await exitFactory()
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
        return false
      }
      return markWriteOk(f)
    }
    const bytes = encodeAsciiValue(f)
    jbdBus.send(buildWriteParam(f.index!, bytes))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    return markWriteOk(f)
  }
  // 复合保护字段（scd）：与 peer 合并成 16 位字再下发
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    const raw = combineScd(level, delay) & 0xffff
    jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    if (peer) { peer.status = 'ok'; peer.dirty = false }
    return markWriteOk(f)
  }
  // 下拉选项字段：value 即原始寄存器值，直接下发
  if (f.options) {
    const raw = Number(f.value ?? 0) & 0xffff
    jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    return markWriteOk(f)
  }
  // 普通数值字段
  // 检流阻值等需密码校验：先弹窗确认，密码不正确则中止下发
  if (f.needPassword) {
    const ok = await confirmPassword()
    if (!ok) {
      f.status = 'fail'
      ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
      return false
    }
  }
  const raw = paramDisplayToRaw(f.index!, f.value)
  jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
  const resp = await jbdBus.onceResponse(1500, 0xfa)
  if (autoFactory.value) await exitFactory()
  if (!resp || resp.timeout || resp.status !== 0x00) {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    return false
  }
  return markWriteOk(f)
}

// 计算去重后的「读取单元」：位开关共用同一寄存器（按 bitIndex 去重）、
// 重复 index 也只读一次；非 date/serialRaw 的 customDisplay、以及无 index 的只读项直接跳过。
// 这样「读取全部」对温度探头(16 路 NTC 共用寄存器 30)、功能设置(共用寄存器 29)等
// 位开关组只发一帧，避免对同一寄存器重复读取。
function planReadUnits(fields: FieldState[]): { units: FieldState[]; skip: number } {
  const seen = new Set<string>()
  const units: FieldState[] = []
  let skip = 0
  for (const f of fields) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) { skip++; continue }
    if (f.readOnly && f.index === undefined) { skip++; continue }
    const key = isBitSwitch(f) ? `bit:${f.bitIndex}` : `idx:${f.index}`
    if (seen.has(key)) continue
    seen.add(key)
    units.push(f)
  }
  return { units, skip }
}

async function readGroup(g: { title: string; fields: FieldState[] }) {
  if (!props.connected) return
  const { units, skip } = planReadUnits(g.fields)
  busy.value = true
  let ok = 0, fail = 0
  for (const f of units) {
    const r = await readField(f)
    if (r) ok++; else fail++
  }
  busy.value = false
  const tip = skip ? `（跳过 ${skip} 只读项）` : ''
  ElMessage[fail ? 'warning' : 'success'](`本组读取完成：${ok} 成功，${fail} 失败${tip}`)
}

// ====== 批量寄存器读取（0xFA，设备单帧读取上限约 56 寄存器，按连续段拆分）======
// 读取全部：把"实际用到的寄存器"按连续段（run）合并，每段最多 READ_CHUNK 个做一条 0xFA 批量读，
// 串口往返从逐寄存器(~150)降到个位数；若某段批量读失败（设备对较大 count 不稳），自动回退为该段内
// 逐寄存器单条读（parseParamResponse），兼顾速度与可靠性。两条路径均复用 readField 一致的解析。
// 实测：寄存器 0~55（count=56）单条批量读正常，故 READ_CHUNK 取 48（留余量，避免逼近设备上限）。
const READ_TIMEOUT = 1500
const READ_CHUNK = 48

/** 字段依赖的寄存器序号集合（用于按寄存器去重读取 / 失败定位） */
function fieldRegisters(f: FieldState): number[] {
  if (isBitSwitch(f)) return [f.bitIndex!]
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    const out: number[] = []
    for (let i = f.index!; i < f.index! + len; i++) out.push(i)
    return out
  }
  if (f.index === undefined) return []
  return [f.index]
}

/** 从 rawMap（regIndex -> 16 位原始值）回填单个字段，等价于 readField 的成功分支。
 *  bit 开关：更新共享位图并扇出到所有同位图字段；
 *  ASCII：把连续寄存器按大端拼回字节流再走 ASCII 解析；
 *  scd：拆分高低字节档位并同步 peer；其余按换算表回填。 */
function applyFieldFromRaw(f: FieldState, rawMap: Record<number, number>): boolean {
  if (isBitSwitch(f)) {
    const bi = f.bitIndex!
    if (rawMap[bi] === undefined) return false
    bitmaps.value[bi] = rawMap[bi]
    const peers = allFields.value.filter((x) => x.bitIndex === bi)
    for (const p of peers) {
      p.value = ((rawMap[bi] >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
      p.status = 'ok'
    }
    return true
  }
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    const bytes: number[] = []
    for (let i = f.index!; i < f.index! + len; i++) {
      const r = rawMap[i]
      if (r === undefined) return false
      bytes.push((r >> 8) & 0xff, r & 0xff)
    }
    const reg = f.index!
    const data = [(reg >> 8) & 0xff, reg & 0xff, len, ...bytes]
    f.value = parseAsciiResponse({ data, status: 0, cmd: 0xfa } as any, len * 2)
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (f.customDisplay === 'date' || f.customDisplay === 'serialRaw') {
    if (f.index === undefined || rawMap[f.index] === undefined) return false
    f.value = rawMap[f.index]
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (f.kind === 'scd') {
    const raw = rawMap[f.index!]
    if (raw === undefined) return false
    const { level, delay } = splitScd(raw)
    const peer = scdPeer(f)
    if (f.scdPart === 'level') f.value = level
    else f.value = delay
    if (peer) peer.value = f.scdPart === 'level' ? delay : level
    f.dirty = false
    f.status = 'ok'
    if (peer) { peer.dirty = false; peer.status = 'ok' }
    return true
  }
  if (f.options) {
    if (rawMap[f.index!] === undefined) return false
    f.value = rawMap[f.index!] & 0xffff
    f.dirty = false
    f.status = 'ok'
    return true
  }
  if (rawMap[f.index!] === undefined) return false
  f.value = paramRawToDisplay(f.index!, rawMap[f.index!])
  f.dirty = false
  f.status = 'ok'
  return true
}

/** 解析批量读响应：data = [startRegHi, startRegLo, count, v0Hi, v0Lo, ...]，
 * 校验 startReg/count 与请求一致后返回 startReg→raw 映射，否则返回 null（交由回退逻辑处理）。 */
function parseBatchResponse(resp: any, expectStart: number, expectCount: number): Record<number, number> | null {
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== 0xfa) return null
  if (!resp.data || resp.data.length < 3 + expectCount * 2) return null
  const startReg = (resp.data[0] << 8) | resp.data[1]
  const cnt = resp.data[2]
  if (startReg !== expectStart || cnt !== expectCount) return null
  const map: Record<number, number> = {}
  for (let i = 0; i < cnt; i++) {
    const off = 3 + i * 2
    map[startReg + i] = ((resp.data[off] << 8) | resp.data[off + 1]) & 0xffff
  }
  return map
}

async function readAll() {
  if (!props.connected) return
  busy.value = true
  progress.value = 0
  // 收集所有字段实际依赖的寄存器（去重）
  const regSet = new Set<number>()
  for (const f of allFields.value) {
    if (f.customDisplay && f.customDisplay !== 'date' && f.customDisplay !== 'serialRaw') continue
    if (f.readOnly && f.index === undefined) continue
    // ASCII 字段（蓝牙名称等）设备对大跨度批量读易返回错位数据，不参与批量收集，
    // 改为下方回填阶段逐字段走 readField 单读（与「读本组」同源，已验证可靠）。
    if (f.ascii) continue
    for (const r of fieldRegisters(f)) regSet.add(r)
  }
  if (!regSet.size) { busy.value = false; ElMessage.warning('没有可读取的参数'); return }
  const rawMap: Record<number, number> = {}
  const failedRegs = new Set<number>()
  // 仅读取实际用到的寄存器：先把去重后的寄存器按连续段（run）合并，再在每个 run 内按
  // READ_CHUNK 切分，每段一条批量 0xFA 读。这样既不读无关/可能无效的寄存器，又能吃满批量读。
  const regs = [...regSet].sort((a, b) => a - b)
  const chunks: { start: number; count: number }[] = []
  let i = 0
  while (i < regs.length) {
    let j = i + 1
    while (j < regs.length && regs[j] === regs[j - 1] + 1) j++
    const runStart = regs[i]
    const runLen = j - i
    for (let s = runStart; s < runStart + runLen; s += READ_CHUNK) {
      chunks.push({ start: s, count: Math.min(READ_CHUNK, runStart + runLen - s) })
    }
    i = j
  }
  let done = 0
  let batchHits = 0, fallbackChunks = 0
  for (const ch of chunks) {
    progress.value = Math.round((done / chunks.length) * 100)
    // 1) 尝试批量读：一次往返拿 READ_CHUNK 个寄存器
    jbdBus.send(buildReadParam(ch.start, ch.count))
    const resp = await jbdBus.onceResponse(READ_TIMEOUT, 0xfa)
    const batch = parseBatchResponse(resp, ch.start, ch.count)
    if (batch) {
      Object.assign(rawMap, batch)
      batchHits++
    } else {
      // 2) 回退：该块内逐寄存器单条读（与 readField 一致、已验证可靠）
      fallbackChunks++
      for (let r = ch.start; r < ch.start + ch.count; r++) {
        jbdBus.send(buildReadParam(r, 1))
        const rr = await jbdBus.onceResponse(READ_TIMEOUT, 0xfa)
        const raw = parseParamResponse(rr)
        if (raw === null) failedRegs.add(r)
        else rawMap[r] = raw
      }
    }
    done++
  }
  // 逐字段回填：仅依赖失败寄存器的字段标红，其余照常更新
  let ok = 0, fail = 0
  for (const f of allFields.value) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) continue // 派生展示（芯片类型/硬件版本/NTC 数/均衡模式），不参与 0xFA 读
    if (f.readOnly && f.index === undefined) continue
    // ASCII 字段：逐字段单读（readField），避免大跨度批量读的设备错位问题
    if (f.ascii) {
      const okRead = await readField(f)
      if (okRead) ok++; else { f.status = 'fail'; fail++ }
      continue
    }
    const fr = fieldRegisters(f)
    if (fr.some((r) => failedRegs.has(r))) { f.status = 'fail'; fail++; continue }
    if (applyFieldFromRaw(f, rawMap)) ok++
    else { f.status = 'fail'; fail++ }
  }
  progress.value = 100
  busy.value = false
  if (fail) ElMessage.warning(`读取全部失败：${fail} 个参数读取失败`)
  else ElMessage.success('读取全部成功')
}

async function writeAll() {
  if (!props.connected || !dirtyCount.value) return
  // 只下发可写字段；位图字段共享同一寄存器需合并
  const dirty = allFields.value.filter(
    (f) => f.dirty && !f.customDisplay && !f.readOnly && !isBitSwitch(f) && f.index !== undefined && !f.needPassword,
  )
  if (!dirty.length) return
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  for (let i = 0; i < dirty.length; i++) {
    progress.value = Math.round(((i) / dirty.length) * 100)
    const f = dirty[i]
    // 复合保护字段：只由 level part 代表整个寄存器合成下发，delay part 跳过
    if (f.kind === 'scd') {
      if (f.scdPart === 'delay') { f.status = 'ok'; continue }
      const peer = scdPeer(f)
      const peerVal = peer && peer.value != null ? Number(peer.value) : 0
      const selfVal = f.value != null ? Number(f.value) : 0
      const raw = combineScd(selfVal, peerVal) & 0xffff
      f.status = 'writing'
      jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
      const resp = await jbdBus.onceResponse(1500, 0xfa)
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        f.status = 'ok'; f.dirty = false; ok++
        if (peer) { peer.status = 'ok'; peer.dirty = false }
      }
      continue
    }
    f.status = 'writing'
    // ASCII 字段：多寄存器写（蓝牙名称走专用 0xA2 指令）
    if (f.ascii) {
      if (f.key === 'bt-name') {
        jbdBus.send(buildSetBtName(String(f.value ?? '')))
        const resp = await jbdBus.onceResponse(1500, 0xa2)
        if (!resp || resp.timeout || resp.status !== 0x00) {
          f.status = 'fail'; fail++
          ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
        } else {
          f.status = 'ok'; f.dirty = false
          ok++
        }
        continue
      }
      const bytes = encodeAsciiValue(f)
      jbdBus.send(buildWriteParam(f.index!, bytes))
      const resp = await jbdBus.onceResponse(1500, 0xfa)
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        f.status = 'ok'; f.dirty = false
        ok++
      }
      continue
    }
    // 下拉选项字段：value 即原始寄存器值
    if (f.options) {
      const raw = Number(f.value ?? 0) & 0xffff
      jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
      const resp = await jbdBus.onceResponse(1500, 0xfa)
      if (!resp || resp.timeout || resp.status !== 0x00) {
        f.status = 'fail'; fail++
        ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        f.status = 'ok'; f.dirty = false
        ok++
      }
      continue
    }
    // 普通数值字段
    // 检流阻值等需密码校验：先弹窗确认，密码不正确则中止该项下发
    if (f.needPassword) {
      const ok = await confirmPassword()
      if (!ok) {
        f.status = 'fail'; fail++
        ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
        continue
      }
    }
    const raw = paramDisplayToRaw(f.index!, f.value!)
    jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'; fail++
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    } else {
      f.status = 'ok'; f.dirty = false
      ok++
    }
  }
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`全部写入完成：${ok} 成功，${fail} 失败`)
}

// ====== 分组位图下发（用于功能设置/温度探头配置） ======
async function writeGroupBitmap(g: { title: string; fields: FieldState[] }, bitIndex: number) {
  if (!props.connected) return
  // 未读取过则先读取
  if (bitmaps.value[bitIndex] === null || bitmaps.value[bitIndex] === undefined) {
    jbdBus.send(buildReadParam(bitIndex, 1))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    const raw = parseParamResponse(resp)
    if (raw === null) { ElMessage.error(`读取位图[${bitIndex}]失败`); return }
    bitmaps.value[bitIndex] = raw
    const peers = allFields.value.filter((x) => x.bitIndex === bitIndex)
    for (const p of peers) {
      p.value = ((raw >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
    }
  }
  const dirty = g.fields.filter((f) => f.dirty && isBitSwitch(f))
  if (!dirty.length) {
    ElMessage.info(`[${g.title}] 没有需要下发的位开关`)
    return
  }
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  for (const f of dirty) {
    f.status = 'writing'
    const raw = bitmaps.value[bitIndex] ?? 0
    jbdBus.send(buildWriteParam(bitIndex, [(raw >> 8) & 0xff, raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'; fail++
      ElMessage.error(`写位图[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status?.toString(16)}`}`)
    } else {
      f.status = 'ok'; f.dirty = false; ok++
    }
  }
  if (autoFactory.value) await exitFactory()
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`[${g.title}] 位图下发完成：${ok} 成功，${fail} 失败`)
}

// ====== 导入 / 导出 ======
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
  if (!Array.isArray(rawList)) { ElMessage.error('配置文件格式不支持（需为 JBD 参数 JSON）'); return }
  const out: ImportedParam[] = []
  let skipped = 0
  const appliedFields = new Set<FieldState>() // 防止 SCD 同寄存器重复回填
  for (const item of rawList) {
    const index = Number(item?.index ?? item?.reg)
    const raw = Number(item?.raw ?? item?.value)
    if (!Number.isInteger(index) || index < 0 || index > 65535) continue
    if (!Number.isFinite(raw)) continue
    if (index === 28) { skipped++; continue }  // 检流电阻：独立模块，不随模板导入下发
    const r = ((Math.trunc(raw) & 0xffff) >>> 0) & 0xffff
    const def = fieldByIndex(index)
    if (!def) continue
    // SCD 拆分字段：从组合 raw 中还原 level + delay，分别回填到两个 UI 字段并生成两行预览
    if (def.kind === 'scd') {
      const { level, delay } = splitScd(r)
      const peer = scdPeer(def)
      // 在覆盖前捕获设备真实当前值（分别对应 level 和 delay 部分）
      const currentLevel = def.value ?? null
      const currentDelay = peer?.value ?? null
      // 回填 UI 字段
      if (!appliedFields.has(def)) {
        def.value = level; def.dirty = true; def.status = 'idle'
        appliedFields.add(def)
      }
      if (peer && !appliedFields.has(peer)) {
        peer.value = delay; peer.dirty = true; peer.status = 'idle'
        appliedFields.add(peer)
      }
      // 预览表生成两行（level + delay）
      out.push({ index, label: def.label, unit: def.unit || '', value: level, raw: r, current: currentLevel })
      out.push({ index, label: peer?.label || `${def.label}(延时)`, unit: peer?.unit || '', value: delay, raw: r, current: currentDelay })
      continue
    }
    // 普通（非 SCD）字段：原有逻辑
    const display = paramRawToDisplay(index, r)
    const current = def.value ?? null
    out.push({ index, label: item?.label || def.label || `寄存器[${index}]`, unit: item?.unit || def.unit || '', value: display, raw: r, current })
    def.value = display; def.dirty = true; def.status = 'idle'
  }
  if (!out.length) { ElMessage.error('未找到有效参数（请检查文件内容）'); return }
  importedParams.value = out
  importDialogVisible.value = true
  ElMessage.success(`已导入 ${out.length} 个参数（含 SCD 拆分行），可在预览中核对后下发`)
}

function clearImport() { importedParams.value = [] }

function currentParamValue(p: ImportedParam): string {
  if (p.current === null || p.current === undefined) return '—'
  return `${p.current} ${p.unit}`
}

// 下发值（配置文件）与设备当前值不同 → 需要高亮提示
function isSendDiff(p: ImportedParam): boolean {
  const c = p.current
  if (c === null || c === undefined) return false
  return Number(c) !== p.value
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
  const sent = new Set<number>() // 同一寄存器只写一次（SCD 的 level/delay 两行共享同一 raw）
  for (let i = 0; i < list.length; i++) {
    progress.value = Math.round((i / list.length) * 100)
    const p = list[i]
    if (sent.has(p.index)) { ok++; p.status = 'ok'; continue } // SCD 延时行：跳过写入，标记成功
    sent.add(p.index)
    jbdBus.send(buildWriteParam(p.index, [(p.raw >> 8) & 0xff, p.raw & 0xff]))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (!resp || resp.timeout || resp.status !== 0x00) { fail++; p.status = 'fail'; ElMessage.error(`写参数[${p.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`) }
    else { ok++; p.status = 'ok'; const f = fieldByIndex(p.index); if (f) { f.status = 'ok'; f.dirty = false } }
  }
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`一键下发完成：${ok} 成功，${fail} 失败`)
  importDialogVisible.value = false
}

// 构造与导出文件同构的配置对象（供「导出配置」与「存为模板」共用）
function buildExportData() {
  const params: any[] = []
  const emitted = new Set<number>() // SCD 寄存器只导出一次（level 部分携带组合 raw）
  for (const f of allFields.value) {
    if (f.value === null || f.index === undefined || f.customDisplay || f.readOnly || f.ascii || f.bitIndex !== undefined) continue
    // SCD 拆分字段：delay 部分跳过（与 level 共享同一寄存器，由 level 条目统一导出）
    if (f.kind === 'scd' && f.scdPart === 'delay') continue
    let raw: number
    let value: number
    if (f.kind === 'scd' && f.scdPart === 'level') {
      // SCD：把 level + delay 组合成完整 16 位 raw 导出，确保导入时能正确还原两部分
      const peer = scdPeer(f)
      const levelVal = f.value as number
      const delayVal = peer?.value ?? 0
      raw = combineScd(levelVal, delayVal) & 0xffff
      value = levelVal
      emitted.add(f.index)
    } else {
      raw = paramDisplayToRaw(f.index!, f.value as number)
      value = f.value as number
    }
    params.push({ index: f.index!, label: f.label, unit: f.unit || '', value, raw })
  }
  return { type: 'jbd-param-config', version: '1.0', exportedAt: new Date().toISOString(), params }
}

function exportConfig() {
  const data = buildExportData()
  if (!data.params.length) { ElMessage.warning('当前没有可导出的参数（请先读取或填写）'); return }
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
  ElMessage.success(`已导出 ${data.params.length} 个参数`)
}
</script>

<style scoped>
.param-config {
  height: 100%;
  min-height: 0;
  padding: var(--space-6);
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.param-config > * { min-width: 0; }

.sec { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.sec-h {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
  flex-wrap: wrap;
}
.sec-b { padding: var(--space-5); }
.panel-title { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.panel-title .el-icon { color: var(--brand); }
.header-actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.tip { font-size: var(--fs-caption); color: var(--text-tertiary); }
.progress-bar { padding: 0 var(--space-6); }

/* 左右两列容器布局：每列为独立纵向流，列内卡片自然堆叠；
   拖动模式下两列均为可放置区，支持列内重排与跨列移动 */
.groups {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
}
.group-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
@media (max-width: 1280px) {
  .groups { flex-direction: column; }
  .group-col { width: 100%; }
}
.group-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
}
/* 拖动排序模式：列高亮为可放置区 + 卡片可抓取视觉 */
.group-col.col-dragging {
  outline: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}
.group-card.is-dragging { cursor: grab; outline: 1px dashed var(--border-strong); }
.group-card.is-dragging:active { cursor: grabbing; }
.drag-handle { cursor: grab; color: var(--text-tertiary); margin-right: var(--space-2); align-self: center; }
.group-title { font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }

/* 分组内字段：3 列网格（可通过 cols 覆盖） */
.field-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
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
.field--full { grid-column: 1 / -1; }
.field.ok { box-shadow: inset 2px 0 0 var(--ok); }
.field.fail { box-shadow: inset 2px 0 0 var(--critical); }
/* 脏值标记（DESIGN 4.3）：左侧 2px 警告竖条 + 右上圆点 */
.field--dirty { box-shadow: inset 2px 0 0 var(--warning); }
.field--dirty::after {
  content: ''; position: absolute; top: 6px; right: 6px;
  width: 6px; height: 6px; border-radius: var(--radius-pill); background: var(--warning);
}
.field-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  margin-bottom: var(--space-3);
  min-height: 18px;
}
.field-label-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.field-row .unit {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  min-width: 28px;
  flex-shrink: 0;
}

.dot { width: 8px; height: 8px; border-radius: var(--radius-pill); display: inline-block; flex-shrink: 0; }
.dot.ok { background: var(--ok); }
.dot.fail { background: var(--critical); }

/* 只读 / 自定义展示字段 */
.field--ro { opacity: 0.85; }
.field--ro :deep(.el-input__inner) { background: var(--bg-raised); color: var(--text-secondary); cursor: not-allowed; }
.custom-val {
  display: inline-flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 24px;
  padding: 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--fs-body-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分组级位图下发按钮（应用设置 / 应用配置） */
.group-action {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: center;
}

/* 弹窗本身不滚动，改由表格内部滚动；表头 sticky 固定 */
.import-table {
  margin-top: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  max-height: 55vh;
  overflow-y: auto;
  overflow-x: hidden;
}
.import-row {
  display: grid;
  grid-template-columns: 80px 1.4fr 1.2fr 1.2fr 130px 80px;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-body-sm);
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
}
.import-row:last-child { border-bottom: none; }
.import-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-raised);
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.import-row.ok .c-status { color: var(--ok); }
.import-row.fail .c-status { color: var(--critical); }
.import-row .c-raw { font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; color: var(--text-secondary); }
.import-row .c-label { color: var(--text-primary); }
.import-row .c-value { color: var(--brand-text); font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; }
/* 下发值与设备当前值不同 → 高亮突出 */
.import-row .c-value.value-diff {
  color: var(--warning);
  font-weight: 600;
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-2);
  margin: 0 calc(var(--space-2) * -1);
}
.import-row .muted { color: var(--text-tertiary); }

/* ====== 导入配置模板列表弹窗 ====== */
.tpl-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-4) 0 var(--space-3);
}
.tpl-count { margin-left: auto; font-size: var(--fs-caption); color: var(--text-tertiary); }
.tpl-list {
  max-height: 52vh;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tpl-empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--fs-body-sm);
}
.tpl-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.tpl-item:hover { border-color: var(--border-strong); background: var(--bg-raised); }
.tpl-main { min-width: 0; flex: 1; }
.tpl-name {
  font-size: var(--fs-body-sm);
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-meta { font-size: var(--fs-caption); color: var(--text-tertiary); margin-top: 2px; }
.tpl-actions { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; }
/* ===== 参数搜索工具栏 & 分组折叠 ===== */
.pc-toolbar { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap; }
.pc-count { font-size: var(--fs-caption); color: var(--text-tertiary); }
.collapse-btn { margin-left: var(--space-1); padding: 2px 6px; color: var(--text-secondary); }
.collapse-btn:hover { color: var(--info); }
.sec-collapsed {
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}
</style>
