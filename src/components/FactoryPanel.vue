<template>
  <div class="factory-page">
    <!-- ============ 实时遥测：4 列 × 2 行 ============ -->
    <section class="panel sec metrics-panel">
      <header class="sec-h"><span class="panel-title">实时遥测</span></header>
      <div class="sec-b metrics-grid">
        <div v-for="m in metrics" :key="m.k" class="metric">
          <span class="m-k">{{ m.k }}</span>
          <span class="m-v">{{ m.v }}</span>
        </div>
      </div>
    </section>

    <!-- ============ 下发操作：两行（日志+强制下发 / 名称+编码+复位MCU）============ -->
    <section class="panel sec ops-panel">
      <header class="sec-h"><span class="panel-title">下发操作</span></header>
      <div class="sec-b ops-rows">
        <div class="ops-row">
          <div class="comm-strip" :class="{ empty: !commStrip.length }" title="实时通信日志">
            <div v-if="!commStrip.length" class="comm-empty">暂无通信日志</div>
            <div v-for="(l, i) in commStrip" :key="i" class="comm-line" :class="'log-' + l.type">
              <span class="c-time num">{{ l.time }}</span>
              <span class="c-tag" :class="'tag-' + l.type">{{ tagLabel(l.type) }}</span>
              <span class="c-text mono-font">{{ l.content }}</span>
            </div>
          </div>
          <el-button
            class="force-btn"
            type="warning"
            :disabled="!dispatchAllowed || busy"
            :loading="busy"
            @click="forceWriteAll"
          >
            <el-icon><Lightning /></el-icon> 强制下发
          </el-button>
        </div>

        <!-- 批量下发进度（与参数配置页同源 progress）-->
        <div v-if="busy" class="progress-bar">
          <el-progress :percentage="progress" :stroke-width="4" color="#EFB33C" />
        </div>

        <div class="ops-row ops-row--ident">
          <div class="op-field">
            <span class="op-label">蓝牙名称</span>
            <div class="op-row">
              <el-input
                :model-value="btField?.value ?? ''"
                :maxlength="btField ? (btField.ascii_len ?? 8) * 2 - 1 : 31"
                show-word-limit
                :disabled="busy || !connected"
                placeholder="连接后自动读取"
                @update:model-value="(v: any) => onIdentInput(btField, v)"
              />
              <el-button
                type="primary"
                :loading="btField?.status === 'writing'"
                :disabled="!btField || !canWrite(btField)"
                @click="btField && writeField(btField)"
              >下发名称</el-button>
            </div>
          </div>

          <div class="op-field">
            <span class="op-label">编码</span>
            <div class="op-row">
              <el-input
                :model-value="codeField?.value ?? ''"
                :maxlength="codeField ? (codeField.ascii_len ?? 8) * 2 - 1 : 31"
                show-word-limit
                :disabled="busy || !connected"
                placeholder="如 CNF88671"
                @update:model-value="(v: any) => onIdentInput(codeField, v)"
              />
              <el-button
                type="primary"
                :loading="codeField?.status === 'writing'"
                :disabled="!codeField || !canWrite(codeField)"
                @click="codeField && writeField(codeField)"
              >下发编码</el-button>
            </div>
          </div>

          <el-button class="mcu-btn" type="danger" :disabled="!dispatchAllowed || busy" @click="confirmResetMcu">
            复位MCU
          </el-button>
        </div>
      </div>
    </section>

    <section class="panel sec tip-card">
      <div class="tip-line">作业流程：连接设备 → 导入模板并在「参数配置」读取/下发 → 本页「强制下发」原样重发全部已读参数 → 修改蓝牙名称/编码后分别下发 → 「复位MCU」重启生效。</div>
      <div class="tip-line tip-sub">强制下发会把当前已读取到的参数整体覆盖写入设备并记入「下发记录」；下发名称走专用 0xA2 指令，下发完成后自动回读校验。</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Lightning } from '@element-plus/icons-vue'
import { buildReadBasicInfo, buildReadCellVoltages } from '@/jbd/jbd-protocol'
import { useJbd } from '@/jbd/useJbd'
import { ui, type LogEntry } from '@/store'
import { canDispatchParameters } from '@/auth/auth'
import { POLL_INTERVAL_MS } from '@/constants'
import { buildColumnsFromTitles, defaultColumnOrder } from './param-config/groupDefs'
import { useDispatch, type RendererAuthSession } from './param-config/useDispatch'
import type { FieldState } from './param-config/types'

const props = defineProps<{
  connected: boolean
  /** 页面是否处于激活显示状态（仅激活时轮询遥测，避免后台抢总线） */
  active: boolean
  logs?: LogEntry[]
  authSession: RendererAuthSession | null
}>()

// 工具栏通信日志条：只保留最近 2 行（与参数配置页同源数据）
const commStrip = computed(() => (props.logs || []).slice(-2))
function tagLabel(type: string): string {
  return { send: '发送', recv: '接收', error: '错误', info: '信息' }[type] ?? type
}

const dispatchAllowed = computed(() => canDispatchParameters(props.connected, props.authSession))

// ====== 共享下发引擎（与参数配置页同一实例：字段/工厂态/进度/世代计数全局一致）======
const {
  busy, progress,
  canWrite, readField,
  writeField, forceWriteAll, confirmResetMcu,
} = useDispatch({
  connected: () => props.connected,
  authSession: () => props.authSession,
})

// ====== 标识字段（蓝牙名称 88 / BMS编码信息 72）：builtGroups 模块单例，与参数配置页同源 ======
const fieldPool = ref<FieldState[]>(buildColumnsFromTitles(defaultColumnOrder).flat().flatMap((g) => g.fields))
const btField = computed(() => fieldPool.value.find((f) => f.key === 'bt-name'))
const codeField = computed(() => fieldPool.value.find((f) => f.key === 'bms-ver'))

function onIdentInput(f: FieldState | undefined, v: any) {
  if (!f) return
  f.value = typeof v === 'string' ? v : ''
  f.dirty = true
}

// ====== 实时遥测：useJbd 模块单例（0x03/0x04 应答统一落库），本页仅负责拉取节奏 ======
const j = useJbd()

const metrics = computed(() => {
  const l = ui.live
  const fmt = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? '--' : v.toFixed(d))
  const hasCells = j.cellVoltages.value.length > 0
  const cellHi = hasCells ? (j.cellMax.value / 1000).toFixed(3) : '--'
  const cellLo = hasCells ? (j.cellMin.value / 1000).toFixed(3) : '--'
  const delta = hasCells ? String(Math.round(j.cellMax.value - j.cellMin.value)) : '--'
  return [
    { k: '总压 V', v: fmt(l.totalVoltage_V), color: 'var(--data-voltage)' },
    { k: '电流 A', v: fmt(l.current_A), color: 'var(--data-current)' },
    { k: 'SOC %', v: fmt(l.soc, 1), color: 'var(--data-soc)' },
    { k: '最高温 ℃', v: fmt(l.maxTemp_C, 1), color: 'var(--data-temp)' },
    { k: '单体最高', v: cellHi, color: 'var(--text-primary)' },
    { k: '单体最低', v: cellLo, color: 'var(--text-primary)' },
    { k: '压差 mV', v: delta, color: 'var(--critical)' },
  ]
})

// ====== 遥测轮询：页面激活 + 已连接时按 POLL_INTERVAL_MS 拉基本信息与单体电压 ======
// 与实时监测页的自动轮询互斥（对方开启时数据照常刷新，本页不再重复发帧）；
// 批量下发期间（batchBusy）暂停，避免与引擎的 0xFA 批量帧抢总线。
let pollTimer: number | null = null
function kick() {
  if (!props.connected || j.batchBusy.value) return
  if (j.autoPollProxy.value) return
  j.pollSend(buildReadBasicInfo())
  j.pollSend(buildReadCellVoltages())
}
function startPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (!props.active || !props.connected) return
  kick()
  pollTimer = window.setInterval(kick, POLL_INTERVAL_MS)
}

// 激活页面时：拉一拍遥测，并串行预读蓝牙名称/编码（各一帧，失败即止避免连环重试刷总线）
async function prefillIdent() {
  if (busy.value) return
  for (const f of [btField.value, codeField.value]) {
    if (!f || f.value != null) continue
    if (!props.connected || busy.value) return
    const ok = await readField(f)
    if (!ok) return
  }
}

watch(() => props.active, (a) => {
  if (a && props.connected) void prefillIdent()
  startPoll()
})
watch(() => props.connected, () => startPoll())

onMounted(startPoll)
onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})
</script>

<style scoped>
.factory-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
}

/* ---------- 实时遥测：自适应列数（宽屏 4 列 × 2 行，窄窗自动减列）---------- */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-4) var(--space-8);
  padding: var(--space-2) var(--space-2);
}
.metric { display: flex; flex-direction: column; gap: var(--space-1); }
.m-k { font-size: var(--fs-label); font-weight: var(--fw-semibold); letter-spacing: 0.04em; color: var(--text-secondary); white-space: nowrap; }
.m-v { font-size: 24px; font-weight: var(--fw-bold); font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; line-height: 1.15; }

/* ---------- 下发操作：两行 ---------- */
.ops-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-2);
}
.ops-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
  row-gap: var(--space-3);
}

.comm-strip {
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  height: 48px;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.comm-empty { font-size: var(--fs-micro); color: var(--text-tertiary); }
.comm-line { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-micro); line-height: 1.5; min-width: 0; }
.c-time { color: var(--text-tertiary); flex-shrink: 0; }
.c-tag { flex-shrink: 0; font-weight: var(--fw-semibold); }
.c-text { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-send .c-tag, .tag-send { color: var(--data-voltage); }
.log-recv .c-tag, .tag-recv { color: var(--data-soc); }
.log-error .c-tag, .tag-error { color: var(--critical); }
.log-info .c-tag, .tag-info { color: var(--text-tertiary); }

.force-btn { height: 48px; padding: 0 24px; font-size: var(--fs-body); font-weight: var(--fw-semibold); flex-shrink: 0; }

/* 第二行：名称 / 编码 / 复位MCU */
.ops-row--ident { align-items: flex-end; }
.op-field { flex: 1 1 240px; display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.op-label { font-size: var(--fs-caption); font-weight: var(--fw-semibold); color: var(--text-secondary); }
.op-row { display: flex; align-items: center; gap: var(--space-3); }
.op-row .el-input { flex: 1; min-width: 0; }
.op-row .el-button { flex-shrink: 0; }
.mcu-btn { height: 32px; font-weight: var(--fw-semibold); flex-shrink: 0; }

/* ---------- 说明卡 ---------- */
.tip-card { display: flex; flex-direction: column; gap: var(--space-2); }
.tip-line { font-size: var(--fs-caption); color: var(--text-secondary); line-height: 1.6; }
.tip-sub { color: var(--text-tertiary); }

.progress-bar { padding: 0 2px; }
</style>
