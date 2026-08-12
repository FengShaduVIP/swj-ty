<template>
  <div class="macro-panel">
    <!-- ============ 说明 + 运行 ============ -->
    <el-card class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><Files /></el-icon> 批量指令宏（产线）</span>
        <el-button size="small" type="success" :disabled="!connected || running" @click="runMacro">
          <el-icon><VideoPlay /></el-icon> 运行
        </el-button>
        <el-button size="small" type="danger" :disabled="!running" @click="stopMacro">
          <el-icon><VideoPause /></el-icon> 停止
        </el-button>
        <span class="sub">顺序执行，等待每步响应（超时 {{ stepTimeout }}ms）</span>
      </template>

      <div class="macro-actions">
        <span class="lbl">添加步骤：</span>
        <el-button v-for="t in TYPE_OPTIONS" :key="t.type" size="small" plain @click="addStep(t.type)">{{ t.label }}</el-button>
      </div>

      <div class="macro-actions" style="margin-top: 8px">
        <el-input v-model="presetName" size="small" placeholder="预设名称" style="width: 160px" />
        <el-button size="small" @click="savePreset"><el-icon><Collection /></el-icon> 存为预设</el-button>
        <el-select v-model="presetSel" size="small" placeholder="载入预设" style="width: 160px" @change="loadPreset">
          <el-option v-for="(v, k) in presets" :key="k" :label="k" :value="k" />
        </el-select>
        <el-button size="small" @click="loadSample"><el-icon><MagicStick /></el-icon> 示例模板</el-button>
        <el-button size="small" @click="exportJson"><el-icon><Download /></el-icon> 导出JSON</el-button>
        <el-button size="small" @click="fileInput?.click()"><el-icon><Upload /></el-icon> 导入JSON</el-button>
        <el-button size="small" type="info" text @click="clearSteps">清空</el-button>
        <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="importJson" />
      </div>
    </el-card>

    <!-- ============ 步骤列表 ============ -->
    <el-card class="sec" shadow="never" v-if="steps.length">
      <template #header><span class="sec-title">步骤序列（{{ steps.length }} 步）</span></template>
      <div v-for="(s, i) in steps" :key="s.id" class="step-row">
        <span class="step-idx">{{ i + 1 }}</span>
        <el-tag :type="statusTag(statuses[i])" size="small" class="step-st">{{ statusText(statuses[i]) }}</el-tag>

        <el-select v-model="s.type" size="small" style="width: 130px" @change="onTypeChange(s)">
          <el-option v-for="t in TYPE_OPTIONS" :key="t.type" :label="t.label" :value="t.type" />
        </el-select>

        <!-- 读取参数 -->
        <template v-if="s.type === 'read-param'">
          <el-select v-model="s.reg" size="small" filterable placeholder="参数" style="width: 220px">
            <el-option v-for="p in PARAM_TABLE" :key="p.index" :label="`[${p.index}] ${p.name}`" :value="p.index" />
          </el-select>
          <span class="tip">数量</span>
          <el-input-number v-model="s.count" :min="1" :max="95" size="small" controls-position="right" style="width: 100px" />
        </template>

        <!-- 写入参数 -->
        <template v-else-if="s.type === 'write-param'">
          <el-select v-model="s.reg" size="small" filterable placeholder="参数" style="width: 220px">
            <el-option v-for="p in writableParams" :key="p.index" :label="`[${p.index}] ${p.name}`" :value="p.index" />
          </el-select>
          <span class="tip">值</span>
          <el-input-number v-model="s.value" :min="0" :max="65535" size="small" controls-position="right" style="width: 130px" />
          <el-checkbox v-model="s.autoFactory" size="small">自动进出工厂</el-checkbox>
        </template>

        <!-- 控制指令 -->
        <template v-else-if="s.type === 'control'">
          <el-select v-model="s.func" size="small" placeholder="指令" style="width: 160px">
            <el-option v-for="o in CONTROL_OPTIONS" :key="o.label" :label="o.label" :value="o.fn" />
          </el-select>
        </template>

        <!-- MOS 控制 -->
        <template v-else-if="s.type === 'mos'">
          <el-select v-model="s.mosType" size="small" style="width: 130px">
            <el-option v-for="o in MOS_OPTIONS" :key="o.label" :label="o.label" :value="o.val" />
          </el-select>
          <el-switch v-model="s.mosOpen" size="small" active-text="开" inactive-text="关" inline-prompt />
        </template>

        <!-- 延时 -->
        <template v-else-if="s.type === 'delay'">
          <el-input-number v-model="s.ms" :min="0" :max="60000" :step="100" size="small" controls-position="right" style="width: 130px" />
          <span class="tip">ms</span>
        </template>

        <span class="step-desc">{{ stepDesc(s) }}</span>

        <div class="step-ops">
          <el-button size="small" text :disabled="i === 0" @click="move(i, -1)"><el-icon><Top /></el-icon></el-button>
          <el-button size="small" text :disabled="i === steps.length - 1" @click="move(i, 1)"><el-icon><Bottom /></el-icon></el-button>
          <el-button size="small" text type="danger" @click="remove(i)"><el-icon><Delete /></el-icon></el-button>
        </div>
      </div>
    </el-card>

    <!-- ============ 运行结果 ============ -->
    <el-card class="sec" shadow="never">
      <template #header>
        <span class="sec-title">运行结果</span>
        <el-button size="small" text type="info" @click="results = []">清空</el-button>
      </template>
      <div v-if="!results.length" class="tip">运行后此处显示每步响应与读数</div>
      <div v-for="(r, i) in results" :key="i" class="res-line mono">{{ r }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Files, VideoPlay, VideoPause, Collection, MagicStick, Download, Upload, Delete, Top, Bottom,
} from '@element-plus/icons-vue'
import { jbdBus } from '@/jbd/jbd-bus'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadInternalRes,
  buildReadParam, buildWriteParam,
  buildControlCommand, CONTROL_FUNC,
  buildControlMOS, MOS_TYPE, MOS_ACTION,
  buildEnterFactory, buildExitFactory,
  parseBasicInfo, type Frame,
} from '@/jbd/jbd-protocol'
import { PARAM_TABLE } from '@/jbd/jbd-params'

const props = defineProps<{ connected: boolean }>()

type StepType =
  | 'read-basic' | 'read-cells' | 'read-res' | 'read-param' | 'write-param'
  | 'control' | 'mos' | 'enter-factory' | 'exit-factory' | 'delay'

interface MacroStep {
  id: number
  type: StepType
  reg: number
  count: number
  value: number
  autoFactory: boolean
  func: readonly number[]
  mosType: number
  mosOpen: boolean
  ms: number
}

const TYPE_OPTIONS = [
  { label: '读基本信息', type: 'read-basic' as StepType },
  { label: '读单体电压', type: 'read-cells' as StepType },
  { label: '读内阻', type: 'read-res' as StepType },
  { label: '读参数', type: 'read-param' as StepType },
  { label: '写参数', type: 'write-param' as StepType },
  { label: '控制指令', type: 'control' as StepType },
  { label: 'MOS控制', type: 'mos' as StepType },
  { label: '进工厂模式', type: 'enter-factory' as StepType },
  { label: '退工厂模式', type: 'exit-factory' as StepType },
  { label: '延时等待', type: 'delay' as StepType },
]
const CONTROL_OPTIONS = [
  { label: '重置容量', fn: CONTROL_FUNC.RESET_CAPACITY },
  { label: '清除记录', fn: CONTROL_FUNC.CLEAR_RECORD },
  { label: '复位MCU', fn: CONTROL_FUNC.RESET_MCU },
  { label: '清除保护', fn: CONTROL_FUNC.CLEAR_PROTECT },
  { label: '进入休眠', fn: CONTROL_FUNC.SLEEP },
  { label: '掉电模式', fn: CONTROL_FUNC.POWER_DOWN },
  { label: '自动均衡', fn: CONTROL_FUNC.AUTO_BALANCE },
  { label: '储运模式', fn: CONTROL_FUNC.STORAGE },
  { label: 'SOC20%开关', fn: CONTROL_FUNC.SOC20_SWITCH },
  { label: 'SOC20%强开', fn: CONTROL_FUNC.SOC20_FORCE },
  { label: '强制启动', fn: CONTROL_FUNC.FORCE_START },
  { label: '强制加热', fn: CONTROL_FUNC.FORCE_HEAT },
]
const MOS_OPTIONS = [
  { label: '充电MOS', val: MOS_TYPE.CHARGE },
  { label: '放电MOS', val: MOS_TYPE.DISCHARGE },
  { label: '充放MOS', val: MOS_TYPE.CHARGE_DISCHARGE },
]
const writableParams = computed(() => PARAM_TABLE.filter((p) => !p.ascii))
const stepTimeout = 1500

let nextId = 1
const steps = ref<MacroStep[]>([])
const statuses = ref<('idle' | 'running' | 'ok' | 'fail' | 'timeout')[]>([])
const results = ref<string[]>([])
const running = ref(false)

// 预设（localStorage）
const PRESET_KEY = 'jbd_macro_presets'
const presets = ref<Record<string, MacroStep[]>>(loadPresets())
const presetName = ref('')
const presetSel = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function loadPresets(): Record<string, MacroStep[]> {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}') } catch { return {} }
}
function defaultStep(type: StepType): MacroStep {
  return {
    id: nextId++, type,
    reg: type === 'write-param' ? 2 : 0,
    count: 1, value: 0, autoFactory: true,
    func: CONTROL_FUNC.RESET_CAPACITY,
    mosType: MOS_TYPE.CHARGE, mosOpen: true, ms: 500,
  }
}
function addStep(type: StepType) {
  steps.value.push(defaultStep(type))
  statuses.value.push('idle')
}
function remove(i: number) {
  steps.value.splice(i, 1)
  statuses.value.splice(i, 1)
}
function move(i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= steps.value.length) return
  const s = steps.value
  ;[s[i], s[j]] = [s[j], s[i]]
  const st = statuses.value
  ;[st[i], st[j]] = [st[j], st[i]]
}
function onTypeChange(s: MacroStep) {
  // 切换类型时复位相关字段到合理默认
  if (s.type === 'write-param') { s.reg = s.reg || 2 }
}

function stepDesc(s: MacroStep): string {
  switch (s.type) {
    case 'read-param': return `读取参数[${s.reg}] × ${s.count}`
    case 'write-param': return `写参数[${s.reg}] = ${s.value}${s.autoFactory ? '（自动进出工厂）' : ''}`
    case 'control': return CONTROL_OPTIONS.find((o) => o.fn === s.func)?.label || ''
    case 'mos': return `${MOS_OPTIONS.find((o) => o.val === s.mosType)?.label} ${s.mosOpen ? '开' : '关'}`
    case 'delay': return `等待 ${s.ms} ms`
    default: return ''
  }
}
function statusTag(s?: string): 'info' | 'warning' | 'success' | 'danger' {
  if (s === 'running') return 'warning'
  if (s === 'ok') return 'success'
  if (s === 'fail' || s === 'timeout') return 'danger'
  return 'info'
}
function statusText(s?: string): string {
  return ({ idle: '待', running: '执行中', ok: '成功', fail: '失败', timeout: '超时' } as Record<string, string>)[s || 'idle'] || '待'
}

// ===== 构建单步帧 =====
function buildStepFrame(s: MacroStep): number[] | null {
  switch (s.type) {
    case 'read-basic': return buildReadBasicInfo()
    case 'read-cells': return buildReadCellVoltages()
    case 'read-res': return buildReadInternalRes()
    case 'read-param': return buildReadParam(s.reg, s.count)
    case 'write-param': {
      const v = s.value & 0xffff
      return buildWriteParam(s.reg, [(v >> 8) & 0xff, v & 0xff])
    }
    case 'control': return buildControlCommand(s.func)
    case 'mos': return buildControlMOS(s.mosType, s.mosOpen ? MOS_ACTION.RELEASE : MOS_ACTION.CLOSE)
    case 'enter-factory': return buildEnterFactory()
    case 'exit-factory': return buildExitFactory()
    default: return null // delay
  }
}

function stopMacro() { running.value = false }

async function runMacro() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (!steps.value.length) { ElMessage.warning('请先添加步骤'); return }
  if (running.value) return
  running.value = true
  results.value = []
  statuses.value = steps.value.map(() => 'idle')

  for (let i = 0; i < steps.value.length; i++) {
    if (!running.value) break
    const s = steps.value[i]
    statuses.value[i] = 'running'
    const tag = `[${i + 1}] ${stepDesc(s)}`

    if (s.type === 'delay') {
      await sleep(s.ms)
      statuses.value[i] = 'ok'
      results.value.push(`${tag} → 等待完成`)
      continue
    }

    // 写参数：按需自动进出工厂模式
    if (s.type === 'write-param' && s.autoFactory) {
      jbdBus.send(buildEnterFactory())
      const er = await jbdBus.onceResponse(stepTimeout, 0x00)
      if (er.timeout || er.status !== 0) {
        statuses.value[i] = 'fail'
        results.value.push(`${tag} → 进入工厂模式${er.timeout ? '超时' : '失败(0x' + er.status.toString(16) + ')'}`)
        continue
      }
    }

    const frame = buildStepFrame(s)
    if (!frame) { statuses.value[i] = 'ok'; continue }
    jbdBus.send(frame)
    const resp = await jbdBus.onceResponse(stepTimeout, frame[2])
    await handleResponse(i, s, tag, resp)

    if (s.type === 'write-param' && s.autoFactory) {
      jbdBus.send(buildExitFactory())
      await jbdBus.onceResponse(stepTimeout, 0x01)
    }
  }
  running.value = false
}

async function handleResponse(i: number, s: MacroStep, tag: string, resp: Frame) {
  if (resp.timeout) {
    statuses.value[i] = 'timeout'
    results.value.push(`${tag} → 超时无响应`)
    return
  }
  if (resp.status !== 0x00) {
    statuses.value[i] = 'fail'
    const map: Record<number, string> = { 0x80: '命令码不存在', 0x81: '操作无效/未进工厂', 0x82: '校验错误', 0x83: '密码错误', 0x84: '密码修改失败' }
    results.value.push(`${tag} → 失败: ${map[resp.status] || '0x' + resp.status.toString(16)}`)
    return
  }
  statuses.value[i] = 'ok'

  if (s.type === 'read-basic') {
    const info = parseBasicInfo(resp.data)
    results.value.push(`${tag} → 总压 ${(info.totalVoltage_mV / 1000).toFixed(2)}V 电流 ${(info.current_mA / 1000).toFixed(2)}A SOC ${info.rsoc}%`)
  } else if (s.type === 'read-param') {
    const reg = (resp.data[0] << 8) | resp.data[1]
    const count = resp.data[2]
    const vals: number[] = []
    for (let k = 0; k < count; k++) vals.push(((resp.data[3 + k * 2] << 8) | resp.data[4 + k * 2]) & 0xffff)
    const name = PARAM_TABLE.find((p) => p.index === reg)?.name || '未知'
    results.value.push(`${tag} → [${reg}]${name}: ${vals.join(', ')}`)
  } else if (s.type === 'read-cells') {
    const n = Math.floor(resp.data.length / 2)
    results.value.push(`${tag} → ${n} 串电压读取成功`)
  } else {
    results.value.push(`${tag} → 成功`)
  }
}

// ===== 预设 / 文件 =====
function savePreset() {
  const name = presetName.value.trim()
  if (!name) { ElMessage.warning('请填写预设名称'); return }
  presets.value[name] = JSON.parse(JSON.stringify(steps.value))
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets.value))
  presetSel.value = name
  ElMessage.success(`已保存预设「${name}」`)
}
function loadPreset(name: string) {
  const p = presets.value[name]
  if (!p) return
  steps.value = JSON.parse(JSON.stringify(p))
  statuses.value = steps.value.map(() => 'idle')
  ElMessage.success(`已载入预设「${name}」`)
}
function clearSteps() {
  steps.value = []
  statuses.value = []
  results.value = []
}
function loadSample() {
  steps.value = [
    defaultStep('read-basic'),
    defaultStep('read-cells'),
    defaultStep('read-res'),
    defaultStep('read-param'),
    (() => { const s = defaultStep('write-param'); s.reg = 2; s.value = 3650; s.autoFactory = true; return s })(),
    defaultStep('control'),
  ]
  // 示例控制设为「重置容量」
  steps.value[5].func = CONTROL_FUNC.RESET_CAPACITY
  statuses.value = steps.value.map(() => 'idle')
  ElMessage.info('已载入示例：读基本信息/单体电压/内阻 → 读参数0 → 写参数2=3650 → 重置容量')
}
function exportJson() {
  const blob = new Blob([JSON.stringify(steps.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jbd-macro-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
function importJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result as string) as MacroStep[]
      if (!Array.isArray(parsed)) throw new Error('格式错误')
      // 规整 id，避免冲突
      parsed.forEach((p) => { p.id = nextId++ })
      steps.value = parsed
      statuses.value = steps.value.map(() => 'idle')
      ElMessage.success(`导入 ${parsed.length} 步`)
    } catch {
      ElMessage.error('JSON 解析失败，请检查文件')
    }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }
</script>

<style scoped>
.macro-panel {
  padding: 16px;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.macro-panel > * { min-width: 0; }
.sec { background: #1a1e24; border: 1px solid #2a2e34; }
.sec :deep(.el-card__header) { padding: 10px 14px; border-bottom: 1px solid #2a2e34; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sec-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #f0f1f2; }
.sec-title .el-icon { color: #00BFA5; }
.sub { font-size: 12px; color: #8a8e94; margin-left: auto; }
.macro-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.macro-actions .lbl { font-size: 13px; color: #b0b4ba; }
.step-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px; border: 1px solid #2a2e34; border-radius: 6px; margin-bottom: 8px;
  background: #0c0e10;
}
.step-idx { width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 50%; background: #2a2e34; color: #c0c4ca; font-size: 12px; flex-shrink: 0; }
.step-st { width: 56px; text-align: center; flex-shrink: 0; }
.step-desc { font-size: 12px; color: #8a8e94; margin-left: 4px; }
.step-ops { margin-left: auto; display: flex; gap: 2px; }
.tip { font-size: 12px; color: #6a6e74; }
.res-line { font-size: 12px; color: #c0c4ca; padding: 3px 0; border-bottom: 1px solid #1a1e24; font-family: 'JetBrains Mono', monospace; }
.mono { font-family: 'JetBrains Mono', monospace; }
</style>
