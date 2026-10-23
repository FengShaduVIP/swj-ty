<template>
  <div class="param-config">
    <!-- 顶部操作栏 -->
    <section class="panel sec">
      <header class="sec-h">
        <span class="panel-title"><el-icon><Setting /></el-icon> JBD 参数配置</span>
        <div class="header-actions">
          <StatusBadge :status="inFactory ? 'brand' : 'neutral'" :label="inFactory ? '工厂模式' : '普通模式'" />
          <el-button size="small" :disabled="!connected" :loading="busy" @click="readAll"><el-icon><Refresh /></el-icon> 读取全部</el-button>
          <el-button size="small" type="primary" :disabled="!dispatchAllowed || busy" :loading="busy" @click="writeAll"><el-icon><Upload /></el-icon> 全部写入({{ dirtyCount }})</el-button>
          <el-button size="small" type="warning" :disabled="!dispatchAllowed || busy" :loading="busy" @click="forceWriteAll"><el-icon><Promotion /></el-icon> 强制下发</el-button>
          <el-button size="small" @click="openTemplateDialog"><el-icon><FolderOpened /></el-icon> 导入配置</el-button>
          <span v-if="importedSourceName" class="import-source" :title="importedSourceName">
            <el-icon><Document /></el-icon>
            <span class="src-name">{{ importedSourceName }}</span>
            <el-icon class="src-clear" @click="importedSourceName = ''"><Close /></el-icon>
          </span>
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
          <span class="c-raw">{{ p.ascii !== undefined ? '—' : `0x${p.raw.toString(16).padStart(4, '0').toUpperCase()}` }}</span>
          <span class="c-status">
            <span v-if="p.status === 'ok'" class="dot ok" />
            <span v-else-if="p.status === 'fail'" class="dot fail" />
            <span v-else class="muted">待下发</span>
          </span>
        </div>
      </div>
      <template #footer>
        <el-button size="small" text :disabled="busy" @click="importDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :disabled="!dispatchAllowed || busy" :loading="busy" @click="sendAllImported">
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
      <div class="comm-strip" :class="{ empty: !commStrip.length }" title="实时通信日志">
        <div v-if="!commStrip.length" class="comm-empty">暂无通信日志</div>
        <div v-for="(l, i) in commStrip" :key="i" class="comm-line" :class="'log-' + l.type">
          <span class="c-time">{{ l.time }}</span>
          <span class="c-tag">{{ tagLabel(l.type) }}</span>
          <span class="c-text mono-font">{{ l.content }}</span>
        </div>
      </div>
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
                  :disabled="busy"
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
                <!-- 生产日期：弹窗选择日期 YYYY-MM-DD → 寄存器 raw（日|月<<5|(年-2000)<<9） -->
                <template v-else-if="f.customDisplay === 'date'">
                  <el-date-picker
                    :model-value="dateInputText(f)"
                    type="date"
                    size="small"
                    style="flex: 1"
                    format="YYYY-MM-DD"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    :clearable="false"
                    :disabled-date="disableOutOfRangeDate"
                    :disabled="!connected || busy || f.status === 'reading'"
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
                <!-- 只读字段：有 index 的显示设备真实值（如满充容量随标称容量镜像），无 index 的占位显示 — -->
                <span v-else-if="f.readOnly" class="custom-val mono">{{ f.index !== undefined && f.value != null ? formatFieldValue(f) + (f.unit ? ' ' + f.unit : '') : '—' }}</span>
                <!-- 下拉选项字段 / 复合保护字段(scd)：显示友好名称，下发原始 value -->
                <template v-else-if="f.options || f.kind === 'scd'">
                  <el-select
                    :model-value="f.value"
                    size="small"
                    style="flex: 1"
                    :disabled="(f.kind === 'scd' && !isChipScdKnown(j.chipType.value)) || !connected || busy || f.status === 'reading'"
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
                  :disabled="busy"
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
                  :disabled="!dispatchAllowed"
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
              :disabled="!dispatchAllowed"
              @click="g.action && writeGroupBitmap(g, g.action.bitIndex)"
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
import { Setting, Refresh, Upload, FolderOpened, Download, Files, Promotion, Rank, Operation, RefreshLeft, Delete, Edit, Search, ArrowDown, ArrowRight, Document, Close } from '@element-plus/icons-vue'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildWriteParam,
} from '@/jbd/jbd-protocol'
import { paramRawToDisplay, paramDisplayToRaw, paramFormat, paramDisplayDecimals, splitScd, combineScd, scdProtectLabel, scdDelayLabelMs, scdDelayMaxIndex, isChipScdKnown } from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import { canDispatchParameters } from '@/auth/auth'
import { shouldUploadDispatchResult } from '@/dispatch/uploadDecision'
import type { LogEntry } from '@/store'
import { useTemplates } from './param-config/useTemplates'
import { useGroupOrder } from './param-config/useGroupOrder'
import { buildColumnsFromTitles, defaultColumnOrder } from './param-config/groupDefs'
import {
  useDispatch, type RendererAuthSession,
} from './param-config/useDispatch'
import type { FieldState, GroupObj, ImportedParam } from './param-config/types'
import StatusBadge from './StatusBadge.vue'

interface CommLogEntry extends LogEntry {}
const props = defineProps<{
  connected: boolean
  logs?: CommLogEntry[]
  authSession: RendererAuthSession | null
}>()
// 工具栏紧凑通讯日志条：只保留最近 2 行，配合 CSS 末尾对齐实现自动滚动效果
const commStrip = computed(() => (props.logs || []).slice(-2))

// 后台登录状态由全局顶栏持有；本页面只根据它禁止/允许参数下发。
const dispatchAllowed = computed(() => canDispatchParameters(props.connected, props.authSession))

// ====== 下发/读取引擎（param-config/useDispatch.ts 共享单例，与产线下发页同源）======
// 密码校验走本页弹窗：needPassword 字段（检流阻值）单独下发时由引擎回调到这里
const {
  busy, progress, bitmaps, ntcCount,
  autoFactory, inFactory, enterFactory, exitFactory,
  ensureDispatchAllowed, canWrite,
  isBitSwitch, scdPeer, encodeAsciiValue, canBatchDispatch, injectFullChargeMirror,
  readField, readGroup, readAll,
  writeField, sendFields, writeGroupBitmap, forceWriteAll,
  confirmResetMcu, uploadDispatchSnapshot,
  bumpBusEpoch,
} = useDispatch({
  connected: () => props.connected,
  authSession: () => props.authSession,
  confirmPassword,
})
function tagLabel(type: string): string {
  return { send: '发送', recv: '接收', error: '错误', info: '信息' }[type] ?? type
}

const importedParams = ref<ImportedParam[]>([])
const importDialogVisible = ref(false)
// 当前已导入的来源名称（模板名或文件名），用于在主页面上提示用户选的是哪个
const importedSourceName = ref<string>('')

// ====== 本地配置模板（localStorage）：列表/存/删/导入（见 param-config/useTemplates.ts） ======
// 依赖的页面级回调（applyImport/onFileChange/buildExportData 均为函数声明，存在提升）
const {
  templates, templateDialogVisible, openTemplateDialog, importFromTemplate,
  onFileChangeFromDialog, saveAsTemplate, renameTemplate, deleteTemplate, formatDate,
} = useTemplates({
  buildExportData: () => buildExportData(),
  applyImport,
  onFileChange,
  setImportedSourceName: (name) => { importedSourceName.value = name },
})

function fieldByIndex(index: number): FieldState | undefined {
  return allFields.value.find((f) => f.index === index)
}

const j = useJbd()
const brandColor = '#1F6FE0'

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

/** 生产日期 raw ↔ Date：raw = 日(bit0~4) | 月<<5(bit5~8) | (年-2000)<<9(bit9~15) */
function dateToRaw(d: Date): number {
  const day = d.getDate() & 0x1f
  const month = (d.getMonth() + 1) & 0x0f
  const year = Math.max(0, Math.min(0x7f, d.getFullYear() - 2000))
  return (day | (month << 5) | (year << 9)) & 0xffff
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
// 检流电阻(mΩ)：取自「检流电阻」模块寄存器 28 字段的显示值（kind:'shunt' → mΩ）
const shuntMOhm = computed(() => {
  const f = allFields.value.find((x) => x.index === 28)
  const v = f?.value
  return typeof v === 'number' && v > 0 ? v : 0
})

// ====== 下发密码校验（仅检流阻值等 needPassword 字段） ======
// 密码常量存放于主进程（electron/main.ts），渲染层 bundle 不落明文；
// 这里只提交候选值由主进程比对，属于业务确认口令而非安全边界。
const pwdDialogVisible = ref(false)
const pwdInput = ref('')
const pwdError = ref('')
// Promise resolve 无需响应式：普通变量即可（还避免出现在 devtools 组件状态里）
let pwdResolve: ((ok: boolean) => void) | null = null

function confirmPassword(): Promise<boolean> {
  pwdInput.value = ''
  pwdError.value = ''
  pwdDialogVisible.value = true
  return new Promise((resolve) => { pwdResolve = resolve })
}
async function onPwdConfirm() {
  const ok = await window.bmsAPI?.verifyDispatchPwd(pwdInput.value)
  if (!ok) {
    pwdError.value = '密码错误，请重试'
    return
  }
  pwdDialogVisible.value = false
  pwdResolve?.(true)
  pwdResolve = null
}
function onPwdCancel() {
  pwdDialogVisible.value = false
  pwdResolve?.(false)
  pwdResolve = null
}

/** ASCII 字段输入：直接存字符串并标脏 */
function onAsciiInput(f: FieldState, v: any) {
  f.value = typeof v === 'string' ? v : ''
  f.dirty = true
}

/** raw → 日期串 YYYY-MM-DD（与 el-date-picker 的 value-format 对齐） */
function rawToDateStr(raw: number): string {
  const day = raw & 0x1f
  const month = (raw >> 5) & 0x0f
  const year = 2000 + ((raw >> 9) & 0x7f)
  if (!day || !month || year < 2000) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 日期选择器显示值：由已读取的 raw 推导 */
function dateInputText(f: FieldState): string {
  return f.value != null && f.value !== 0 ? rawToDateStr(f.value as number) : ''
}

/** 生产日期选择：YYYY-MM-DD → Date → raw 存值并标脏。越界 → 置空，禁止下发。 */
function onDateInput(f: FieldState, v: any) {
  const text = typeof v === 'string' ? v : ''
  if (!text) { f.value = null; f.dirty = true; return }
  const [y, m, d] = text.split('-').map(Number)
  if (y >= 2000 && y <= 2127 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    f.value = dateToRaw(new Date(y, m - 1, d))
    f.dirty = true
  } else {
    f.value = null
  }
}

/** 仅允许选择 2000-01-01 ~ 2127-12-31（寄存器年份为 7 bit，对应 2000~2127） */
function disableOutOfRangeDate(date: Date): boolean {
  return date < new Date(2000, 0, 1) || date > new Date(2127, 11, 31)
}

// ====== 分组布局：字段定义与默认列序在 param-config/groupDefs.ts，拖拽排序逻辑在 param-config/useGroupOrder.ts ======
const columns = ref<GroupObj[][]>(buildColumnsFromTitles(defaultColumnOrder))
const { dragMode, onDragStart, onDropGroup, onDropColumn, onDragEnd, resetToDefault } = useGroupOrder(columns, defaultColumnOrder)
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

async function writeAll() {
  if (!ensureDispatchAllowed()) return
  // 导入模板后无需手动修改：把已导入模板涉及的字段重新标记为待下发，
  // 这样「全部写入」在连接状态下始终可点，并能把模板值原样重发一遍（不依赖脏标记）。
  if (importedParams.value.length) markImportedDirty()
  if (!dirtyCount.value) { ElMessage.warning('暂无可下发的参数（请先导入模板或修改参数）'); return }
  // 只下发可写字段（含生产日期）；位图字段共享同一寄存器需合并
  const dirty = allFields.value.filter((f) => f.dirty && canBatchDispatch(f))
  if (!dirty.length) return
  await sendFields(injectFullChargeMirror(dirty))
}

// ====== 导入 / 导出 ======
function onFileChange(uploadFile: any) {
  const file = uploadFile?.raw as File | undefined
  if (!file) return
  importedSourceName.value = '文件：' + file.name
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
    // ASCII 块参数（如生产厂商信息）：以字符串回填并进入预览，不按 raw 数值解析
    if (typeof item?.ascii === 'string') {
      if (!Number.isInteger(index) || index < 0 || index > 65535) continue
      const def = fieldByIndex(index)
      if (!def?.ascii) continue
      const text = String(item.ascii)
      const current = typeof def.value === 'string' ? def.value : null
      out.push({ index, label: item?.label || def.label, unit: '', value: text, raw: 0, ascii: text, current })
      def.value = text; def.dirty = true; def.status = 'idle'
      continue
    }
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
  // ASCII 参数按字符串比较；数值参数按数值比较
  if (p.ascii !== undefined || typeof c === 'string') return String(c).trim() !== String(p.value).trim()
  return Number(c) !== p.value
}

async function sendAllImported() {
  if (!ensureDispatchAllowed()) return
  if (!importedParams.value.length) return
  // 批量操作接管总线：自增世代使单写下发遗留的后台回读校验（verifyField）静默退出，
  // 避免其 0xFA 读取与导入下发的帧互抢（与「读取全部/全部写入」同策略）
  bumpBusEpoch()
  busy.value = true
  let ok = 0, fail = 0
  if (autoFactory.value && !inFactory.value) {
    const entered = await enterFactory()
    if (!entered) { busy.value = false; return }
  }
  const nominalImport = importedParams.value.find((p) => p.index === 0)
  const list = [...importedParams.value]
  // 满充容量(112) 与 标称容量(0) 一致：导入含标称容量时，满充容量强制=标称容量一并下发
  // （模板已含满充容量则覆盖其值；不含则追加）。满充容量只读，不单独设置下发值。
  if (nominalImport) {
    const fullEntry = { ...nominalImport, index: 112, label: '满充容量', unit: 'Ah' }
    const fullIdx = list.findIndex((p) => p.index === 112)
    if (fullIdx >= 0) list[fullIdx] = fullEntry
    else list.push(fullEntry)
    const fullField = allFields.value.find((f) => f.index === 112)
    if (fullField) fullField.value = nominalImport.value
  }
  const sent = new Set<number>() // 同一寄存器只写一次（SCD 的 level/delay 两行共享同一 raw）
  for (let i = 0; i < list.length; i++) {
    progress.value = Math.round((i / list.length) * 100)
    const p = list[i]
    if (sent.has(p.index)) { ok++; p.status = 'ok'; continue } // SCD 延时行：跳过写入，标记成功
    sent.add(p.index)
    // ASCII 块参数（生产厂商信息）：多寄存器块写（ascii_len*2 字节，首字节为字符串长度）
    if (p.ascii !== undefined) {
      const af = allFields.value.find((x) => x.index === p.index && x.ascii)
      if (!af) { fail++; p.status = 'fail'; continue }
      const bytes = encodeAsciiValue(af)
      const resp = await jbdBus.sendAck(buildWriteParam(p.index, bytes))
      if (!resp || resp.timeout || resp.status !== 0x00) {
        fail++; p.status = 'fail'
        ElMessage.error(`写参数[${p.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`)
      } else {
        ok++; p.status = 'ok'
        af.status = 'ok'; af.dirty = false
      }
      continue
    }
    const resp = await jbdBus.sendAck(buildWriteParam(p.index, [(p.raw >> 8) & 0xff, p.raw & 0xff]))
    if (!resp || resp.timeout || resp.status !== 0x00) { fail++; p.status = 'fail'; ElMessage.error(`写参数[${p.label}]失败: ${resp?.timeout ? '超时' : `0x${resp?.status.toString(16)}`}`) }
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
  if (shouldUploadDispatchResult({ ok, fail })) await uploadDispatchSnapshot()
  busy.value = false
  ElMessage[fail ? 'warning' : 'success'](`一键下发完成：${ok} 成功，${fail} 失败`)
  importDialogVisible.value = false
}

// 构造与导出文件同构的配置对象（供「导出配置」与「存为模板」共用）
function buildExportData() {
  const params: any[] = []
  const emitted = new Set<number>() // SCD 寄存器只导出一次（level 部分携带组合 raw）
  for (const f of allFields.value) {
    if (f.value === null || f.index === undefined || f.customDisplay || f.readOnly || f.bitIndex !== undefined) continue
    // ASCII 块字段：仅生产厂商信息进模板（蓝牙名称走专用指令、其余只读）
    // 值为空串时跳过，避免导入时把设备上的厂商信息清空
    if (f.ascii) {
      if (f.key !== 'mfr') continue
      const text = String(f.value ?? '').trim()
      if (!text) continue
      params.push({ index: f.index, label: f.label, unit: '', value: text, ascii: text })
      continue
    }
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

/* 导入来源标签 */
.import-source {
  display: inline-flex; align-items: center; gap: var(--space-2);
  max-width: 280px; padding: 2px 4px 2px 8px;
  background: rgba(26, 115, 232, 0.10);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--fs-caption); color: var(--text-secondary);
  line-height: 1.4; white-space: nowrap;
}
.import-source .el-icon { color: var(--brand); font-size: 14px; flex: none; }
.import-source .src-name {
  max-width: 200px; overflow: hidden; text-overflow: ellipsis;
  font-weight: var(--fw-medium); color: var(--text-primary);
}
.import-source .src-clear { cursor: pointer; color: var(--text-tertiary); transition: color .15s; }
.import-source .src-clear:hover { color: var(--critical); }
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
/* 工具栏紧凑通讯日志条：高度对齐 small 按钮，固定 2 行、末端对齐实现自动滚动 */
.comm-strip {
  flex: 1 1 220px;
  min-width: 180px;
  height: 32px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  gap: 1px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  box-sizing: border-box;
}
.comm-strip.empty { justify-content: center; }
.comm-empty { font-size: var(--fs-caption); color: var(--text-tertiary); line-height: 30px; }
.comm-line {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 15px;
  line-height: 15px;
  font-size: var(--fs-num-xs);
  white-space: nowrap;
  overflow: hidden;
}
.comm-line .c-time {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums slashed-zero;
  flex-shrink: 0;
}
.comm-line .c-tag {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  font-size: var(--fs-micro);
  font-weight: var(--fw-semibold);
  line-height: 15px;
}
.comm-line .c-text { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; }
.comm-line.log-send .c-tag  { background: var(--brand-bg-subtle); color: var(--brand-text); }
.comm-line.log-recv .c-tag  { background: var(--ok-bg);           color: var(--ok); }
.comm-line.log-error .c-tag { background: var(--critical-bg);     color: var(--critical); }
.comm-line.log-info .c-tag  { background: var(--neutral-bg);      color: var(--neutral-state); }
.comm-line.log-error .c-text { color: var(--critical); }
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
