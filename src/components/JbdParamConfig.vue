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

    <!-- 分组表单：1 排 2 列布局（10 组，每组内字段 3 列网格） -->
    <div class="groups">
      <section v-for="g in groups" :key="g.title" class="panel sec group-card">
        <header class="sec-h">
          <span class="group-title">{{ g.title }}</span>
          <el-button size="small" text :disabled="!connected" style="margin-left:auto" @click="readGroup(g)"><el-icon><Refresh /></el-icon> 读本组</el-button>
        </header>
        <div class="sec-b">
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
      </section>
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
import { paramRawToDisplay, paramDisplayToRaw, paramFormat } from '@/jbd/jbd-params'
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
  // 第一字节为字符串长度（字符数），剩余字节中按该长度取字符
  const len = bytes[0]
  if (len > 0 && len < bytes.length) {
    return String.fromCharCode(...bytes.slice(1, 1 + len))
      .replace(/[^\x20-\x7E]/g, '')
      .trim()
  }
  // 无长度字节或长度为 0：把后续所有可打印字节当字符串
  return String.fromCharCode(...bytes.slice(1))
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
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

const GROUP_DEFS: { title: string; cols?: number; action?: GroupAction; fields: FieldDef[] }[] = [
  // 1. 基本设置（12 项 / 3 列 × 4 行）
  {
    title: '基本设置',
    fields: [
      { label: '蓝牙名称', key: 'bt-name', index: 88, ascii: true, ascii_len: 16 },
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
    fields: [
      { label: '充电过流保护', index: 24, unit: 'mA', decimals: 0, step: 10 },
      { label: '充电过流延时', index: 52, unit: 'S', decimals: 0 },
      { label: '充电过流释放延时', index: 53, unit: 'S', decimals: 0 },
      { label: '放电过流保护', index: 25, unit: 'mA', decimals: 0, step: 10 },
      { label: '放电过流延时', index: 54, unit: 'S', decimals: 0 },
      { label: '放电过流释放延时', index: 55, unit: 'S', decimals: 0 },
      { label: '二级过流保护延时', key: 'l2-oc-pd', index: 42, unit: '', decimals: 0, readOnly: true, note: '见IC' },
      { label: '二级过流延时', key: 'l2-oc-d', index: 42, unit: '', decimals: 0, readOnly: true, note: '见IC' },
      { label: '短路保护延时', key: 'sc-pd', readOnly: true, note: '需协议补充' },
      { label: '短路保护释放延时', index: 43, unit: 'S', decimals: 0 },
    ],
  },

  // 3. 容量电压（12 项 / 3 列 × 4 行）
  {
    title: '容量电压',
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
  // 4. 初始化设置（3 项 / 3 列 × 1 行）
  {
    title: '初始化设置',
    fields: [
      { label: '标称容量', index: 0, unit: 'Ah', decimals: 2, step: 0.01 },
      { label: '自放电率', key: 'self-disc', readOnly: true, note: '需协议补充' },
      { label: 'SOC的比例', key: 'soc-ratio', readOnly: true, note: '需协议补充' },
    ],
  },
  // 5. 系统设置（5 项 / 3 列 × 2 行）
  {
    title: '系统设置',
    fields: [
      { label: '均衡电流', key: 'bal-current-2', readOnly: true, note: '需协议补充' },
      { label: '休眠时间', index: 122, unit: 'S', decimals: 0 },
      { label: '容量修正间隔', index: 113, unit: 'S', decimals: 0 },
      { label: '序列号', index: 6, customDisplay: 'serialRaw', readOnly: true },
      { label: '循环次数', index: 7, unit: '次', decimals: 0 },
    ],
  },
  // 6. 均衡设置（2 项 / 3 列 × 1 行）
  {
    title: '均衡设置',
    fields: [
      { label: '均衡电流', key: 'bal-current', readOnly: true, note: '需协议补充' },
      { label: '均衡精度', index: 27, unit: 'mV', decimals: 0 },
    ],
  },
  // 7. 检流电阻（独立模块：index 28；导入模板时不随下发）
  {
    title: '检流电阻',
    cols: 1,
    fields: [
      { label: '检流阻值', index: 28, unit: 'mΩ', decimals: 2, step: 0.01, note: '独立配置' },
    ],
  },
  // 8. 温度设置（12 项 / 3 列 × 4 行）
  {
    title: '温度设置',
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
  // 9. 保护参数（14 项 / 3 列 × 5 行）
  {
    title: '保护参数',
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

  // 10. 功能设置（11 项 / 3 列 × 4 行，末行 + 应用设置按钮）
  {
    title: '功能设置',
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
  // 11. 温度探头配置（PDF：序号 30 = 温度探头配置，2 字节共 16 bit，每位对应一路探头使能 / 3 列 × 6 行 + 应用配置按钮）
  {
    title: '温度探头配置',
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
      { label: '温度探头_9',  key: 'probe-9',  bitIndex: 30, bit: 8  },
      { label: '温度探头_10', key: 'probe-10', bitIndex: 30, bit: 9  },
      { label: '温度探头_11', key: 'probe-11', bitIndex: 30, bit: 10 },
      { label: '温度探头_12', key: 'probe-12', bitIndex: 30, bit: 11 },
      { label: '温度探头_13', key: 'probe-13', bitIndex: 30, bit: 12 },
      { label: '温度探头_14', key: 'probe-14', bitIndex: 30, bit: 13 },
      { label: '温度探头_15', key: 'probe-15', bitIndex: 30, bit: 14 },
      { label: '温度探头_16', key: 'probe-16', bitIndex: 30, bit: 15 },
    ],
  },
]

const groups = ref(
  GROUP_DEFS.map((g) => ({
    title: g.title,
    cols: g.cols,
    action: g.action,
    fields: g.fields.map(makeField),
  })),
)
const allFields = computed(() => groups.value.flatMap((g) => g.fields))
const dirtyCount = computed(() => allFields.value.filter((f) => f.dirty).length)

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

async function writeField(f: FieldState): Promise<boolean> {
  if (!canWrite(f)) return false
  f.status = 'writing'
  if (autoFactory.value && !inFactory.value) {
    const ok = await enterFactory()
    if (!ok) { f.status = 'fail'; return false }
  }
  // ASCII 字段：多寄存器写（ascii_len 个寄存器 → ascii_len*2 字节）
  if (f.ascii) {
    const bytes = encodeAsciiValue(f)
    jbdBus.send(buildWriteParam(f.index!, bytes))
    const resp = await jbdBus.onceResponse(1500, 0xfa)
    if (autoFactory.value) await exitFactory()
    if (!resp || resp.timeout || resp.status !== 0x00) {
      f.status = 'fail'
      ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      return false
    }
    f.status = 'ok'
    f.dirty = false
    return true
  }
  // 普通数值字段
  const raw = paramDisplayToRaw(f.index!, f.value)
  jbdBus.send(buildWriteParam(f.index!, [(raw >> 8) & 0xff, raw & 0xff]))
  const resp = await jbdBus.onceResponse(1500, 0xfa)
  if (autoFactory.value) await exitFactory()
  if (!resp || resp.timeout || resp.status !== 0x00) {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
    return false
  }
  f.status = 'ok'
  f.dirty = false
  return true
}

async function readGroup(g: { title: string; fields: FieldState[] }) {
  if (!props.connected) return
  busy.value = true
  let ok = 0, fail = 0, skip = 0
  for (const f of g.fields) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) { skip++; continue }
    if (f.readOnly && f.index === undefined) { skip++; continue }
    const r = await readField(f)
    if (r) ok++; else fail++
  }
  busy.value = false
  const tip = skip ? `（跳过 ${skip} 只读项）` : ''
  ElMessage[fail ? 'warning' : 'success'](`本组读取完成：${ok} 成功，${fail} 失败${tip}`)
}

async function readAll() {
  if (!props.connected) return
  busy.value = true
  const fields = allFields.value
  let ok = 0, fail = 0, skip = 0
  for (let i = 0; i < fields.length; i++) {
    progress.value = Math.round(((i) / fields.length) * 100)
    const f = fields[i]
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) { skip++; continue }
    if (f.readOnly && f.index === undefined) { skip++; continue }
    const r = await readField(f)
    if (r) ok++; else fail++
  }
  progress.value = 100
  busy.value = false
  const tip = skip ? `（跳过 ${skip} 只读项）` : ''
  if (fail) ElMessage.warning(`全部读取完成：${ok} 成功，${fail} 失败${tip}`)
  else ElMessage.success(`全部读取成功${tip}`)
}

async function writeAll() {
  if (!props.connected || !dirtyCount.value) return
  // 只下发可写字段；位图字段共享同一寄存器需合并
  const dirty = allFields.value.filter(
    (f) => f.dirty && !f.customDisplay && !f.readOnly && !isBitSwitch(f) && f.index !== undefined,
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
    f.status = 'writing'
    // ASCII 字段：多寄存器写
    if (f.ascii) {
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
    // 普通数值字段
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
  for (const item of rawList) {
    const index = Number(item?.index ?? item?.reg)
    const raw = Number(item?.raw ?? item?.value)
    if (!Number.isInteger(index) || index < 0 || index > 65535) continue
    if (!Number.isFinite(raw)) continue
    if (index === 28) { skipped++; continue }  // 检流电阻：独立模块，不随模板导入下发
    const r = ((Math.trunc(raw) & 0xffff) >>> 0) & 0xffff
    const def = fieldByIndex(index)
    const display = def ? paramRawToDisplay(index, r) : r
    // 在 applyImport 覆盖 f.value 之前，先记录设备上的真实当前值
    const current = def ? def.value : null
    out.push({ index, label: item?.label || def?.label || `寄存器[${index}]`, unit: item?.unit || def?.unit || '', value: display, raw: r, current })
  }
  if (!out.length) { ElMessage.error('未找到有效参数（请检查文件内容）'); return }
  importedParams.value = out
  importDialogVisible.value = true
  for (const p of out) {
    const f = fieldByIndex(p.index)
    if (f) { f.value = p.value; f.dirty = true; f.status = 'idle' }
  }
  ElMessage.success(`已导入 ${out.length} 个参数，可在预览中核对后下发`)
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
  for (let i = 0; i < list.length; i++) {
    progress.value = Math.round((i / list.length) * 100)
    const p = list[i]
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

function exportConfig() {
  const params = allFields.value
    .filter((f) => f.value !== null && f.index !== undefined && !f.customDisplay && !f.readOnly && !f.ascii && f.bitIndex === undefined)
    .map((f) => ({ index: f.index!, label: f.label, unit: f.unit || '', value: f.value as number, raw: paramDisplayToRaw(f.index!, f.value as number) }))
  if (!params.length) { ElMessage.warning('当前没有可导出的参数（请先读取或填写）'); return }
  const data = { type: 'jbd-param-config', version: '1.0', exportedAt: new Date().toISOString(), params }
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

/* 1 排 2 列「瀑布流」布局：卡片按内容高度自然堆叠（column 流式），
   不再为对齐同行最高卡而拉伸，消除短卡片下方的空白间隙 */
.groups {
  column-count: 2;
  column-gap: var(--space-5);
}
@media (max-width: 1280px) {
  .groups { column-count: 1; }
}
.group-card {
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
  page-break-inside: avoid;
  margin-bottom: var(--space-5);
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
}
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
</style>
