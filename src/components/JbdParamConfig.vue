<template>
  <div class="param-config">
    <!-- 顶部操作栏 -->
    <section class="panel sec">
      <header class="sec-h">
        <span class="panel-title"><el-icon><Setting /></el-icon> JBD 参数配置</span>
        <div class="header-actions">
          <StatusBadge :status="inFactory ? 'brand' : 'neutral'" :label="inFactory ? '工厂模式' : '普通模式'" />
          <el-button size="small" :disabled="!connected" :loading="busy" @click="readAll"><el-icon><Refresh /></el-icon> 读取全部</el-button>
          <el-button size="small" type="primary" :disabled="!connected || busy" :loading="busy" @click="writeAll"><el-icon><Upload /></el-icon> 全部写入({{ dirtyCount }})</el-button>
          <el-button size="small" type="warning" :disabled="!connected || busy" :loading="busy" @click="forceWriteAll"><el-icon><Promotion /></el-icon> 强制下发</el-button>
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
                <!-- 生产日期：日期选择器，可编辑下发（raw = 日|月<<5|(年-2000)<<9） -->
                <template v-else-if="f.customDisplay === 'date'">
                  <el-date-picker
                    :model-value="dateFromRaw(f.value)"
                    type="date"
                    size="small"
                    style="flex: 1"
                    placeholder="选择日期"
                    :disabled="!connected || f.status === 'reading'"
                    @update:model-value="(v: any) => onDateInput(f, v)"
                  />
                  <el-button
                    size="small"
                    type="primary"
                    :loading="f.status === 'writing'"
                    :disabled="!canWrite(f)"
                    @click="writeField(f)"
                  >下发</el-button>
                </template>
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
                    :disabled="(f.kind === 'scd' && !isChipScdKnown(j.chipType.value)) || !connected || f.status === 'reading'"
                    :placeholder="(f.kind === 'scd' && !isChipScdKnown(j.chipType.value)) ? '未知芯片，请先读取芯片类型' : ''"
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
                  :model-value="formatFieldValue(f)"
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
import { buildSetBtName, buildControlCommand, CONTROL_FUNC } from '@/jbd/jbd-protocol'
import {
  readRegs, readRegRaw, readRegMap, writeRegs, planReadChunks, decodeAsciiBytes,
  enterFactory as regEnterFactory, exitFactory as regExitFactory,
} from '@/jbd/jbd-reg-io'
import { paramRawToDisplay, paramDisplayToRaw, paramFormat, paramDisplayDecimals, splitScd, combineScd, scdProtectLabel, scdDelayLabelMs, scdDelayMaxIndex, isChipScdKnown } from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import { ui } from '@/store'
import { addDispatchRecord, type DispatchParam } from '@/db/dispatchLog'
import StatusBadge from './StatusBadge.vue'
import {
  buildColumnsFromTitles, defaultColumnOrder,
  type FieldState, type GroupObj, type GroupAction,
} from './param-config/groupDefs'
import { useParamTemplates } from './param-config/useParamTemplates'

const props = defineProps<{ connected: boolean }>()

type ImportStatus = 'ok' | 'fail' | undefined
interface ImportedParam {
  index: number; label: string; unit: string; value: number; raw: number; status?: ImportStatus
  current?: number | null  // 导入前设备上真实的当前值，用于与下发值比对
}
const importedParams = ref<ImportedParam[]>([])
const importDialogVisible = ref(false)

// ====== 本地配置模板（localStorage）：CRUD 逻辑拆至 useParamTemplates ======
// buildExportData / applyImport / onFileChange 为本组件内函数（声明提升，下方定义）
const {
  templates, templateDialogVisible,
  openTemplateDialog, importFromTemplate, onFileChangeFromDialog,
  saveAsTemplate, renameTemplate, deleteTemplate,
  formatTemplateDate: formatDate,
} = useParamTemplates({ buildExportData, applyImport, onFileChange })

function fieldByIndex(index: number): FieldState | undefined {
  return allFields.value.find((f) => f.index === index)
}

const autoFactory = ref(true)
const inFactory = ref(false)
const busy = ref(false)
const progress = ref(0)
const brandColor = '#1F6FE0'

const j = useJbd()

// ====== ASCII 解码：见 jbd-reg-io.decodeAsciiBytes（0xFA 多寄存器值字节 → 字符串） ======

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
  // 电池SN码：标准上位机取蓝牙名称块字符串（寄存器区唯一 ASCII 块，见 groupDefs 注释）
  if (f.customDisplay === 'sn') return btNameOf()
  // BMS版本号：标准上位机显示 0x03 固件版本号去掉小数点（"8.0" → 80），非寄存器 72 ASCII 块
  if (f.customDisplay === 'swVersion') {
    const v = j.basicInfo.value?.swVersion
    return v ? v.replace('.', '') : '—'
  }
  return '—'
}

/** 生产日期 raw ↔ Date：raw = 日(bit0~4) | 月<<5(bit5~8) | (年-2000)<<9(bit9~15) */
function dateFromRaw(raw: number | null): Date | null {
  if (raw === null || raw === undefined || raw === 0) return null
  const day = raw & 0x1f
  const month = (raw >> 5) & 0x0f
  const year = 2000 + ((raw >> 9) & 0x7f)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

function dateToRaw(d: Date): number {
  const day = d.getDate() & 0x1f
  const month = (d.getMonth() + 1) & 0x0f
  const year = Math.max(0, Math.min(0x7f, d.getFullYear() - 2000))
  return (day | (month << 5) | (year << 9)) & 0xffff
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
  // 生产日期：customDisplay 但可写（日期选择器 → raw → 下发）
  if (f.customDisplay === 'date' && f.index !== undefined) return f.value !== null
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

/** 数值字段输入：el-input type=number 回传字符串，转 number；空值置 null */
function onNumInput(f: FieldState, v: any) {
  if (v === '' || v === null || v === undefined) f.value = null
  else {
    const n = Number(v)
    if (!Number.isNaN(n)) f.value = n
  }
  f.dirty = true
}

/** 数值字段显示格式化：按字段 decimals（缺省按协议寄存器精度）四舍五入，并去除尾随零，
 * 消除浮点运算产生的脏尾数（如 4.2000000002、30.499999996）。仅影响显示，不改写 f.value 真值。 */
function formatFieldValue(f: FieldState): string {
  const v = f.value
  if (v === null || v === undefined || v === '') return ''
  const num = Number(v)
  if (Number.isNaN(num)) return String(v)
  const d = f.decimals ?? (f.index !== undefined ? paramDisplayDecimals(f.index) : 0)
  const s = num.toFixed(d)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
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
  // 芯片方案未知或无档位查表时下拉内容无意义：返回提示项，避免显示全 0.00A 误导用户
  // （见 useJbd 的 readChip 重读 + 重试逻辑）
  if (!isChipScdKnown(chip)) {
    return [{ label: '未知芯片方案，请先读取芯片类型', value: -1 }]
  }
  const shunt = shuntMOhm.value
  // 二级过流 = 寄存器 40；短路 = 寄存器 41
  const param: 'ocd' | 'scd' = f.index === 40 ? 'ocd' : 'scd'
  const fn: (i: number) => string = f.scdPart === 'delay'
    ? (i: number) => scdDelayLabelMs(param, chip, i)         // 延时统一 mS
    : (i: number) => scdProtectLabel(param, chip, i, shunt)   // 保护值统一显示电流(A)
  // delay 档位按芯片有效上界截断：避免用户选中设备不可写入的档（如集澈短路延时仅 0~3 有效），
  // 否则下发后设备清零 → 回读校验必败标红。
  const maxIdx = f.scdPart === 'delay' ? scdDelayMaxIndex(chip, param) : 15
  const out: { label: string; value: number }[] = []
  for (let i = 0; i <= maxIdx; i++) out.push({ label: fn(i), value: i })
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
// 密码本体只保存在 Electron 主进程（见 electron/main.ts 的 config:verifyDispatchPwd），
// 渲染层 bundle 不再携带明文常量（asar 解包也拿不到）。
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
async function onPwdConfirm() {
  const ok = await window.configAPI?.verifyDispatchPwd?.(pwdInput.value)
  if (!ok) {
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

/** 生产日期选择：Date → raw 存值并标脏 */
function onDateInput(f: FieldState, v: Date | null) {
  f.value = v ? dateToRaw(v) : null
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

// ====== 分组构建（字段/分组静态定义见 param-config/groupDefs.ts） ======
// 分组级位图下发动作需依赖组件内的连接状态与总线，故在此注入
const groupActions: Record<string, GroupAction> = {
  '温度探头配置': { label: '应用配置', fn: (g) => writeGroupBitmap(g, 30) },
  '功能设置': { label: '应用设置', fn: (g) => writeGroupBitmap(g, 29) },
}

const columns = ref<GroupObj[][]>(buildColumnsFromTitles(defaultColumnOrder, groupActions))
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

// 字段行内「复位 MCU」按钮：发送控制指令 0x03 0x00（原设备控制页 runControl(RESET_MCU) 同源逻辑）
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

// ====== 工厂模式（收发经 jbd-reg-io，统一超时 FRAME_TIMEOUT_MS） ======
async function enterFactory(): Promise<boolean> {
  if (!(await regEnterFactory())) {
    ElMessage.error('进入工厂模式失败: 超时或设备拒绝')
    return false
  }
  inFactory.value = true
  return true
}
async function exitFactory(): Promise<boolean> {
  if (!(await regExitFactory())) {
    ElMessage.error('退出工厂模式失败: 超时或设备拒绝')
    return false
  }
  inFactory.value = false
  return true
}

// ====== 读取/写入单个字段（收发统一走 jbd-reg-io，替代 send+onceResponse 重复模式） ======
async function readField(f: FieldState): Promise<boolean> {
  if (!props.connected) return false
  // 不能读取：非 date/serialRaw 的 customDisplay、无 index 的 readOnly
  const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
  if ((f.customDisplay && !canReadCustomDisplay) || (f.readOnly && f.index === undefined)) {
    ElMessage.warning(`[${f.label}] 无可读取寄存器`)
    return false
  }
  // scd / ASCII 字段读取前需先进工厂模式解锁（否则设备可能返回缓存旧值/空字节流）。
  // 仅在「当前不在工厂态」时临时进入、读完退出；若调用方（readAll / 批量校验）
  // 已统一进厂（inFactory=true），此处直接跳过，避免反复进出造成额外串口往返。
  let tmpFactory = false
  if (autoFactory.value && !inFactory.value && (f.kind === 'scd' || f.ascii)) {
    tmpFactory = await enterFactory()
  }
  const finish = async (okRead: boolean): Promise<boolean> => {
    if (tmpFactory && autoFactory.value) await exitFactory()
    return okRead
  }
  f.status = 'reading'
  // 位开关：读一次位图，所有同位图字段同步
  if (isBitSwitch(f)) {
    const raw = await readRegRaw(f.bitIndex!)
    if (raw === null) { f.status = 'fail'; return finish(false) }
    bitmaps.value[f.bitIndex!] = raw
    const peers = allFields.value.filter((x) => x.bitIndex === f.bitIndex)
    for (const p of peers) {
      p.value = ((raw >> (p.bit ?? 0)) & 1) === 1
      p.dirty = false
      p.status = 'ok'
    }
    return finish(true)
  }
  // ASCII 块：读 N 个连续寄存器并按「长度+字符」解码
  if (f.ascii) {
    const len = f.ascii_len ?? 8
    const r = await readRegs(f.index!, len)
    if (!r || r.reg !== f.index!) { f.status = 'fail'; return finish(false) }
    f.value = decodeAsciiBytes(r.values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]))
    f.dirty = false
    f.status = 'ok'
    return finish(true)
  }
  // date / serialRaw / scd / options / 普通数值：单寄存器读
  const raw = await readRegRaw(f.index!)
  if (raw === null) { f.status = 'fail'; return finish(false) }
  if (canReadCustomDisplay || f.options) {
    f.value = raw & 0xffff
  } else if (f.kind === 'scd') {
    const { level, delay } = splitScd(raw)
    const peer = scdPeer(f)
    if (f.scdPart === 'level') f.value = level
    else f.value = delay
    if (peer) {
      peer.value = f.scdPart === 'level' ? delay : level
      peer.dirty = false
      peer.status = 'ok'
    }
  } else {
    f.value = paramRawToDisplay(f.index!, raw)
  }
  f.dirty = false
  f.status = 'ok'
  return finish(true)
}

/** 单个参数下发成功后：标记状态并弹出成功提示 */
function markWriteOk(f: FieldState): true {
  f.status = 'ok'
  f.dirty = false
  ElMessage.success(`写参数[${f.label}]成功`)
  return true
}

// ====== 下发后自动回读校验 ======
// 触发：普通下发(writeField) 与 强制/全部下发(sendFields) 中每次字段写入成功后。
// 流程：写入前已捕获「期望值快照」→ 写入成功后自动发一次读取指令(readField，内建 1500ms 超时)
//      → 比较期望值与读取回来的数值是否一致；不一致/超时/读取失败 → 字段 status='fail'(行内标红)
//      + ElMessage.error 明确文案，便于定位问题。
// 回读复用已验证可靠的单参数逐读路径(readField)，规避设备对 ASCII 块(88~103)/scd 复合寄存器
// 大跨度批量读返回错位数据的问题；超时机制由 readField 的 onceResponse(1500, 0xfa) 提供。

export interface WriteExpect {
  /** 写入前捕获的期望「显示值」(数值/scd 档位/date/serialRaw) */
  display?: any
  /** 写入前捕获的期望 ASCII 文本（ascii 字段） */
  ascii?: string
  /** 写入前捕获的期望原始 16 位值（scd 组合 / options / 普通数值回退比对） */
  raw?: number
}

/** 捕获字段「写入前」的期望值快照，供写入成功后回读校验比对。
 *  必须在 send/write 指令发出之前调用（写入成功后 readField 会改写 f.value）。 */
function captureExpect(f: FieldState): WriteExpect {
  if (f.ascii) return { ascii: String(f.value ?? '') }
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    return { raw: combineScd(level, delay) & 0xffff }
  }
  if (f.options) return { raw: Number(f.value ?? 0) & 0xffff }
  // 普通数值 / date / serialRaw：保存显示值，比对时换算回 raw 再比，容忍展示精度误差
  if (f.index !== undefined) {
    const dv = paramDisplayToRaw(f.index, f.value)
    return { display: f.value, raw: dv & 0xffff }
  }
  return { display: f.value }
}

/** 把字段当前回读值解析为一个可比对的值（与 captureExpect 同口径） */
function currentExpectLike(f: FieldState): WriteExpect {
  if (f.ascii) return { ascii: String(f.value ?? '') }
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    return { raw: combineScd(level, delay) & 0xffff }
  }
  if (f.options) return { raw: Number(f.value ?? 0) & 0xffff }
  if (f.index !== undefined) {
    const dv = paramDisplayToRaw(f.index, f.value)
    return { display: f.value, raw: dv & 0xffff }
  }
  return { display: f.value }
}

/** 比对期望值与回读值；返回 null 表示一致，否则返回明确的异常描述。 */
function diffMessage(f: FieldState, exp: WriteExpect, got: WriteExpect): string | null {
  // 1) ASCII：直接比文本
  if (f.ascii) {
    const e = (exp.ascii ?? '').trim()
    const g = (got.ascii ?? '').trim()
    if (e === g) return null
    return `下发值与读取不一致：下发「${e}」 读取「${g}」（ASCII 参数）`
  }
  // 2) 其余：优先比 raw（规避浮点展示误差），再比 display
  const er = exp.raw
  const gr = got.raw
  if (er !== undefined && gr !== undefined && er !== gr) {
    return `下发值与读取不一致：下发 0x${er.toString(16).toUpperCase().padStart(4, '0')} 读取 0x${gr.toString(16).toUpperCase().padStart(4, '0')}`
  }
  // raw 缺失时回退比对显示值（数值型允许展示精度截断，故仅当差异超出 1e-6 才报）
  const ed = exp.display
  const gd = got.display
  if (ed !== undefined && gd !== undefined && typeof ed === 'number' && typeof gd === 'number') {
    if (Math.abs(Number(ed) - Number(gd)) > 1e-6) {
      return `下发值与读取不一致：下发 ${ed} 读取 ${gd}`
    }
  }
  return null
}

/** 下发成功后自动回读校验：
 *  - 先发一次读取指令(readField，内建 1500ms 超时)；超时/失败 → 视为校验未通过；
 *  - 比对期望值与读取值，不一致 → 行内标红(status='fail') + 明确错误提示；
 *  - 一致 → 保持 status='ok'，不额外打扰用户。
 * 注：readField 本身会把读取结果写回 f.value，故比对用的「回读值」取自 readField 之后的 f。 */
async function verifyField(f: FieldState, exp: WriteExpect): Promise<void> {
  // scd 复合字段：整寄存器由 level part 代表写入，校验失败需把 delay part(peer) 一并标红
  const peer = f.kind === 'scd' ? scdPeer(f) : undefined
  const failBoth = (msg: string) => {
    f.status = 'fail'
    f.dirty = true
    if (peer) { peer.status = 'fail'; peer.dirty = true }
    ElMessage.error(`校验失败[${f.label}]：${msg}`)
  }
  const passBoth = () => {
    f.status = 'ok'
    f.dirty = false
    if (peer) { peer.status = 'ok'; peer.dirty = false }
  }
  // scd 复合字段（寄存器 40 二级过流 / 41 短路，各 2 字节）：
  // 直接比对「整寄存器下发字节」与「整寄存器回读字节」，不做 splitScd 拆分比对。
  // 设备如实回写则整值相等 → 保护值档 + 延时档两个 part 自然都一致（整寄存器对得上）；
  // 整值不等才判校验失败，并把 level/delay 两个 part 一并标红，便于定位。
  if (f.kind === 'scd' && f.index !== undefined) {
    // scd 回读也重试 3 次（与非 scd 一致），吸收强制下发批量帧密集导致的偶发超时
    let okRead = await readField(f)
    if (!okRead) okRead = await readField(f)
    if (!okRead) okRead = await readField(f)
    if (!okRead) {
      failBoth('读取超时或无响应（设备未正确返回下发结果）')
      return
    }
    // readField 已把整寄存器回读值拆显到 f.value / peer.value（UI 显示档位），
    // 这里按 scdPart 位置重组出整寄存器值，与下发时的整寄存器值(exp.raw)直接比对。
    const selfGot = Number(f.value ?? 0)
    const peerGot = peer ? Number(peer.value ?? 0) : 0
    const gotRaw = f.scdPart === 'level'
      ? combineScd(selfGot, peerGot) & 0xffff   // self=level 高4位, peer=delay 低4位
      : combineScd(peerGot, selfGot) & 0xffff   // self=delay 低4位, peer=level 高4位
    if (gotRaw !== (exp.raw! & 0xffff)) {
      const eL = (exp.raw! >> 4) & 0x0f
      const eD = exp.raw! & 0x0f
      const gL = (gotRaw >> 4) & 0x0f
      const gD = gotRaw & 0x0f
      failBoth(`下发值与读取不一致：下发(整寄存器=0x${exp.raw!.toString(16).padStart(4, '0')} level=0x${eL.toString(16)} delay=0x${eD.toString(16)}) 读取(整寄存器=0x${gotRaw.toString(16).padStart(4, '0')} level=0x${gL.toString(16)} delay=0x${gD.toString(16)})`)
      return
    }
    passBoth()
    return
  }
  // 其余字段：复用 readField（已内建 1500ms 超时），失败重试两次吸收批量帧拥挤超时
  // ASCII 字段特殊处理：readField 回读可能把 f.value 覆写为空（parseAsciiResponse
  // 对 BMS 编码信息等大跨度 ASCII 块校验失败返回空串），故比对前保存用户原值，
  // 校验失败时只标红、并恢复 f.value 为用户原下发内容，避免界面显示为空。
  const savedValue = f.value
  let okRead = await readField(f)
  if (!okRead) okRead = await readField(f)
  if (!okRead) okRead = await readField(f)
  if (!okRead) {
    f.value = savedValue
    failBoth('读取超时或无响应（设备未正确返回下发结果）')
    return
  }
  const got = currentExpectLike(f)
  const diff = diffMessage(f, exp, got)
  if (diff) {
    f.value = savedValue
    failBoth(diff)
  } else {
    passBoth()
  }
}

/** 下发成功后标记 ok，并 await 回读校验（校验失败会翻红 field.status）。
 *  返回校验是否通过；await 使单字段下发按钮的 loading 覆盖到校验完成。 */
async function markWriteOkWithVerify(f: FieldState, exp: WriteExpect): Promise<boolean> {
  markWriteOk(f)
  await verifyField(f, exp)
  return f.status !== 'fail'
}

interface FieldWriteOutcome {
  ok: boolean
  /** 用户取消（密码弹窗取消等）——不算一次下发，不写入记录 */
  cancelled: boolean
  /** 写入成功但回读校验不一致 */
  verifyFail: boolean
}

/** 单字段下发执行（值快照与记录由外层 writeField 统一处理） */
async function writeFieldExec(f: FieldState): Promise<FieldWriteOutcome> {
  if (!canWrite(f)) return { ok: false, cancelled: true, verifyFail: false }
  // 写入前捕获期望值快照（校验用），必须在下发指令发出前完成
  const exp = captureExpect(f)
  f.status = 'writing'
  if (autoFactory.value && !inFactory.value) {
    if (!(await enterFactory())) { f.status = 'fail'; return { ok: false, cancelled: false, verifyFail: false } }
  }
  const fail = (): FieldWriteOutcome => {
    f.status = 'fail'
    ElMessage.error(`写参数[${f.label}]失败: 超时或设备拒绝（详见通信日志）`)
    return { ok: false, cancelled: false, verifyFail: false }
  }
  // ASCII 字段：多寄存器写（ascii_len 个寄存器 → ascii_len*2 字节）
  if (f.ascii) {
    // 蓝牙名称：专用修改指令 DD 5A A2 <len> <name...> <chk> 77（载荷 [长度][名称]）
    if (f.key === 'bt-name') {
      const resp = await jbdBus.sendAck(buildSetBtName(String(f.value ?? '')))
      if (autoFactory.value) await exitFactory()
      if (!resp || resp.timeout || resp.status !== 0x00) return fail()
      const verified = await markWriteOkWithVerify(f, exp)
      return { ok: true, cancelled: false, verifyFail: !verified }
    }
    const wrote = await writeRegs(f.index!, encodeAsciiValue(f))
    if (autoFactory.value) await exitFactory()
    if (!wrote) return fail()
    markWriteOk(f)
    return { ok: true, cancelled: false, verifyFail: false }
  }
  // 复合保护字段（scd）：与 peer 合并成 16 位字再下发
  if (f.kind === 'scd') {
    const peer = scdPeer(f)
    const peerVal = peer && peer.value != null ? Number(peer.value) : 0
    const selfVal = f.value != null ? Number(f.value) : 0
    const level = f.scdPart === 'level' ? selfVal : peerVal
    const delay = f.scdPart === 'delay' ? selfVal : peerVal
    const raw = combineScd(level, delay) & 0xffff
    const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
    if (autoFactory.value) await exitFactory()
    if (!wrote) return fail()
    if (peer) { peer.status = 'ok'; peer.dirty = false }
    markWriteOk(f)
    return { ok: true, cancelled: false, verifyFail: false }
  }
  // 下拉选项字段：value 即原始寄存器值，直接下发
  if (f.options) {
    const raw = Number(f.value ?? 0) & 0xffff
    const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
    if (autoFactory.value) await exitFactory()
    if (!wrote) return fail()
    markWriteOk(f)
    return { ok: true, cancelled: false, verifyFail: false }
  }
  // 普通数值字段
  // 检流阻值等需密码校验：先弹窗确认（校验在主进程），密码不正确则中止下发
  if (f.needPassword) {
    const ok = await confirmPassword()
    if (!ok) {
      f.status = 'fail'
      ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
      return { ok: false, cancelled: true, verifyFail: false }
    }
  }
  const raw = paramDisplayToRaw(f.index!, f.value)
  const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
  if (autoFactory.value) await exitFactory()
  if (!wrote) return fail()
  markWriteOk(f)
  return { ok: true, cancelled: false, verifyFail: false }
}

/** 单字段下发（模板「下发」按钮入口）：执行 + 写入下发记录 */
async function writeField(f: FieldState): Promise<boolean> {
  const snapshotValue = f.value
  const exp = captureExpect(f)
  const r = await writeFieldExec(f)
  if (!r.cancelled) {
    addDispatchRecord({
      opType: 'single',
      btName: btNameOf(),
      params: [{
        label: f.label,
        index: f.index,
        value: snapshotValue,
        raw: exp.raw,
        result: r.ok ? (r.verifyFail ? 'verifyFail' : 'ok') : 'fail',
      }],
      ...dispatchCtx(),
    })
  }
  return r.ok
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

/** BMS版本号（customDisplay swVersion）取自 0x03 基本信息帧；
 *  参数页本身不轮询 0x03，读取动作触发前补发一次（响应由 useJbd 单例帧订阅回填）。 */
function ensureBasicInfo() {
  if (props.connected && !j.basicInfo.value) j.readBasic()
}

async function readGroup(g: { title: string; fields: FieldState[] }) {
  if (!props.connected) return
  ensureBasicInfo()
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
// 读取全部：把"实际用到的寄存器"按连续段（run）合并，每段最多 READ_CHUNK 个做一条 0xFA 批量读
//（分段逻辑见 jbd-reg-io.planReadChunks），串口往返从逐寄存器(~150)降到个位数；
// 若某段批量读失败（设备对较大 count 不稳），自动回退为该段内逐寄存器单条读。
// 实测：寄存器 0~55（count=56）单条批量读正常，故 READ_CHUNK 取 48（留余量，避免逼近设备上限）。
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
    f.value = decodeAsciiBytes(bytes)
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

/** 解析批量读应答的职责已并入 jbd-reg-io（readRegMap 内建 reg/count 一致性校验）。 */

async function readAll() {
  if (!props.connected) return
  busy.value = true
  progress.value = 0
  // 默认第一条指令：先读取芯片类型。芯片方案决定二级过流/短路保护下拉的档位物理量，
  // 必须先于参数批量读，避免 SCD 选项因未知芯片而显示 0.00A 误导用户；同时每次读取全部
  // 都强制重读一遍，确保芯片方案是最新识别结果。
  j.chipType.value = null
  await j.readChip()
  ensureBasicInfo()
  // 收集所有字段实际依赖的寄存器（去重）。
  // ASCII 字段（蓝牙名称等）设备对大跨度批量读易返回错位数据；scd 复合保护字段
  // （寄存器 40/41）与相邻寄存器合并批量读会错位——两者均不走批量，改下方单读。
  const regSet = new Set<number>()
  for (const f of allFields.value) {
    if (f.customDisplay && f.customDisplay !== 'date' && f.customDisplay !== 'serialRaw') continue
    if (f.readOnly && f.index === undefined) continue
    if (f.ascii || f.kind === 'scd') continue
    for (const r of fieldRegisters(f)) regSet.add(r)
  }
  if (!regSet.size) { busy.value = false; ElMessage.warning('没有可读取的参数'); return }
  const rawMap: Record<number, number> = {}
  const failedRegs = new Set<number>()
  // 连续段合并批量读（每段 ≤ READ_CHUNK）；某段失败则回退为段内逐寄存器单读
  const chunks = planReadChunks([...regSet], READ_CHUNK)
  let done = 0
  for (const ch of chunks) {
    progress.value = Math.round((done / chunks.length) * 100)
    const batch = await readRegMap(ch.start, ch.count)
    if (batch) {
      Object.assign(rawMap, batch)
    } else {
      for (let r = ch.start; r < ch.start + ch.count; r++) {
        const raw = await readRegRaw(r)
        if (raw === null) failedRegs.add(r)
        else rawMap[r] = raw
      }
    }
    done++
  }
  // 逐字段回填：仅依赖失败寄存器的字段标红，其余照常更新
  let ok = 0, fail = 0
  const singles: FieldState[] = []
  for (const f of allFields.value) {
    const canReadCustomDisplay = f.customDisplay === 'date' || f.customDisplay === 'serialRaw'
    if (f.customDisplay && !canReadCustomDisplay) continue // 派生展示（芯片类型/硬件版本/NTC 数/均衡方式），不参与 0xFA 读
    if (f.readOnly && f.index === undefined) continue
    // ASCII / scd 复合保护字段：逐字段单读（readField），
    // 避免大跨度/跨边界批量读的设备错位问题（scd 单读与「读本组」同源，已验证可靠）。
    if (f.ascii || f.kind === 'scd') { singles.push(f); continue }
    const fr = fieldRegisters(f)
    if (fr.some((r) => failedRegs.has(r))) { f.status = 'fail'; fail++; continue }
    if (applyFieldFromRaw(f, rawMap)) ok++
    else { f.status = 'fail'; fail++ }
  }
  // ASCII / scd 单读阶段：统一进/出一次工厂模式。
  // 此前 readField 对每个此类字段各自「临时进厂→读→退厂」，11 个字段多出 20+ 次串口往返；
  // 统一进厂后 readField 内部检测到 inFactory=true 会跳过自身进出。
  if (singles.length) {
    let tmpFactory = false
    if (autoFactory.value && !inFactory.value) tmpFactory = await enterFactory()
    for (const f of singles) {
      const okRead = await readField(f)
      if (okRead) ok++; else { f.status = 'fail'; fail++ }
    }
    if (tmpFactory && autoFactory.value) await exitFactory()
  }
  progress.value = 100
  busy.value = false
  if (fail) ElMessage.warning(`读取全部失败：${fail} 个参数读取失败`)
  else ElMessage.success('读取全部成功')
}

// 把已导入模板涉及的字段重新标记为待下发（不改动其当前值），
// 供「全部写入」复用：即使未手动修改参数，也能把模板值原样重发一遍。
function markImportedDirty() {
  const seen = new Set<number>()
  for (const p of importedParams.value) {
    if (seen.has(p.index)) continue
    seen.add(p.index)
    for (const f of allFields.value.filter((x) => x.index === p.index)) f.dirty = true
  }
}

// ====== 下发记录（所有写设备的入口统一留痕，见 db/dispatchLog.ts） ======
/** 当前设备上下文：芯片类型 / 电池SN / 软件版本 / 串口，用于追溯“下发给哪块电池” */
function dispatchCtx() {
  const sn = btNameOf()
  return {
    chipTypeName: j.chipType.value != null ? j.chipTypeName.value : undefined,
    sn: sn !== '—' ? sn : undefined,
    swVersion: j.basicInfo.value?.swVersion || undefined,
    portPath: ui.portPath || undefined,
  }
}
/** 蓝牙名称（未读取时显示 —） */
function btNameOf(): string {
  const f = allFields.value.find((x) => x.key === 'bt-name')
  return f && f.value != null && String(f.value) !== '' ? String(f.value) : '—'
}

// 通用下发：对传入字段集合逐一下发，复用全部合成/密码/工厂逻辑。
// 调用方决定字段集合（脏字段、或全部已读字段），本函数不判断 dirty。
// 返回结果摘要（含逐参数下发/校验结果），供调用方写入下发记录。
interface SendSummary {
  ok: number
  fail: number
  verifyFail: number
  params: DispatchParam[]
}

async function sendFields(fields: FieldState[]): Promise<SendSummary> {
  if (!fields.length) return { ok: 0, fail: 0, verifyFail: 0, params: [] }
  busy.value = true
  let ok = 0, fail = 0
  // 收集写入成功的字段及其期望值快照，全部写完后统一批量/串行回读校验
  //（禁止在循环内并发触发 verifyField：多个字段的回读会互相抢帧，见 verifyQueueBatch）。
  const verifyQueue: { f: FieldState; exp: WriteExpect }[] = []
  // 下发记录条目：值在写入前快照，结果在写+校验全部完成后回填
  const entries: { f: FieldState; param: DispatchParam; wrote: boolean }[] = []
  if (autoFactory.value && !inFactory.value) {
    if (!(await enterFactory())) { busy.value = false; return { ok: 0, fail: 0, verifyFail: 0, params: [] } }
  }
  for (let i = 0; i < fields.length; i++) {
    progress.value = Math.round((i / fields.length) * 100)
    const f = fields[i]
    // 写入前捕获期望值快照（校验用），必须在下发指令发出前完成
    const exp = captureExpect(f)
    const writeFail = () => {
      f.status = 'fail'; fail++
      ElMessage.error(`写参数[${f.label}]失败: 超时或设备拒绝（详见通信日志）`)
    }
    // 复合保护字段：只由 level part 代表整个寄存器合成下发，delay part 跳过（不记录）
    if (f.kind === 'scd') {
      if (f.scdPart === 'delay') { f.status = 'ok'; continue }
      const peer = scdPeer(f)
      const peerVal = peer && peer.value != null ? Number(peer.value) : 0
      const selfVal = f.value != null ? Number(f.value) : 0
      const raw = combineScd(selfVal, peerVal) & 0xffff
      f.status = 'writing'
      const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
      if (!wrote) writeFail()
      else {
        ok++
        verifyQueue.push({ f, exp })
        if (peer) { peer.status = 'ok'; peer.dirty = false }
      }
      entries.push({ f, param: { label: f.label, index: f.index, value: selfVal, raw }, wrote })
      continue
    }
    f.status = 'writing'
    const entry = { f, param: { label: f.label, index: f.index, value: f.value, raw: exp.raw } as DispatchParam, wrote: false }
    // ASCII 字段：多寄存器写（蓝牙名称走专用 0xA2 指令）
    if (f.ascii) {
      let wrote: boolean
      if (f.key === 'bt-name') {
        const resp = await jbdBus.sendAck(buildSetBtName(String(f.value ?? '')))
        wrote = !!resp && !resp.timeout && resp.status === 0x00
      } else {
        wrote = await writeRegs(f.index!, encodeAsciiValue(f))
      }
      if (!wrote) writeFail()
      else { f.status = 'ok'; f.dirty = false; ok++; verifyQueue.push({ f, exp }) }
      entry.wrote = wrote
      entries.push(entry)
      continue
    }
    // 下拉选项字段：value 即原始寄存器值
    if (f.options) {
      const raw = Number(f.value ?? 0) & 0xffff
      const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
      if (!wrote) writeFail()
      else { ok++; verifyQueue.push({ f, exp }) }
      entry.wrote = wrote
      entries.push(entry)
      continue
    }
    // 普通数值字段；检流阻值等需密码校验：先弹窗确认（校验在主进程）
    if (f.needPassword) {
      const pwdOk = await confirmPassword()
      if (!pwdOk) {
        f.status = 'fail'; fail++
        ElMessage.warning(`写参数[${f.label}]已取消：密码校验未通过`)
        continue // 取消下发：不写入记录条目
      }
    }
    const raw = paramDisplayToRaw(f.index!, f.value!)
    const wrote = await writeRegs(f.index!, [(raw >> 8) & 0xff, raw & 0xff])
    if (!wrote) writeFail()
    else { f.status = 'ok'; f.dirty = false; ok++; verifyQueue.push({ f, exp }) }
    entry.wrote = wrote
    entries.push(entry)
  }
  if (autoFactory.value) await exitFactory()
  // 全部写完后统一回读校验（已退出工厂模式；verifyQueueBatch 内部按需再进）
  if (verifyQueue.length) await verifyQueueBatch(verifyQueue)
  // 回填下发结果：写失败 → fail；写成功但校验后 status=fail → verifyFail
  let verifyFail = 0
  for (const e of entries) {
    if (!e.wrote) { e.param.result = 'fail'; continue }
    if (e.f.status === 'fail') { e.param.result = 'verifyFail'; verifyFail++; continue }
    e.param.result = 'ok'
  }
  progress.value = 100
  busy.value = false
  ElMessage[fail || verifyFail ? 'warning' : 'success'](`参数下发完成：${ok} 成功，${fail + verifyFail} 失败/校验不一致`)
  return { ok, fail, verifyFail, params: entries.map((e) => e.param) }
}

/** 批量下发后的统一回读校验：
 *  - 普通数值/下拉字段：用与「读取全部」同源的分段批量读一次拿回全部涉及寄存器，
 *    与写入时捕获的期望 raw 整字比对（规避浮点展示误差）；批量读不到的寄存器
 *    再逐字段走 verifyField（内建 3 次重试）。N 个参数的回读从 N+ 次往返降到个位数。
 *  - ASCII / scd 字段：单字段 verifyField（读取需工厂模式，统一进/出一次）。 */
async function verifyQueueBatch(queue: { f: FieldState; exp: WriteExpect }[]): Promise<void> {
  const regulars = queue.filter(({ f }) => !f.ascii && f.kind !== 'scd' && f.index !== undefined)
  const others = queue.filter(({ f }) => f.ascii || f.kind === 'scd')
  if (regulars.length) {
    const regs = [...new Set(regulars.map(({ f }) => f.index!))]
    const chunks = planReadChunks(regs, READ_CHUNK)
    const rawMap: Record<number, number> = {}
    const missed = new Set<number>()
    for (const ch of chunks) {
      const batch = await readRegMap(ch.start, ch.count)
      if (batch) Object.assign(rawMap, batch)
      else {
        for (let r = ch.start; r < ch.start + ch.count; r++) {
          const raw = await readRegRaw(r)
          if (raw === null) missed.add(r)
          else rawMap[r] = raw
        }
      }
    }
    const retry: { f: FieldState; exp: WriteExpect }[] = []
    for (const { f, exp } of regulars) {
      const reg = f.index!
      const got = rawMap[reg]
      if (got === undefined || missed.has(reg)) { retry.push({ f, exp }); continue }
      const eraw = exp.raw !== undefined ? exp.raw & 0xffff : undefined
      if (eraw !== undefined && eraw !== (got & 0xffff)) {
        f.status = 'fail'
        f.dirty = true
        ElMessage.error(`校验失败[${f.label}]：下发 0x${eraw.toString(16).toUpperCase().padStart(4, '0')} 读取 0x${(got & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`)
      } else {
        f.status = 'ok'
        f.dirty = false
      }
    }
    for (const { f, exp } of retry) await verifyField(f, exp)
  }
  if (others.length) {
    let tmpFactory = false
    if (autoFactory.value && !inFactory.value) tmpFactory = await enterFactory()
    for (const { f, exp } of others) await verifyField(f, exp)
    if (tmpFactory && autoFactory.value) await exitFactory()
  }
}

async function writeAll() {
  if (!props.connected) return
  // 导入模板后无需手动修改：把已导入模板涉及的字段重新标记为待下发，
  // 这样「全部写入」在连接状态下始终可点，并能把模板值原样重发一遍（不依赖脏标记）。
  if (importedParams.value.length) markImportedDirty()
  if (!dirtyCount.value) { ElMessage.warning('暂无可下发的参数（请先导入模板或修改参数）'); return }
  // 只下发可写字段；位图字段共享同一寄存器需合并
  const dirty = allFields.value.filter(
    (f) => f.dirty && !f.customDisplay && !f.readOnly && !isBitSwitch(f) && f.index !== undefined && !f.needPassword,
  )
  if (!dirty.length) return
  const summary = await sendFields(dirty)
  if (summary.params.length) {
    addDispatchRecord({ opType: 'writeAll', btName: btNameOf(), params: summary.params, ...dispatchCtx() })
  }
}

// 强制下发：把当前已读取/已显示的字段值全部下发一遍，不依赖脏标记。
// 适用于「读出来后又想原样写回一遍」的场景（如参数被设备意外清零、或对照核验）。
async function forceWriteAll() {
  if (!props.connected) return
  const fields = allFields.value.filter(
    (f) => !f.customDisplay && !f.readOnly && !isBitSwitch(f) && f.index !== undefined && !f.needPassword,
  )
  if (!fields.length) { ElMessage.warning('暂无可下发的参数（请先读取设备参数）'); return }
  try {
    await ElMessageBox.confirm(
      `即将把当前读取到的 ${fields.length} 项参数原样全部下发到设备，覆盖设备现有参数。确定继续吗？`,
      '强制下发确认',
      { type: 'warning', confirmButtonText: '确定下发', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // 下发前重读芯片类型（不读参数、不动页面 f.value）：换电池不重连时 chipType 仍是
  // 上一台的缓存，会导致二级过流/短路下拉框用错档位表。重读确保档位解释对应当前电池，
  // 同时页面模板参数值保持不变，支持用同一套参数反复下发多组电池。
  j.chipType.value = null
  await j.readChip()
  ensureBasicInfo()
  const summary = await sendFields(fields)
  // 落地：把本次强制下发的参数快照与结果写入本地记录库
  //（时间 / 蓝牙名称 / 设备上下文 / 逐参数下发+校验结果）
  if (summary.params.length) {
    const rec = addDispatchRecord({ opType: 'force', btName: btNameOf(), params: summary.params, ...dispatchCtx() })
    ElMessage.info(`已记录本次强制下发到本地历史（${rec.okCount} 成功 / ${rec.failCount + rec.verifyFailCount} 失败）`)
  }
}

// ====== 分组位图下发（用于功能设置/温度探头配置） ======
async function writeGroupBitmap(g: { title: string; fields: FieldState[] }, bitIndex: number) {
  if (!props.connected) return
  // 未读取过则先读取
  if (bitmaps.value[bitIndex] === null || bitmaps.value[bitIndex] === undefined) {
    const raw = await readRegRaw(bitIndex)
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
  if (autoFactory.value && !inFactory.value) {
    if (!(await enterFactory())) { busy.value = false; return }
  }
  // 整组位图是同一个寄存器，只写一次（此前每个脏位开关重复下发同一帧）
  const raw = bitmaps.value[bitIndex] ?? 0
  const wrote = await writeRegs(bitIndex, [(raw >> 8) & 0xff, raw & 0xff])
  for (const f of dirty) {
    if (wrote) { f.status = 'ok'; f.dirty = false }
    else f.status = 'fail'
  }
  if (!wrote) ElMessage.error(`写位图[${g.title}]失败: 超时或设备拒绝`)
  if (autoFactory.value) await exitFactory()
  busy.value = false
  addDispatchRecord({
    opType: 'bitmap',
    btName: btNameOf(),
    params: dirty.map((f) => ({
      label: f.label,
      index: bitIndex,
      value: !!f.value,
      raw,
      result: wrote ? 'ok' : 'fail',
    })),
    ...dispatchCtx(),
  })
  ElMessage[wrote ? 'success' : 'warning'](`[${g.title}] 位图下发完成：${wrote ? dirty.length : 0} 成功，${wrote ? 0 : dirty.length} 失败`)
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
    const wrote = await writeRegs(p.index, [(p.raw >> 8) & 0xff, p.raw & 0xff])
    if (!wrote) { fail++; p.status = 'fail'; ElMessage.error(`写参数[${p.label}]失败: 超时或设备拒绝（详见通信日志）`) }
    else {
      ok++
      p.status = 'ok'
      // 同一寄存器可能对应多个 UI 字段（如 scd 的 level/delay 两部分共享寄存器 40/41），
      // 需一并标记为已下发，否则延时部分会残留"脏值"标记，看起来像没下发成功。
      for (const f of allFields.value.filter((x) => x.index === p.index)) {
        f.status = 'ok'
        f.dirty = false
      }
    }
  }
  if (autoFactory.value) await exitFactory()
  progress.value = 100
  busy.value = false
  addDispatchRecord({
    opType: 'import',
    btName: btNameOf(),
    params: list.map((p) => ({
      label: p.label,
      index: p.index,
      value: p.value,
      raw: p.raw,
      result: (p.status === 'fail' ? 'fail' : 'ok') as DispatchParam['result'],
    })),
    ...dispatchCtx(),
  })
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
