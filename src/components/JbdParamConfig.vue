<template>
  <div class="param-config">
    <!-- 顶部操作栏 -->
    <section class="panel sec">
      <header class="sec-h">
        <span class="panel-title"><el-icon><Setting /></el-icon> JBD 参数配置</span>
        <div class="header-actions">
          <StatusBadge :status="inFactory ? 'brand' : 'neutral'" :label="inFactory ? '工厂模式' : '普通模式'" />
          <el-button size="small" :disabled="!connected" :loading="busy" @click="readAll()"><el-icon><Refresh /></el-icon> 读取全部</el-button>
          <el-button size="small" type="primary" :disabled="!dispatchAllowed || busy" :loading="busy" @click="writeAll"><el-icon><Upload /></el-icon> 全部写入({{ dirtyCount }})</el-button>
          <el-button size="small" type="warning" :disabled="!dispatchAllowed || busy" :loading="busy" @click="forceWriteAll()"><el-icon><Promotion /></el-icon> 强制下发</el-button>
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
                <!-- 检流阻值：密码解锁后才能改并单独下发（未解锁时只读） -->
                <el-button
                  v-if="f.needPassword"
                  size="small"
                  text
                  class="sense-lock"
                  :type="senseUnlocked ? 'success' : 'info'"
                  :title="senseUnlocked ? '已解锁：可修改后点「下发」单独写入 reg28（点击重新锁定）' : '已锁定：检流阻值需密码解锁后才能修改并单独下发'"
                  @click="toggleSenseLock"
                >
                  <el-icon><component :is="senseUnlocked ? Unlock : Lock" /></el-icon>
                </el-button>
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
                  :readonly="isFieldReadonly(f)"
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
                  @click="confirmResetMcu()"
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
/**
 * JBD 参数配置页 —— 底层读写链路照搬 SWJ 项目：
 *   读取：固定 9 段整包读（param-state.loadParams），读满 184 个寄存器；
 *   下发：整包 184 写（param-state.writeParams），进厂/退厂由参数层内部保证；
 *   强制下发：与「全部写入」等价（整包覆盖），仅多一层浮窗覆盖值处理。
 *
 * 数据源为 paramState.regs（184 槽寄存器镜像）。本文件里的 FieldState 已降级为
 * 「视图描述符 + 镜像访问器」：value 通过 Object.defineProperty 直接读写 regs/ascii，
 * 不再持有字段自身状态，也不再保留 dirty/status 状态机（恒为 false/'idle'）。
 */
import { ref, computed, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting, Refresh, Upload, FolderOpened, Download, Files, Promotion, Rank, Operation, RefreshLeft, Delete, Edit, Search, ArrowDown, ArrowRight, Document, Close, Lock, Unlock } from '@element-plus/icons-vue'
import { buildControlCommand, CONTROL_FUNC } from '@/jbd/jbd-protocol'
import { paramRawToDisplay, paramDisplayToRaw, paramFormat, paramDisplayDecimals, splitScd, combineScd, scdProtectLabel, scdDelayLabelMs, scdDelayMaxIndex, isChipScdKnown, CHIP_TYPES } from '@/jbd/jbd-params'
import { useJbd } from '@/jbd/useJbd'
import { canDispatchParameters, isAuthSessionValid, type AuthSession } from '@/auth/auth'
import { serialBus, waitRefreshIdle } from '@/jbd/serial-bus'
import {
  paramState, loadParams, writeParams, writeSegment,
  decodeAsciiBlock, encodeAsciiBlock, ASCII_BLOCKS, REG_COUNT, REG_SENSE,
} from '@/jbd/param-state'
import type { LogEntry } from '@/store'
import { useTemplates } from './param-config/useTemplates'
import { useGroupOrder } from './param-config/useGroupOrder'
import { buildColumnsFromTitles, defaultColumnOrder } from './param-config/groupDefs'
import type { FieldState, GroupObj, ImportedParam } from './param-config/types'
import StatusBadge from './StatusBadge.vue'

/**
 * 检流阻值（reg28）密码解锁 —— 照搬 SWJ ParamSettings。
 *
 * 检流阻值决定过流与短路电流的换算基准，改错会让保护阈值整体失真，
 * 因此默认只读；输入密码解锁后才能修改，并且只能用该字段自己的「下发」按钮
 * 单独写入（整包下发会跳过 reg28，见 param-state.writeParams）。
 */
const senseUnlocked = ref(false)
async function unlockSense(): Promise<void> {
  try {
    const res = await ElMessageBox.prompt(
      '检流阻值决定过流与短路电流的换算基准，改错会让保护阈值整体失真。请输入解锁密码：',
      '解锁检流阻值',
      {
        inputType: 'password',
        inputPlaceholder: '请输入密码',
        confirmButtonText: '解锁',
        cancelButtonText: '取消',
        inputValidator: (v: string) => (v && String(v).trim() ? true : '请输入密码'),
      },
    )
    const ok = await window.bmsAPI.verifyDispatchPwd(String(res.value).trim())
    if (!ok) {
      ElMessage.error('密码错误，无法解锁该参数')
      return
    }
    senseUnlocked.value = true
    ElMessage.success('检流阻值已解锁：可修改后用本字段的「下发」单独写入')
  } catch {
    /* 取消或关闭 */
  }
}
function toggleSenseLock(): void {
  if (senseUnlocked.value) {
    senseUnlocked.value = false
    ElMessage.info('已重新锁定检流阻值')
    return
  }
  void unlockSense()
}
/** 检流阻值未解锁时只读（模板用它禁用输入与下发按钮） */
function isSenseLocked(f: FieldState): boolean {
  return f.needPassword === true && !senseUnlocked.value
}

interface CommLogEntry extends LogEntry {}
const props = defineProps<{
  connected: boolean
  logs?: CommLogEntry[]
  authSession: RendererAuthSession | null
}>()
type RendererAuthSession = Pick<AuthSession, 'userId' | 'username' | 'expiresTime'>

const commStrip = computed(() => (props.logs || []).slice(-2))
const dispatchAllowed = computed(() => canDispatchParameters(props.connected, props.authSession))
const brandColor = '#1F6FE0'

/* ================= 字段描述表（值不再自持，全部投影到 paramState） ================= */
const columns = ref<GroupObj[][]>(buildColumnsFromTitles(defaultColumnOrder))
const { dragMode, onDragStart, onDropGroup, onDropColumn, onDragEnd, resetToDefault } = useGroupOrder(columns, defaultColumnOrder)
const groups = computed(() => columns.value.flat())
const allFields = computed(() => groups.value.flatMap((g) => g.fields))

function isBitSwitch(f: FieldState): boolean {
  return f.bitIndex !== undefined && f.bit !== undefined && f.customDisplay !== 'balanceMode'
}

function registerOf(f: FieldState): { start: number; count: number } | null {
  if (f.ascii) return { start: f.index!, count: f.ascii_len ?? 8 }
  if (isBitSwitch(f) || f.customDisplay === 'balanceMode') return { start: f.bitIndex!, count: 1 }
  if (f.index === undefined) return null
  return { start: f.index, count: 1 }
}

/** 从镜像读出该字段的显示值（等价于读设备回填后的算值） */
function readValue(f: FieldState): any {
  if (f.customDisplay === 'balanceMode') {
    const raw = paramState.regs[f.bitIndex!] ?? 0
    return ((raw >> f.bit!) & 1) === 1
  }
  if (f.customDisplay && f.customDisplay !== 'date' && f.customDisplay !== 'serialRaw') return undefined
  if (isBitSwitch(f)) {
    const raw = paramState.regs[f.bitIndex!] ?? 0
    return ((raw >> f.bit!) & 1) === 1
  }
  if (f.ascii) return paramState.ascii[f.index!] ?? ''
  if (f.index === undefined) return null
  const raw = paramState.regs[f.index] ?? 0
  if (f.kind === 'scd') {
    const { level, delay } = splitScd(raw)
    return f.scdPart === 'level' ? level : delay
  }
  if (f.options) return raw & 0xffff
  if (f.customDisplay === 'date' || f.customDisplay === 'serialRaw') return raw
  return paramRawToDisplay(f.index, raw)
}

/** 把界面输入写回镜像（不做下发，下发统一走整包） */
function writeValue(f: FieldState, v: any): void {
  if (f.customDisplay === 'balanceMode') {
    if (f.bitIndex === undefined || f.bit === undefined) return
    const cur = paramState.regs[f.bitIndex] ?? 0
    paramState.regs[f.bitIndex] = v ? cur | (1 << f.bit) : cur & ~(1 << f.bit)
    return
  }
  if (f.customDisplay && f.customDisplay !== 'date' && f.customDisplay !== 'serialRaw') return
  if (isBitSwitch(f)) {
    if (f.bitIndex === undefined || f.bit === undefined) return
    const cur = paramState.regs[f.bitIndex] ?? 0
    paramState.regs[f.bitIndex] = v ? cur | (1 << f.bit) : cur & ~(1 << f.bit)
    return
  }
  if (f.ascii) {
    paramState.ascii[f.index!] = typeof v === 'string' ? v : ''
    return
  }
  if (f.index === undefined) return
  if (f.kind === 'scd') {
    const raw = paramState.regs[f.index] ?? 0
    const { level, delay } = splitScd(raw)
    const next = f.scdPart === 'level'
      ? combineScd(Number(v) || 0, delay)
      : combineScd(level, Number(v) || 0)
    paramState.regs[f.index] = next & 0xffff
    return
  }
  if (f.options) {
    paramState.regs[f.index] = Number(v) & 0xffff
    return
  }
  if (v === null || v === undefined || v === '') return
  const n = Number(v)
  if (Number.isNaN(n)) return
  paramState.regs[f.index] = paramDisplayToRaw(f.index, n)
}

// 为每个字段安装 value 访问器：getter/setter 直接落到 184 槽镜像上
for (const g of columns.value.flat()) {
  for (const f of g.fields) {
    Object.defineProperty(f, 'value', {
      get() { return readValue(f) },
      set(v: any) { writeValue(f, v) },
      enumerable: true,
      configurable: true,
    })
    // 字段级状态机已移除：保留常量字段以兼容既有模板绑定
    f.dirty = false
    f.status = 'idle'
  }
}

/* ================= 运行态（全部来自参数层） ================= */
const busy = computed(() => paramState.busy)
const inFactory = computed(() => paramState.inFactory)
const progress = computed(() => {
  const p = paramState.progress
  if (!p.active || p.total <= 0) return 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})
/** 整包语义下「全部写入」的条数即镜像寄存器总数 */
const dirtyCount = computed(() => (paramState.paramsLoaded ? REG_COUNT : 0))

const j = useJbd()

/* ================= 浮窗进度同步 ================= */
const floatProgressActive = ref(false)
const floatProgressKind = ref<'read' | 'write'>('write')
let floatBusyOffTimer: number | undefined
function pushFloatProgress(busyNow: boolean, pct: number) {
  window.floatAPI?.pushProgress({ busy: busyNow, progress: pct, kind: floatProgressKind.value })
}
watch([busy, progress], ([b, p]) => {
  if (!floatProgressActive.value) return
  if (!b) {
    if (floatBusyOffTimer === undefined) {
      floatBusyOffTimer = window.setTimeout(() => {
        floatBusyOffTimer = undefined
        pushFloatProgress(false, progress.value)
      }, 300)
    }
    return
  }
  if (floatBusyOffTimer !== undefined) {
    clearTimeout(floatBusyOffTimer)
    floatBusyOffTimer = undefined
  }
  pushFloatProgress(true, p)
})
function beginFloatProgress(kind: 'read' | 'write') {
  floatProgressKind.value = kind
  floatProgressActive.value = true
  if (floatBusyOffTimer !== undefined) {
    clearTimeout(floatBusyOffTimer)
    floatBusyOffTimer = undefined
  }
  pushFloatProgress(true, 0)
}
function endFloatProgress() {
  if (!floatProgressActive.value) return
  floatProgressActive.value = false
  if (floatBusyOffTimer !== undefined) {
    clearTimeout(floatBusyOffTimer)
    floatBusyOffTimer = undefined
  }
  pushFloatProgress(false, progress.value)
}

/* ================= 权限与通知 ================= */
function screenNotifyWarning(message: string, fromFloat: boolean) {
  if (!fromFloat) return
  window.notifyAPI?.show({ title: '操作未执行', message, type: 'warning' })
}

function ensureDispatchAllowed(screenNotify = false): boolean {
  if (!props.connected) {
    ElMessage.warning('请先连接串口')
    screenNotifyWarning('请先连接串口', screenNotify)
    return false
  }
  if (!isAuthSessionValid(props.authSession)) {
    ElMessage.warning('请先登录后台，再下发参数')
    screenNotifyWarning('请先登录后台，再下发参数', screenNotify)
    return false
  }
  return true
}

function tagLabel(type: string): string {
  return { send: '发送', recv: '接收', error: '错误', info: '信息' }[type] ?? type
}

/* ================= 字段显示辅助 ================= */
const ntcCount = computed(() => {
  let v = paramState.regs[30] ?? 0
  let c = 0
  while (v) { c += v & 1; v >>>= 1 }
  return c
})
const chipType = computed(() => paramState.chipType || j.chipType.value || 0)
const shuntMOhm = computed(() => {
  const f = allFields.value.find((x) => x.index === 28)
  const v = f?.value
  return typeof v === 'number' && v > 0 ? v : 0
})

function customDisplayValue(f: FieldState): string {
  if (f.customDisplay === 'chipType') {
    return paramState.chipType ? (CHIP_TYPES[paramState.chipType] ?? String(paramState.chipType)) : (j.chipTypeName.value || '—')
  }
  if (f.customDisplay === 'hwVersion') return j.hwVersion.value || '—'
  if (f.customDisplay === 'ntcCount') return String(ntcCount.value)
  if (f.customDisplay === 'date' && f.value !== null && f.value !== undefined) return paramFormat(5, f.value)
  if (f.customDisplay === 'serialRaw' && f.value !== null && f.value !== undefined) {
    return '0x' + ((f.value & 0xffff).toString(16).toUpperCase().padStart(4, '0'))
  }
  return '—'
}

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
/** 输入控件是否只读：含检流阻值的密码锁定态 */
function isFieldReadonly(f: FieldState): boolean {
  return isReadOnly(f) || isSenseLocked(f)
}

function shouldShowUnit(f: FieldState): boolean {
  if (f.ascii) return false
  if (f.bitIndex !== undefined) return false
  if (f.customDisplay) return false
  if (f.readOnly) return false
  return !!f.unit
}

function canWrite(f: FieldState): boolean {
  if (!dispatchAllowed.value) return false
  if (busy.value) return false
  if (f.readOnly) return false
  // 检流阻值：需密码解锁后才能单独下发
  if (isSenseLocked(f)) return false
  if (f.customDisplay === 'date' && f.index !== undefined) return f.value !== null
  if (f.customDisplay) return false
  if (isBitSwitch(f)) return false
  if (f.ascii) return f.index !== undefined && typeof f.value === 'string'
  return f.value !== null && f.index !== undefined
}

function formatFieldValue(f: FieldState): string {
  const v = f.value
  if (v === null || v === undefined || v === '') return ''
  const num = Number(v)
  if (Number.isNaN(num)) return String(v)
  const d = f.decimals ?? (f.index !== undefined ? paramDisplayDecimals(f.index) : 0)
  const s = num.toFixed(d)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/* ================= 输入处理（只改镜像，不下发） ================= */
function onBitChange(_f: FieldState) {
  // v-model 的 setter 已把位写入镜像，这里无需再处理
}
function onBalanceModeChange(f: FieldState, val: any) {
  f.value = val === 'charge'
}
function onNumInput(f: FieldState, v: any) {
  if (v === '' || v === null || v === undefined) return
  const n = Number(v)
  if (!Number.isNaN(n)) f.value = n
}
function onSelectChange(f: FieldState, v: any) {
  f.value = Number(v)
}
function onAsciiInput(f: FieldState, v: any) {
  f.value = typeof v === 'string' ? v : ''
}
function rawToDateStr(raw: number): string {
  const day = raw & 0x1f
  const month = (raw >> 5) & 0x0f
  const year = 2000 + ((raw >> 9) & 0x7f)
  if (!day || !month || year < 2000) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function dateInputText(f: FieldState): string {
  return f.value != null && f.value !== 0 ? rawToDateStr(f.value as number) : ''
}
function onDateInput(f: FieldState, v: any) {
  const text = typeof v === 'string' ? v : ''
  if (!text) return
  const [y, m, d] = text.split('-').map(Number)
  if (y >= 2000 && y <= 2127 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    f.value = dateToRaw(new Date(y, m - 1, d))
  }
}
function disableOutOfRangeDate(date: Date): boolean {
  return date < new Date(2000, 0, 1) || date > new Date(2127, 11, 31)
}

/* ================= 复合保护字段（scd） ================= */
function scdOptions(f: FieldState): { label: string; value: number }[] {
  const chip = chipType.value
  if (!isChipScdKnown(chip)) return [{ label: '未知芯片方案，请先读取芯片类型', value: -1 }]
  const shunt = shuntMOhm.value
  const param: 'ocd' | 'scd' = f.index === 40 ? 'ocd' : 'scd'
  const fn: (i: number) => string = f.scdPart === 'delay'
    ? (i: number) => scdDelayLabelMs(param, chip, i)
    : (i: number) => scdProtectLabel(param, chip, i, shunt)
  const maxIdx = f.scdPart === 'delay' ? scdDelayMaxIndex(chip, param) : 15
  const out: { label: string; value: number }[] = []
  for (let i = 0; i <= maxIdx; i++) out.push({ label: fn(i), value: i })
  return out
}
function scdPeer(f: FieldState): FieldState | undefined {
  return allFields.value.find((x) => x.index === f.index && x.kind === 'scd' && x.scdPart !== f.scdPart)
}

/* ================= 镜像回填 ================= */
function applyWords(start: number, words: number[]): void {
  for (let i = 0; i < words.length; i++) paramState.regs[start + i] = words[i] & 0xffff
  const blk = ASCII_BLOCKS.find((a) => a.start === start)
  if (blk) {
    paramState.asciiRaw[start] = words.slice()
    paramState.ascii[start] = decodeAsciiBlock(words)
  }
}

/* ================= 读取：整包 9 段 ================= */
async function readAll(opts?: { fromFloat?: boolean }): Promise<void> {
  const fromFloat = opts?.fromFloat === true
  if (!props.connected) {
    ElMessage.warning('请先连接串口')
    screenNotifyWarning('请先连接串口', fromFloat)
    return
  }
  if (fromFloat) beginFloatProgress('read')
  try {
    const ok = await loadParams()
    if (ok) {
      ElMessage.success('读取参数完成')
      syncFloatFieldValues()
    } else {
      ElMessage.error(`读取参数失败：${paramState.lastError}`)
      screenNotifyWarning(`读取参数失败：${paramState.lastError}`, fromFloat)
    }
  } finally {
    if (fromFloat) endFloatProgress()
  }
}

/** SWJ 范式只有整包读取，「读本组」按整包执行 */
async function readGroup(_g: { title: string; fields: FieldState[] }): Promise<void> {
  await readAll()
}

/* ================= 下发：整包 184 写 ================= */
async function doWriteAll(label: string, fromFloat = false): Promise<boolean> {
  if (!paramState.paramsLoaded) {
    const msg = '请先「读取参数」，确认设备当前值后再写入'
    ElMessage.warning(msg)
    screenNotifyWarning(msg, fromFloat)
    return false
  }
  if (fromFloat) beginFloatProgress('write')
  try {
    // 检流阻值不随整包下发：页面上有改动时先说明它会被保留为设备原值
    if (paramState.senseRaw != null && (paramState.regs[REG_SENSE] ?? 0) !== paramState.senseRaw) {
      ElMessage.info('检流阻值已按设备原值保留，不随本次下发写入；如需修改请解锁后单独下发')
    }
    const ok = await writeParams(paramState.regs, paramState.ascii)
    if (ok) {
      ElMessage.success(`${label}完成`)
      syncFloatFieldValues()
    } else {
      ElMessage.error(`${label}失败：${paramState.lastError}`)
      screenNotifyWarning(`${label}失败：${paramState.lastError}`, fromFloat)
    }
    return ok
  } finally {
    if (fromFloat) endFloatProgress()
  }
}

async function writeAll(): Promise<void> {
  if (!ensureDispatchAllowed()) return
  await doWriteAll('全部写入')
}

/**
 * 强制下发：整包覆盖设备参数（与「全部写入」同一底层链路）。
 * overrides 由浮窗触发时传入，先覆盖镜像里的蓝牙名称/BMS编码再整包写。
 */
async function forceWriteAll(
  overrides?: { btName?: string; bmsCode?: string },
  opts?: { skipConfirm?: boolean },
): Promise<void> {
  if (!ensureDispatchAllowed(opts?.skipConfirm)) return
  const fromFloat = opts?.skipConfirm === true
  const btV = (overrides?.btName ?? '').trim()
  const codeV = (overrides?.bmsCode ?? '').trim()
  if (btV) paramState.ascii[88] = btV.slice(0, 31)
  if (codeV) paramState.ascii[72] = codeV.slice(0, 31)
  if (!opts?.skipConfirm) {
    try {
      await ElMessageBox.confirm(
        `即将把 ${REG_COUNT} 项寄存器整包下发到设备，覆盖设备现有参数。确定继续吗？`,
        '强制下发确认',
        { type: 'warning', confirmButtonText: '确定下发', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  await doWriteAll('强制下发', fromFloat)
}

/** 单字段下发：走单段写（进厂 → 写 → 回读纠偏 → 退厂），不动其余寄存器 */
async function writeField(f: FieldState): Promise<boolean> {
  if (!ensureDispatchAllowed()) return false
  // 未读取过设备值时镜像全是 0，单字段下发改的是「镜像里的当前值」，必须先读一次
  if (!paramState.paramsLoaded) {
    ElMessage.warning('请先「读取参数」，确认设备当前值后再下发')
    return false
  }
  if (!canWrite(f)) return false
  const reg = registerOf(f)
  if (!reg) { ElMessage.warning(`[${f.label}] 无可写寄存器`); return false }
  let words: number[]
  if (f.ascii) {
    words = encodeAsciiBlock(String(f.value ?? ''), reg.count)
  } else {
    words = [paramState.regs[reg.start] ?? 0]
  }
  const ok = await writeSegment(reg.start, words, f.label, (w) => applyWords(reg.start, w))
  if (ok) {
    ElMessage.success(`写参数[${f.label}]成功`)
    syncFloatFieldValues()
  } else {
    ElMessage.error(`写参数[${f.label}]失败：${paramState.lastError}`)
  }
  return ok
}

/** 分组级位图下发：把该位图寄存器当前值单独写入 */
async function writeGroupBitmap(g: { title: string; fields: FieldState[] }, bitIndex: number): Promise<void> {
  if (!ensureDispatchAllowed()) return
  const words = [paramState.regs[bitIndex] ?? 0]
  const ok = await writeSegment(bitIndex, words, g.title, (w) => applyWords(bitIndex, w))
  if (ok) ElMessage.success(`${g.title}已下发`)
  else ElMessage.error(`${g.title}下发失败：${paramState.lastError}`)
}

/** 浮窗单参数下发入口（蓝牙名称 / BMS 编码信息） */
async function dispatchSingleField(key: string, label: string, value?: string): Promise<void> {
  if (!ensureDispatchAllowed()) return
  const f = allFields.value.find((x) => x.key === key)
  if (!f) { ElMessage.warning(`未找到「${label}」字段`); return }
  const v = (value !== undefined ? value : (f.value == null ? '' : String(f.value))).trim()
  if (!v) { ElMessage.warning(`暂无${label}，请在浮窗输入或先读取设备参数`); return }
  if (f.ascii_len && v.length > f.ascii_len) { ElMessage.warning(`${label}最长 ${f.ascii_len} 个字符`); return }
  f.value = v
  await writeField(f)
}
function dispatchBtName(value?: string) { return dispatchSingleField('bt-name', '蓝牙名称', value) }
function dispatchBmsCode(value?: string) { return dispatchSingleField('bms-ver', 'BMS编码信息', value) }

const btNameValue = computed(() => String(paramState.ascii[88] ?? ''))
const bmsCodeValue = computed(() => String(paramState.ascii[72] ?? ''))
function syncFloatFieldValues() {
  window.floatAPI?.pushFieldValues({ btName: btNameValue.value, bmsCode: bmsCodeValue.value })
}
watch([btNameValue, bmsCodeValue], syncFloatFieldValues)

/** 复位 MCU：0x0A 控制指令（0x03 0x00） */
async function confirmResetMcu(opts?: { skipConfirm?: boolean }): Promise<void> {
  if (!ensureDispatchAllowed(opts?.skipConfirm)) return
  if (!opts?.skipConfirm) {
    try {
      await ElMessageBox.confirm('确定要复位 MCU 吗？设备将重新启动。', '复位 MCU', { type: 'warning' })
    } catch {
      return
    }
  }
  try {
    await waitRefreshIdle()
    await serialBus.transact(buildControlCommand(CONTROL_FUNC.RESET_MCU), 0x0a, 1500, 1)
    ElMessage.success('已发送复位 MCU 指令')
  } catch (e) {
    ElMessage.error(`复位 MCU 失败：${(e as Error).message}`)
  }
}

/* ================= 搜索与折叠 ================= */
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
const displayColumns = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return columns.value
  return columns.value.map((col) =>
    col
      .map((g) => ({ ...g, fields: g.fields.filter((f) => (f.label || '').toLowerCase().includes(q)) }))
      .filter((g) => g.fields.length > 0),
  )
})

/* ================= 导入 / 导出 ================= */
const importedParams = ref<ImportedParam[]>([])
const importDialogVisible = ref(false)
const importedSourceName = ref<string>('')
watch(importedSourceName, (name) => {
  window.floatAPI?.pushTemplate(name)
})

/** 导入到镜像（不落设备）；检流阻值一律跳过 */
function applyImport(data: any, name = ''): void {
  if (!data || !Array.isArray(data.params)) throw new Error('文件格式错误：缺少 params 数组')
  const hadBaseline = paramState.regs.length === REG_COUNT
  if (!hadBaseline) paramState.regs = new Array(REG_COUNT).fill(0)
  let senseSkipped = false
  const list: ImportedParam[] = []
  for (const p of data.params) {
    const idx = Number(p.index)
    if (!Number.isFinite(idx) || idx < 0 || idx >= REG_COUNT) continue
    if (idx === REG_SENSE) { senseSkipped = true; continue }
    if (p.ascii !== undefined) {
      paramState.ascii[idx] = String(p.value ?? '')
      list.push({ index: idx, label: String(p.label ?? ''), unit: '', value: String(p.value ?? ''), raw: 0, ascii: String(p.value ?? '') })
      continue
    }
    const raw = Number(p.raw ?? 0) & 0xffff
    paramState.regs[idx] = raw
    list.push({ index: idx, label: String(p.label ?? ''), unit: String(p.unit ?? ''), value: p.value, raw })
  }
  importedParams.value = list
  importedSourceName.value = name
  paramState.importFile = name
  if (hadBaseline) {
    paramState.paramsLoaded = true
  } else {
    paramState.paramsLoaded = false
    ElMessage.warning('参数已导入，但未读取过设备值，请先「读取参数」再写入')
  }
  if (senseSkipped) ElMessage.info(`导入已跳过检流阻值（reg${REG_SENSE}），保持当前值不变`)
  ElMessage.success(`已导入 ${list.length} 个参数`)
}

function applyImportText(text: string, name: string): void {
  applyImport(JSON.parse(text), name)
}

function onFileChange(uploadFile: any): void {
  const file: File | undefined = uploadFile?.raw
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      applyImportText(String(reader.result ?? ''), file.name)
      importDialogVisible.value = true
      templateDialogVisible.value = false
    } catch (e) {
      ElMessage.error(`导入失败：${(e as Error).message}`)
    }
  }
  reader.readAsText(file)
}

function clearImport() {
  importedParams.value = []
}

function currentParamValue(p: ImportedParam): string {
  if (p.ascii !== undefined) return paramState.ascii[p.index] ?? '—'
  const raw = paramState.regs[p.index]
  if (raw === undefined) return '—'
  return String(paramRawToDisplay(p.index, raw))
}

function isSendDiff(p: ImportedParam): boolean {
  if (p.ascii !== undefined) return (paramState.ascii[p.index] ?? '') !== p.ascii
  return (paramState.regs[p.index] ?? 0) !== (p.raw & 0xffff)
}

/** 一键下发导入参数：写入镜像后整包下发（与 SWJ 「写入参数」同链路） */
async function sendAllImported(): Promise<void> {
  if (!ensureDispatchAllowed()) return
  if (!importedParams.value.length) return
  for (const p of importedParams.value) {
    if (p.index === REG_SENSE) continue
    if (p.ascii !== undefined) paramState.ascii[p.index] = String(p.value ?? '')
    else paramState.regs[p.index] = p.raw & 0xffff
  }
  const ok = await doWriteAll('一键下发')
  const status = ok ? 'ok' : 'fail'
  importedParams.value.forEach((p) => { p.status = status })
  if (ok) importDialogVisible.value = false
}

/** 构造与导出文件同构的配置对象（供「导出配置」与「存为模板」共用） */
function buildExportData() {
  const params: any[] = []
  const emitted = new Set<number>()
  for (const f of allFields.value) {
    if (f.value === null || f.index === undefined || f.customDisplay || f.readOnly || f.bitIndex !== undefined) continue
    if (f.ascii) {
      if (f.key !== 'mfr') continue
      const text = String(f.value ?? '').trim()
      if (!text) continue
      params.push({ index: f.index, label: f.label, unit: '', value: text, ascii: text })
      continue
    }
    if (f.kind === 'scd' && f.scdPart === 'delay') continue
    if (emitted.has(f.index)) continue
    emitted.add(f.index)
    const raw = paramState.regs[f.index] ?? 0
    params.push({ index: f.index, label: f.label, unit: f.unit || '', value: paramRawToDisplay(f.index, raw), raw })
  }
  return { type: 'jbd-param-config', version: '1.0', exportedAt: new Date().toISOString(), params }
}

function exportConfig(): void {
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

/* ================= 本地模板库 ================= */
const {
  templates, templateDialogVisible, openTemplateDialog, importFromTemplate,
  onFileChangeFromDialog, saveAsTemplate, renameTemplate, deleteTemplate, formatDate,
} = useTemplates({
  buildExportData: () => buildExportData(),
  applyImport,
  onFileChange,
  setImportedSourceName: (name) => { importedSourceName.value = name },
})

defineExpose({ forceWriteAll, dispatchBtName, dispatchBmsCode, confirmResetMcu, readAll })
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
/* 检流阻值的密码锁按钮：贴标签右侧，不挤压标签文本 */
.sense-lock {
  margin-left: auto;
  padding: 0 2px;
  height: 18px;
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
