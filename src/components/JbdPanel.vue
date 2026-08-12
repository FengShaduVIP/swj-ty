<template>
  <div class="jbd-panel">
    <!-- ============ 实时读取 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><Refresh /></el-icon> 实时读取</span></template>
      <div class="btn-grid">
        <el-button size="small" :disabled="!connected" @click="readBasic">基本信息</el-button>
        <el-button size="small" :disabled="!connected" @click="readCells">单体电压</el-button>
        <el-button size="small" :disabled="!connected" @click="readHw">硬件版本</el-button>
        <el-button size="small" :disabled="!connected" @click="readProtect">保护次数</el-button>
        <el-button size="small" :disabled="!connected" @click="readChip">芯片类型</el-button>
        <el-button size="small" :disabled="!connected" @click="readRes">电池内阻</el-button>
      </div>
      <div class="poll-row">
        <el-switch v-model="autoPollProxy" size="small" active-text="自动轮询(2s)" @change="onPollChange" />
        <span class="tip">注：保护板休眠时首帧常无响应，需重发</span>
      </div>
    </el-card>

    <!-- ============ 趋势曲线 ============ -->
    <el-card class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><TrendCharts /></el-icon> 趋势曲线</span>
        <span class="sub">已采样 {{ history.length }} 点</span>
        <el-switch v-model="recordTrend" size="small" active-text="记录" inline-prompt style="margin-left: 10px" />
        <el-button size="small" text type="info" style="margin-left: 6px" @click="clearTrend">清空</el-button>
      </template>
      <div class="param-row" style="margin-bottom: 8px">
        <el-radio-group v-model="trendMetric" size="small">
          <el-radio-button value="overview">总览</el-radio-button>
          <el-radio-button value="pack">总压/电流</el-radio-button>
          <el-radio-button value="cells">单体电压</el-radio-button>
          <el-radio-button value="temps">温度</el-radio-button>
        </el-radio-group>
      </div>
      <LineChart :series="trendSeries" :y-unit="trendUnit" :height="160" :fill="trendMetric === 'overview' || trendMetric === 'pack'" />
      <div class="legend" v-if="trendSeries.length">
        <span v-for="s in trendSeries" :key="s.name" class="lg-item">
          <i :style="{ background: s.color }"></i>{{ s.name }}
        </span>
      </div>
    </el-card>

    <!-- ============ 基本信息 ============ -->
    <el-card v-if="basicInfo" class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><DataBoard /></el-icon> 基本信息</span></template>
      <div class="stat-grid">
        <div class="stat"><span class="k">总电压</span><span class="v">{{ (basicInfo.totalVoltage_mV / 1000).toFixed(2) }} V</span></div>
        <div class="stat"><span class="k">电流</span><span class="v" :class="basicInfo.current_mA < 0 ? 'neg' : 'pos'">{{ (basicInfo.current_mA / 1000).toFixed(2) }} A</span></div>
        <div class="stat"><span class="k">SOC</span><span class="v">{{ basicInfo.rsoc }} %</span></div>
        <div class="stat"><span class="k">剩余容量</span><span class="v">{{ (basicInfo.remainingCapacity_mAh / 1000).toFixed(2) }} Ah</span></div>
        <div class="stat"><span class="k">标称容量</span><span class="v">{{ (basicInfo.nominalCapacity_mAh / 1000).toFixed(2) }} Ah</span></div>
        <div class="stat"><span class="k">循环次数</span><span class="v">{{ basicInfo.cycleCount }}</span></div>
        <div class="stat"><span class="k">软件版本</span><span class="v">V{{ basicInfo.swVersion }}</span></div>
        <div class="stat"><span class="k">电池串数</span><span class="v">{{ basicInfo.cellCount }}</span></div>
        <div class="stat"><span class="k">NTC 数</span><span class="v">{{ basicInfo.ntcCount }}</span></div>
        <div class="stat"><span class="k">生产日期</span><span class="v">{{ basicInfo.manufactureDate.year }}-{{ basicInfo.manufactureDate.month }}-{{ basicInfo.manufactureDate.day }}</span></div>
        <div class="stat"><span class="k">温度</span><span class="v">{{ basicInfo.temperatures_C.map(t => t.toFixed(1)).join(' / ') }} ℃</span></div>
      </div>
      <div class="tag-row">
        <span class="lbl">MOS：</span>
        <el-tag :type="basicInfo.fet.charge ? 'success' : 'danger'" size="small">充电{{ basicInfo.fet.charge ? '开' : '关' }}</el-tag>
        <el-tag :type="basicInfo.fet.discharge ? 'success' : 'danger'" size="small">放电{{ basicInfo.fet.discharge ? '开' : '关' }}</el-tag>
        <el-tag v-if="basicInfo.fet.heating" type="warning" size="small">加热中</el-tag>
        <el-tag v-if="basicInfo.fet.currentLimit" type="info" size="small">限流</el-tag>
      </div>
      <div class="tag-row">
        <span class="lbl">保护：</span>
        <template v-if="activeProtects.length">
          <el-tag v-for="b in activeProtects" :key="b" type="danger" size="small">{{ b }}</el-tag>
        </template>
        <el-tag v-else type="success" size="small">正常</el-tag>
      </div>
    </el-card>

    <!-- ============ 单体电压 ============ -->
    <el-card v-if="cellVoltages.length" class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><Operation /></el-icon> 单体电压 ({{ cellVoltages.length }} 串)</span>
        <span class="sub">最高 {{ (cellMax / 1000).toFixed(3) }}V · 最低 {{ (cellMin / 1000).toFixed(3) }}V · 压差 {{ ((cellMax - cellMin) / 1000).toFixed(3) }}V</span>
      </template>
      <div class="cell-grid">
        <div v-for="(v, i) in cellVoltages" :key="i" class="cell" :style="{ borderColor: cellColor(v) }">
          <span class="cell-idx">{{ i + 1 }}</span>
          <span class="cell-v" :style="{ color: cellColor(v) }">{{ (v / 1000).toFixed(3) }}</span>
        </div>
      </div>
    </el-card>

    <!-- ============ 内阻 ============ -->
    <el-card v-if="internalRes.length" class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><Histogram /></el-icon> 电池内阻 (0.1mR)</span></template>
      <div class="cell-grid">
        <div v-for="(v, i) in internalRes" :key="i" class="cell">
          <span class="cell-idx">{{ i + 1 }}</span>
          <span class="cell-v">{{ v / 10 }}</span>
        </div>
      </div>
    </el-card>

    <!-- ============ MOS 控制 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><Switch /></el-icon> MOS 控制</span></template>
      <div class="mos-row">
        <div class="mos-item">
          <span>充电 MOS</span>
          <el-switch :model-value="basicInfo?.fet.charge ?? false" :disabled="!connected"
            active-text="开" inactive-text="关" @change="(v: any) => setMos(MOS_TYPE.CHARGE, v)" />
        </div>
        <div class="mos-item">
          <span>放电 MOS</span>
          <el-switch :model-value="basicInfo?.fet.discharge ?? false" :disabled="!connected"
            active-text="开" inactive-text="关" @change="(v: any) => setMos(MOS_TYPE.DISCHARGE, v)" />
        </div>
        <div class="mos-item btn-group">
          <el-button size="small" :disabled="!connected" @click="setMosBoth(false)">全部关闭</el-button>
          <el-button size="small" type="success" :disabled="!connected" @click="setMosBoth(true)">全部打开</el-button>
        </div>
      </div>
    </el-card>

    <!-- ============ 控制指令 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><MagicStick /></el-icon> 控制指令 (0x0A)</span></template>
      <div class="btn-grid">
        <el-button v-for="c in controlButtons" :key="c.label" size="small" :disabled="!connected" @click="runControl(c.fn)">
          {{ c.label }}
        </el-button>
      </div>
    </el-card>

    <!-- ============ 参数读写 ============ -->
    <el-card class="sec" shadow="never">
      <template #header>
        <span class="sec-title"><el-icon><Setting /></el-icon> 参数读写 (0xFA)</span>
        <el-tag :type="inFactory ? 'success' : 'info'" size="small">{{ inFactory ? '工厂模式' : '普通模式' }}</el-tag>
      </template>

      <div class="param-row">
        <el-button size="small" :type="inFactory ? 'success' : 'primary'" :disabled="!connected" @click="enterFactory">进入工厂模式</el-button>
        <el-button size="small" :disabled="!connected || !inFactory" @click="exitFactory">退出工厂模式</el-button>
      </div>

      <el-divider content-position="left">读取</el-divider>
      <div class="param-row">
        <el-select v-model="paramReg" size="small" filterable placeholder="选择参数" style="flex: 1" :disabled="!connected">
          <el-option v-for="p in PARAM_TABLE" :key="p.index" :label="`[${p.index}] ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`" :value="p.index" />
        </el-select>
        <el-input-number v-model="paramCount" :min="1" :max="95" size="small" controls-position="right" style="width: 110px" />
        <el-button size="small" type="primary" :disabled="!connected" @click="readParam">读取</el-button>
      </div>
      <div v-if="paramResult" class="param-result">
        <div>寄存器 [{{ paramRegText }}] {{ paramNameText }}：</div>
        <div class="mono">原始: {{ paramRawHex }}</div>
        <div class="mono" v-if="paramDisplayText">数值: {{ paramDisplayText }} {{ paramUnitText }}</div>
        <div class="mono" v-if="paramAsciiText">ASCII: {{ paramAsciiText }}</div>
      </div>

      <el-divider content-position="left">写入（需工厂模式）</el-divider>
      <div class="param-row">
        <el-select v-model="paramWriteReg" size="small" filterable placeholder="选择参数" style="flex: 1" :disabled="!connected">
          <el-option v-for="p in writableParams" :key="p.index" :label="`[${p.index}] ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`" :value="p.index" />
        </el-select>
        <el-input-number v-model="paramWriteVal" size="small" :min="0" :max="65535" controls-position="right" style="width: 140px" />
        <el-button size="small" type="warning" :disabled="!connected" @click="writeParam">写入</el-button>
      </div>
      <div class="tip">写入会自动进入→写→退出工厂模式；ASCII 类参数请通过读取查看。</div>
    </el-card>

    <!-- ============ 密码 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><Lock /></el-icon> 密码</span></template>
      <div class="pwd-block">
        <div class="pwd-title">工厂密码 (0x0B)</div>
        <div class="param-row">
          <el-input-number v-model="oldPwd" :min="0" :max="65535" size="small" controls-position="right" style="width: 150px" />
          <span class="tip">原密码(默认0x5678)</span>
          <el-input-number v-model="newPwd" :min="0" :max="65535" size="small" controls-position="right" style="width: 150px" />
          <span class="tip">新密码</span>
          <el-button size="small" :disabled="!connected" @click="modifyFactoryPwd">修改</el-button>
        </div>
        <div class="param-row">
          <el-button size="small" :disabled="!connected" @click="clearFactoryPwd">清除(恢复默认0x5678)</el-button>
        </div>
      </div>
      <el-divider />
      <div class="pwd-block">
        <div class="pwd-title">蓝牙密码</div>
        <div class="param-row">
          <el-input v-model="btOld" size="small" placeholder="原密码6位" style="width: 140px" />
          <el-input v-model="btNew" size="small" placeholder="新密码6位" style="width: 140px" />
        </div>
        <div class="param-row">
          <el-button size="small" :disabled="!connected || !btNew" @click="btPair">配对(设密码)</el-button>
          <el-button size="small" :disabled="!connected || !btOld || !btNew" @click="btModify">修改密码</el-button>
        </div>
      </div>
    </el-card>

    <!-- ============ 加热控制 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title"><el-icon><Sunny /></el-icon> 加热控制 (0xFC)</span></template>
      <div class="param-row">
        <span class="tip">启动温度</span>
        <el-input-number v-model="heatStartTemp" :min="-127" :max="127" size="small" controls-position="right" style="width: 120px" />
        <span class="tip">停止温度</span>
        <el-input-number v-model="heatStopTemp" :min="-127" :max="127" size="small" controls-position="right" style="width: 120px" />
        <el-button size="small" type="warning" :disabled="!connected" @click="heatStart">启动加热</el-button>
        <el-button size="small" :disabled="!connected" @click="heatStop">停止加热</el-button>
      </div>
    </el-card>

    <!-- ============ 指令响应 ============ -->
    <el-card class="sec" shadow="never">
      <template #header><span class="sec-title">最近指令响应</span></template>
      <div v-if="!ackHistory.length" class="tip">暂无</div>
      <div v-for="(a, i) in ackHistory" :key="i" class="ack-line mono">{{ a }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh, DataBoard, Operation, Histogram, Switch, MagicStick, Setting, Lock, Sunny, TrendCharts,
} from '@element-plus/icons-vue'
import {
  buildReadBasicInfo, buildReadCellVoltages, buildReadHardwareVersion,
  buildReadProtectCounts,   buildReadChipType, buildReadInternalRes,
  buildControlMOS, MOS_TYPE, MOS_ACTION,
  buildControlCommand, CONTROL_FUNC,
  buildEnterFactory, buildExitFactory, buildReadParam, buildWriteParam,
  buildFactoryPwdModify, buildFactoryPwdClear,
  buildBtPair, buildBtPwdModify, buildHeating,
  parseBasicInfo, parseCellVoltages, parseHardwareVersion, parseProtectCounts, parseInternalRes,
  PROTECT_BIT, type BasicInfo, type Frame,
} from '@/jbd/jbd-protocol'
import { jbdBus } from '@/jbd/jbd-bus'
import LineChart from './LineChart.vue'
import { PARAM_TABLE, CHIP_TYPES, paramFormat, paramDispUnit } from '@/jbd/jbd-params'

const props = defineProps<{ connected: boolean }>()

// ===== 状态 =====
const basicInfo = ref<BasicInfo | null>(null)
const cellVoltages = ref<number[]>([])
const internalRes = ref<number[]>([])
const hwVersion = ref('')
const protectCounts = ref<Record<string, number>>({})
const chipType = ref<number | null>(null)
const paramResult = ref<{ reg: number; values: number[] } | null>(null)
const ackHistory = ref<string[]>([])
const inFactory = ref(false)
const autoPollProxy = ref(false)

// 参数表单
const paramReg = ref(0)
const paramCount = ref(1)
const paramWriteReg = ref(2)
const paramWriteVal = ref(0)

// 密码表单
const oldPwd = ref(0x5678)
const newPwd = ref(0)
const btOld = ref('')
const btNew = ref('')

// 加热表单
const heatStartTemp = ref(5)
const heatStopTemp = ref(15)

// ===== 派生 =====
const cellMax = computed(() => (cellVoltages.value.length ? Math.max(...cellVoltages.value) : 0))
const cellMin = computed(() => (cellVoltages.value.length ? Math.min(...cellVoltages.value) : 0))
const activeProtects = computed(() => {
  if (!basicInfo.value) return []
  const out: string[] = []
  for (let bit = 0; bit <= 15; bit++) {
    if (basicInfo.value.protectStatus & (1 << bit)) out.push(PROTECT_BIT[bit] || `bit${bit}`)
  }
  return out
})
const writableParams = computed(() => PARAM_TABLE.filter(p => !p.ascii))

// 0xFA 读取结果的可读格式化（含小数/偏移换算）
const paramRegText = computed(() => paramResult.value?.reg ?? 0)
const paramNameText = computed(() => paramResult.value ? paramName(paramResult.value.reg) : '')
const paramRawHex = computed(() =>
  paramResult.value ? paramResult.value.values.map(v => '0x' + v.toString(16).padStart(4, '0').toUpperCase()).join(' ') : '')
const paramDisplayText = computed(() => {
  if (!paramResult.value || paramIsAscii(paramResult.value.reg)) return ''
  return paramResult.value.values.map((v, i) => paramFormat(paramResult.value!.reg + i, v)).join(', ')
})
const paramAsciiText = computed(() =>
  paramResult.value && paramIsAscii(paramResult.value.reg) ? paramAscii(paramResult.value.values) : '')
const paramUnitText = computed(() => paramResult.value ? paramDispUnit(paramResult.value.reg) : '')

function paramName(reg: number) { return PARAM_TABLE.find(p => p.index === reg)?.name || '未知' }
function paramIsAscii(reg: number) { return !!PARAM_TABLE.find(p => p.index === reg)?.ascii }
function paramAscii(values: number[]): string {
  const bytes: number[] = []
  values.forEach(v => { bytes.push((v >> 8) & 0xff, v & 0xff) })
  return bytes.filter(b => b > 0 && b < 128).map(b => String.fromCharCode(b)).join('')
}

function cellColor(v: number): string {
  const volt = v / 1000
  if (volt < 3.0) return '#f56c6c'
  if (volt > 4.25) return '#e6a23c'
  return '#00BFA5'
}

// ===== 会话 / 帧分发（订阅共享帧总线） =====
let unsub: (() => void) | null = null
onMounted(() => { unsub = jbdBus.onFrame((f) => handleFrame(f)) })

function handleFrame(f: Frame) {
  if (!f.valid) { ackHistory.value.unshift(`[0x${f.cmd.toString(16).padStart(2, '0')}] 校验失败`); return }
  if (f.status !== 0x00) {
    const map: Record<number, string> = {
      0x80: '命令码不存在', 0x81: '操作无效/未进工厂模式', 0x82: '校验错误',
      0x83: '密码配对错误', 0x84: '密码修改失败',
    }
    const msg = map[f.status] || `状态0x${f.status.toString(16)}`
    ackHistory.value.unshift(`[0x${f.cmd.toString(16).padStart(2, '0')}] ${msg}`)
    ElMessage.warning(`指令 0x${f.cmd.toString(16).padStart(2, '0')} 返回: ${msg}`)
    return
  }
  switch (f.cmd) {
    case 0x03: basicInfo.value = parseBasicInfo(f.data); recordSample(); break
    case 0x04: cellVoltages.value = parseCellVoltages(f.data); recordSample(); break
    case 0x05: hwVersion.value = parseHardwareVersion(f.data); ElMessage.success('硬件版本: ' + hwVersion.value); break
    case 0xaa: protectCounts.value = parseProtectCounts(f.data); break
    case 0xf6: internalRes.value = parseInternalRes(f.data); break
    case 0x00: chipType.value = f.data[0] ?? null; ElMessage.success('芯片类型: ' + (CHIP_TYPES[chipType.value!] || '未知')); break
    case 0xfa:
      if (f.data.length >= 3) {
        const reg = (f.data[0] << 8) | f.data[1]
        const count = f.data[2]
        const values: number[] = []
        for (let i = 0; i < count; i++) values.push(((f.data[3 + i * 2] << 8) | f.data[4 + i * 2]) & 0xffff)
        paramResult.value = { reg, values }
      }
      break
    default:
      ackHistory.value.unshift(`[0x${f.cmd.toString(16).padStart(2, '0')}] 成功`)
  }
  if (ackHistory.value.length > 50) ackHistory.value = ackHistory.value.slice(0, 50)
}

// ===== 发送（经共享帧总线写串口）=====
function send(frame: number[]) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  jbdBus.send(frame)
}
function pollSend(frame: number[]) { if (props.connected) jbdBus.send(frame) }

// ===== 读取指令 =====
function readBasic() { send(buildReadBasicInfo()) }
function readCells() { send(buildReadCellVoltages()) }
function readHw() { send(buildReadHardwareVersion()) }
function readProtect() { send(buildReadProtectCounts()) }
function readChip() { send(buildReadChipType()) }
function readRes() { send(buildReadInternalRes()) }

// ===== 自动轮询 =====
let pollTimer: number | null = null
function onPollChange(v: boolean) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (v) {
    pollTimer = window.setInterval(() => {
      pollSend(buildReadBasicInfo()); pollSend(buildReadCellVoltages())
    }, 2000)
  }
}
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); unsub?.() })

// ===== 趋势历史采样 =====
interface Sample {
  t: number
  total: number
  current: number
  cells: number[]
  temps: number[]
  minC: number
  maxC: number
  diffC: number
}
const MAX_HISTORY = 600
const history = ref<Sample[]>([])
const recordTrend = ref(true)
const trendMetric = ref<'overview' | 'pack' | 'cells' | 'temps'>('overview')

function recordSample() {
  if (!recordTrend.value || !basicInfo.value) return
  const cells = cellVoltages.value
  history.value.push({
    t: Date.now(),
    total: basicInfo.value.totalVoltage_mV / 1000,
    current: basicInfo.value.current_mA / 1000,
    cells: [...cells],
    temps: [...basicInfo.value.temperatures_C],
    minC: cells.length ? Math.min(...cells) / 1000 : 0,
    maxC: cells.length ? Math.max(...cells) / 1000 : 0,
    diffC: cells.length ? (Math.max(...cells) - Math.min(...cells)) / 1000 : 0,
  })
  if (history.value.length > MAX_HISTORY) history.value = history.value.slice(-MAX_HISTORY)
}
function clearTrend() { history.value = [] }

const CELL_COLORS = ['#00BFA5', '#409EFF', '#E6A23C', '#F56C6C', '#67C23A', '#9B59B6', '#1ABC9C', '#FF7F50', '#8E44AD', '#2ECC71']
const trendSeries = computed(() => {
  const h = history.value
  if (!h.length) return []
  switch (trendMetric.value) {
    case 'overview':
      return [
        { name: '总压(V)', color: '#00BFA5', data: h.map(s => s.total) },
        { name: '最高单体(V)', color: '#E6A23C', data: h.map(s => s.maxC) },
        { name: '最低单体(V)', color: '#F56C6C', data: h.map(s => s.minC) },
        { name: '压差(mV)', color: '#9B59B6', data: h.map(s => +(s.diffC * 1000).toFixed(0)) },
      ]
    case 'pack':
      return [
        { name: '总压(V)', color: '#00BFA5', data: h.map(s => s.total) },
        { name: '电流(A)', color: '#409EFF', data: h.map(s => s.current) },
      ]
    case 'cells': {
      const n = h[0].cells.length
      return Array.from({ length: n }, (_, i) => ({
        name: `C${i + 1}`,
        color: CELL_COLORS[i % CELL_COLORS.length],
        data: h.map(s => s.cells[i] ? s.cells[i] / 1000 : 0),
      }))
    }
    case 'temps': {
      const n = h[0].temps.length
      return Array.from({ length: n }, (_, i) => ({
        name: `NTC${i + 1}`,
        color: CELL_COLORS[i % CELL_COLORS.length],
        data: h.map(s => s.temps[i] ?? 0),
      }))
    }
  }
  return []
})
const trendUnit = computed(() => (trendMetric.value === 'overview' ? 'V / mV' : trendMetric.value === 'pack' ? 'V / A' : trendMetric.value === 'temps' ? '℃' : 'V'))

// ===== MOS 控制 =====
function setMos(type: number, open: boolean) {
  send(buildControlMOS(type, open ? MOS_ACTION.RELEASE : MOS_ACTION.CLOSE))
}
function setMosBoth(open: boolean) {
  send(buildControlMOS(MOS_TYPE.CHARGE_DISCHARGE, open ? MOS_ACTION.RELEASE : MOS_ACTION.CLOSE))
}

// ===== 控制指令 =====
const controlButtons: { label: string; fn: readonly number[] }[] = [
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
function runControl(fn: readonly number[]) { send(buildControlCommand(fn)) }

// ===== 参数读写 =====
function enterFactory() { send(buildEnterFactory()); inFactory.value = true }
function exitFactory() { send(buildExitFactory()); inFactory.value = false }
function readParam() { send(buildReadParam(paramReg.value, paramCount.value)) }
async function writeParam() {
  if (!inFactory.value) { send(buildEnterFactory()); inFactory.value = true }
  send(buildWriteParam(paramWriteReg.value, [(paramWriteVal.value >> 8) & 0xff, paramWriteVal.value & 0xff]))
  send(buildExitFactory()); inFactory.value = false
}

// ===== 密码 =====
function modifyFactoryPwd() { send(buildFactoryPwdModify(oldPwd.value, newPwd.value)) }
function clearFactoryPwd() { send(buildFactoryPwdClear()) }
function digits(s: string): number[] {
  return s.split('').map(c => parseInt(c, 10)).filter(n => !isNaN(n) && n >= 0 && n <= 9)
}
function btPair() {
  const d = digits(btNew.value)
  if (d.length !== 6) { ElMessage.warning('请填写 6 位蓝牙密码'); return }
  send(buildBtPair(d))
}
function btModify() {
  const o = digits(btOld.value), n = digits(btNew.value)
  if (o.length !== 6 || n.length !== 6) { ElMessage.warning('请填写 6 位蓝牙密码'); return }
  send(buildBtPwdModify(o, n))
}

// ===== 加热 =====
function heatStart() { send(buildHeating(0x01, 0, 0, heatStartTemp.value, heatStopTemp.value)) }
function heatStop() { send(buildHeating(0x02, 0, 0, 0, 0)) }
</script>

<style scoped>
.jbd-panel {
  padding: 16px;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.jbd-panel > * { min-width: 0; }
.sec { background: #1a1e24; border: 1px solid #2a2e34; }
.sec :deep(.el-card__header) { padding: 10px 14px; border-bottom: 1px solid #2a2e34; display: flex; align-items: center; gap: 8px; }
.sec-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: #f0f1f2; }
.sec-title .el-icon { color: #00BFA5; }
.sub { font-size: 12px; color: #8a8e94; margin-left: auto; }
.btn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.poll-row { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
.tip { font-size: 12px; color: #6a6e74; }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat { background: #0c0e10; border: 1px solid #2a2e34; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.stat .k { font-size: 12px; color: #8a8e94; }
.stat .v { font-size: 15px; font-weight: 600; color: #f0f1f2; font-family: 'JetBrains Mono', monospace; }
.stat .v.pos { color: #00BFA5; }
.stat .v.neg { color: #f56c6c; }
.tag-row { margin-top: 10px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tag-row .lbl { font-size: 12px; color: #8a8e94; }
.cell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
.cell { background: #0c0e10; border: 1px solid #2a2e34; border-radius: 6px; padding: 6px 4px; text-align: center; }
.cell-idx { display: block; font-size: 11px; color: #6a6e74; }
.cell-v { display: block; font-size: 13px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
.mos-row { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
.mos-item { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #b0b4ba; }
.btn-group { flex-direction: row; gap: 8px; }
.param-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.param-result { background: #0c0e10; border: 1px solid #2a2e34; border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #c0c4ca; }
.param-result .mono { word-break: break-all; }
.mono { font-family: 'JetBrains Mono', monospace; }
.pwd-block { margin-bottom: 6px; }
.pwd-title { font-size: 13px; color: #b0b4ba; margin-bottom: 8px; }
.ack-line { font-size: 12px; color: #8a8e94; padding: 2px 0; border-bottom: 1px solid #1a1e24; word-break: break-all; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
.lg-item { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #b0b4ba; }
.lg-item i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
</style>
