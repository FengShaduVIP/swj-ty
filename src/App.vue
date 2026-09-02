<template>
  <div class="app" :class="{ 'app-compact': compact }">
    <!-- ============ 顶部状态栏（h48 · DESIGN 4.8）============ -->
    <header class="statusbar">
      <div class="sb-left">
        <div class="brand">
          <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="7" width="15" height="10" rx="2" />
            <rect x="18.5" y="10" width="2.5" height="4" rx="1" />
            <path d="M11 9.5 L9 12.5 L11 12.5 L9.5 15" />
          </svg>
          <div class="brand-text">
            <div class="brand-name">天一BMS</div>
            <div class="brand-sub">天一锂能新能源</div>
          </div>
        </div>
        <div class="sb-divider" />
        <ConnIndicator :state="ui.conn" :port-path="ui.portPath" :baud-rate="ui.baudRate" />
      </div>

      <div class="sb-center">
        <div v-for="r in readouts" :key="r.k" class="sb-readout">
          <span class="sb-rk">{{ r.k }}</span>
          <span class="sb-rv num" :style="{ color: r.color }">{{ r.v }}</span>
        </div>

        <!-- 顶部快速串口连接 -->
        <div class="sb-divider" />
        <div class="sb-port">
          <el-select
            v-model="topPort"
            placeholder="选择串口"
            size="small"
            :disabled="connected"
            style="width: 156px"
            @focus="handleRefreshPorts"
          >
            <el-option
              v-for="port in ports"
              :key="port.path"
              :label="`${port.path} ${port.manufacturer || ''}`"
              :value="port.path"
            />
          </el-select>
          <button
            class="sb-icon"
            title="刷新串口列表"
            :disabled="connected"
            @click="handleRefreshPorts"
          >
            <el-icon :size="14"><Refresh /></el-icon>
          </button>
          <el-button
            v-if="!connected"
            type="primary"
            size="small"
            :disabled="!topPort"
            :loading="ui.conn === 'connecting'"
            @click="onTopConnect"
          >
            连接
          </el-button>
          <el-button
            v-else
            type="danger"
            size="small"
            @click="handleDisconnect"
          >
            断开
          </el-button>
        </div>
      </div>

      <div class="sb-right">
        <button v-if="ui.alarmCount" class="sb-chip sb-chip--crit" @click="goMonitor">
          <svg class="chip-ico" viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" /></svg>
          告警 {{ ui.alarmCount }}
        </button>
        <span class="sb-rate">采样 <b class="num">{{ rate }}</b> Hz</span>
        <button class="sb-icon" title="检查更新" :disabled="updating" @click="onCheckUpdate">
          <el-icon :size="16" :class="{ 'spin': updating }"><Refresh /></el-icon>
        </button>
        <button class="sb-icon" title="设置" @click="settingsOpen = true">
          <el-icon :size="16"><Setting /></el-icon>
        </button>
        <span class="sb-clock num">{{ clock }}</span>
        <span class="sb-ver">v{{ version }}</span>
      </div>
    </header>

    <!-- ============ 主体：Rail + 工作区 ============ -->
    <div class="body">
      <!-- 左侧导航 Rail（DESIGN 4.8） -->
      <nav class="rail" :class="{ collapsed }">
        <div class="rail-items">
          <button
            v-for="v in views"
            :key="v.key"
            class="rail-item"
            :class="{ active: active === v.key }"
            :title="v.title"
            @click="active = v.key"
          >
            <span class="rail-ico"><el-icon :size="20"><component :is="v.icon" /></el-icon></span>
            <span class="rail-label">{{ v.title }}</span>
            <span v-if="v.key === 'monitor' && ui.alarmCount" class="rail-badge">{{ ui.alarmCount }}</span>
          </button>
        </div>
        <button class="rail-collapse" :title="collapsed ? '展开导航 (Ctrl+B)' : '收起导航 (Ctrl+B)'" @click="toggleRail">
          <el-icon :size="16"><component :is="collapsed ? Expand : Fold" /></el-icon>
          <span v-if="!collapsed" class="rail-collapse-label">收起</span>
        </button>
      </nav>

      <!-- 工作区 -->
      <main class="work">
        <!-- 视图工具栏（h40 · DESIGN 4.8） -->
        <div class="toolbar">
          <button class="tb-toggle" title="切换导航 (Ctrl+B)" @click="toggleRail">
            <el-icon :size="16"><component :is="collapsed ? Expand : Fold" /></el-icon>
          </button>
          <h2 class="tb-title">{{ activeView.title }}</h2>
          <div class="tb-spacer" />
          <div class="tb-hint">{{ activeView.hint }}</div>
        </div>

        <!-- 迷你告警条（DESIGN 4.8） -->
        <div v-if="ui.alarmCount" class="alertbar" @click="goMonitor">
          <span class="ab-ico">✕</span>
          <span class="ab-text">存在 {{ ui.alarmCount }} 条保护 / 告警</span>
          <span class="ab-action">查看全部 ›</span>
        </div>

        <!-- 内容区 -->
        <section class="content">
          <SerialPanel
            v-show="active === 'connect'"
            :connected="connected"
            :port-path="portPath"
            :ports="ports"
            v-model:selected-port="topPort"
            :logs="dataLogs"
            @connect="handleConnect"
            @disconnect="handleDisconnect"
            @refresh="handleRefreshPorts"
            @clear="dataLogs = []"
          />
          <JbdPanel v-show="active === 'monitor'" :connected="connected" />
          <JbdParamConfig v-show="active === 'config'" :connected="connected" :logs="dataLogs" />
          <DispatchLog v-show="active === 'log'" />
        </section>
      </main>
    </div>

    <!-- ============ 底部状态条（h26 · DESIGN 4.8）============ -->
    <footer class="footer">
      <span class="ft-left">{{ statusHint }}</span>
      <span class="ft-center num">采样 {{ ui.sampleCount }} · {{ rate }} Hz</span>
      <span class="ft-right num">{{ clock }} · v{{ version }}</span>
    </footer>

    <!-- ============ 设置 / 关于（含密度切换 · DESIGN 7.2）============ -->
    <el-dialog
      v-model="settingsOpen"
      title="设置"
      width="560px"
      align-center
      class="vg-dialog"
      @close="onSettingsClose"
    >
      <div class="set-row">
        <div>
          <div class="set-name">界面密度</div>
          <div class="set-desc">紧凑：缩小卡片内边距与控件高度，适配产线远距离查看</div>
        </div>
        <el-segmented v-model="compact" :options="[{ label: '标准', value: false }, { label: '紧凑', value: true }]" />
      </div>
      <el-divider />
      <div class="set-row set-row--col">
        <div class="set-head">
          <div>
            <div class="set-name">USB 自动连接</div>
            <div class="set-desc">检测到匹配的 USB 串口设备（按 VID/PID）时自动连接，并在收到 BMS 应答后跳转到实时监测页。需设备已安装串口驱动（CH340/CP210x/FTDI 等）。</div>
          </div>
          <el-switch v-model="autoconn.enabled" />
        </div>
        <div v-if="autoconn.enabled" class="set-grid">
          <div class="set-field">
            <label>厂商ID (VID)</label>
            <el-input v-model="autoconn.vendorId" placeholder="如 1A86" />
          </div>
          <div class="set-field">
            <label>产品ID (PID)</label>
            <el-input v-model="autoconn.productId" placeholder="如 7523" />
          </div>
          <div class="set-field">
            <label>名称关键字</label>
            <el-input v-model="autoconn.friendlyName" placeholder="可选，如 CH340" />
          </div>
          <div class="set-field">
            <label>波特率</label>
            <el-select v-model="autoconn.baudRate" :options="BAUD_OPTIONS.map(b => ({ label: b, value: b }))" />
          </div>
          <div class="set-field">
            <label>数据位</label>
            <el-select v-model="autoconn.dataBits" :options="DATABIT_OPTIONS.map(d => ({ label: d, value: d }))" />
          </div>
          <div class="set-field">
            <label>停止位</label>
            <el-select v-model="autoconn.stopBits" :options="STOPBIT_OPTIONS.map(s => ({ label: String(s), value: s }))" />
          </div>
          <div class="set-field">
            <label>校验位</label>
            <el-select v-model="autoconn.parity" :options="PARITY_OPTIONS" />
          </div>
        </div>
      </div>
      <el-divider />
      <div class="about">
        <div class="about-name">天一BMS · 天一锂能新能源</div>
        <div class="about-meta num">设计系统 VG-Dark v1.0 · 版本 v{{ version }}</div>
        <div class="about-meta">视觉语言：工业深色 · 仪器面板 · 等宽数值 · 状态驱动配色</div>
      </div>
      <el-divider />
      <div class="set-row set-row--col">
        <div class="set-head">
          <div>
            <div class="set-name">软件更新</div>
            <div class="set-desc">仅在点击「检查更新」时检查；发现新版本需你确认后才下载，不会自动更新。更新源：{{ updaterConfig?.source || 'GitHub Releases' }}。</div>
            <div class="set-desc set-desc--mirror">
              国内镜像（安装包自动同步自 GitHub）：
              <span class="link" @click="openGitee">Gitee 手动下载</span>
            </div>
          </div>
          <el-button size="small" :loading="updating" @click="onCheckUpdate">{{ updaterBtnText }}</el-button>
        </div>
        <div v-if="updaterStatus" class="about-meta" :class="`up-state--${updaterState.state}`">{{ updaterStatus }}</div>
      </div>
      <template #footer>
        <el-button @click="settingsOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- ============ 软件更新提示（右下角，不打断业务）============ -->
    <UpdateNotifier />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, markRaw } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, DataBoard, Setting, Fold, Expand, Operation, Refresh, Tickets } from '@element-plus/icons-vue'
import SerialPanel from './components/SerialPanel.vue'
import JbdPanel from './components/JbdPanel.vue'
import JbdParamConfig from './components/JbdParamConfig.vue'
import DispatchLog from './components/DispatchLog.vue'
import ConnIndicator from './components/ConnIndicator.vue'
import UpdateNotifier from './components/UpdateNotifier.vue'
import { useUpdater } from './composables/useUpdater'
import { ui, setConnected, setConnecting, setDisconnected, markCommError } from './store'
import { jbdBus } from './jbd/jbd-bus'
import { describeFrame as describeJbdFrame } from './jbd/jbd-protocol'
import { useJbd } from './jbd/useJbd'
import pkg from '../package.json'
import { LOG_MAX_LINES } from './constants'

const version = (pkg as any).version || '1.0.0'

// ===== 自动更新（共享状态 + 手动检查入口）=====
const { status: updaterState, config: updaterConfig, checkNow } = useUpdater()
const updating = ref(false)
const updaterBtnText = computed(() => (updating.value ? '检查中' : '检查更新'))
const updaterStatus = computed(() => {
  const s = updaterState.value
  switch (s.state) {
    case 'checking': return '正在检查更新…'
    case 'available': return `发现新版本 v${s.latestVersion}，等待确认更新`
    case 'downloading': return `正在下载 v${s.latestVersion}（${Math.floor(s.progress?.percent || 0)}%）`
    case 'downloaded': return `新版本 v${s.latestVersion} 已下载，重启后生效`
    case 'not-available': return `已是最新版本 v${s.currentVersion}`
    case 'error': return `更新检查失败：${s.error || '未知错误'}`
    case 'dev-disabled': return '开发模式：不检查更新'
    default: return ''
  }
})
async function onCheckUpdate() {
  updating.value = true
  try { await checkNow() }
  finally { setTimeout(() => { updating.value = false }, 600) }
}

// 在系统默认浏览器打开 Gitee 发行版（国内镜像手动下载入口）
function openGitee() {
  window.shellAPI?.openExternal('https://gitee.com/tianip/swj-ty/releases')
}

// ===== 导航视图定义（按协议动态切换）=====
interface ViewDef {
  key: string
  title: string
  hint: string
  icon: any
}
const JBD_VIEWS = markRaw<ViewDef[]>([
  { key: 'connect', title: '设备连接', hint: '配置串口参数并建立与 BMS 的通信链路', icon: Connection },
  { key: 'monitor', title: '实时监测', hint: '只读遥测：基本信息、趋势曲线、单体电压分布与内阻', icon: DataBoard },
  { key: 'config',  title: '参数配置', hint: '读写 0xFA 保护参数寄存器（支持导入/导出）', icon: Operation },
  { key: 'log',     title: '下发记录', hint: '强制下发的本地历史记录（时间 / 蓝牙名称 / 具体参数），可查询与导出', icon: Tickets },
])
const views = JBD_VIEWS
const active = ref('monitor')
const activeView = computed(() => views.find((v) => v.key === active.value)!)

// ===== Rail 折叠（持久化 · Ctrl+B）=====
const collapsed = ref(localStorage.getItem('vg_rail_collapsed') === '1')
function toggleRail() {
  collapsed.value = !collapsed.value
  localStorage.setItem('vg_rail_collapsed', collapsed.value ? '1' : '0')
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleRail() }
}

// ===== 状态 =====
const connected = computed(() => ui.conn === 'connected')
const portPath = ref('')
const ports = ref<SerialPortInfo[]>([])
const topPort = ref('')
// 串口连接成功后，把顶部下拉框同步到当前端口；断开时保留原选择，方便重连
watch(() => ui.portPath, (p) => { if (p) topPort.value = p }, { immediate: true })

interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  content: string
}
const dataLogs = ref<LogEntry[]>([])

function addLog(type: LogEntry['type'], content: string) {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + now.getMilliseconds().toString().padStart(3, '0')
  dataLogs.value.push({ time, type, content })
  if (dataLogs.value.length > LOG_MAX_LINES) dataLogs.value = dataLogs.value.slice(-LOG_MAX_LINES)
}

// ===== 串口连接 =====
async function handleConnect(config: SerialConnectConfig) {
  setConnecting()
  try {
    await window.serialAPI.connect(config)
    portPath.value = config.path
    setConnected(config.path, config.baudRate)
    addLog('info', `串口已连接: ${config.path} @ ${config.baudRate}bps`)
  } catch (err: any) {
    setDisconnected()
    ElMessage.error('连接失败: ' + (err.message || err))
    addLog('error', `连接失败: ${err.message || err}`)
  }
}
async function handleDisconnect() {
  try {
    await window.serialAPI.disconnect()
    setDisconnected()
    portPath.value = ''
    addLog('info', '串口已断开')
  } catch (err: any) {
    ElMessage.error('断开失败: ' + (err.message || err))
  }
}
function onTopConnect() {
  if (!topPort.value) return
  handleConnect({
    path: topPort.value,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  })
}
async function handleRefreshPorts(): Promise<SerialPortInfo[]> {
  try {
    const list = await window.serialAPI.listPorts()
    ports.value = list
    addLog('info', `刷新串口列表: 找到 ${list.length} 个串口`)
    return list
  } catch (err: any) {
    ElMessage.error('获取串口列表失败: ' + (err.message || err))
    ports.value = []
    return []
  }
}

async function handleSend(data: number[]) {
  // 最终防线：若连接已断开，直接丢弃，不再调用底层 send 抛错污染日志。
  // 因为轮询器/自动连接的状态同步存在微小竞态，可能在本帧仍认为已连接。
  if (!connected.value) return
  try {
    await window.serialAPI.send(data)
    const hex = data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    const desc = describeJbdFrame(data)
    const prefix = desc ? `${desc}-->主机发送：` : '发送: '
    addLog('send', `${prefix}${hex}`)
  } catch (err: any) {
    const msg = err?.message || String(err)
    // 已明确是"未连接"类的异常时，不再重复报红；其它真实发送错误仍保留。
    if (msg.includes('未连接') || msg.includes('Serial port not open') || msg.includes('Closed')) {
      addLog('info', `发送忽略: ${msg}`)
      return
    }
    ElMessage.error('发送失败: ' + msg)
    addLog('error', `发送失败: ${msg}`)
  }
}

function goMonitor() { active.value = 'monitor' }

// ===== 自动连接配置（持久化 + VID/PID 匹配）=====
const AUTO_KEY = 'vg_autoconnect'
interface AutoCfg {
  enabled: boolean
  vendorId: string
  productId: string
  friendlyName: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 1.5 | 2
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space'
}
const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200]
const DATABIT_OPTIONS: (5 | 6 | 7 | 8)[] = [7, 8]
const STOPBIT_OPTIONS: (1 | 1.5 | 2)[] = [1, 1.5, 2]
const PARITY_OPTIONS: { label: string; value: AutoCfg['parity'] }[] = [
  { label: '无 (None)', value: 'none' },
  { label: '偶校验 (Even)', value: 'even' },
  { label: '奇校验 (Odd)', value: 'odd' },
]
const defaultAuto: AutoCfg = { enabled: false, vendorId: '', productId: '', friendlyName: '', baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' }
function loadAuto(): AutoCfg {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_KEY) || '{}')
    return { ...defaultAuto, ...saved }
  } catch {
    return { ...defaultAuto }
  }
}
const autoconn = ref<AutoCfg>(loadAuto())

function saveAuto() { localStorage.setItem(AUTO_KEY, JSON.stringify(autoconn.value)) }
function applyAutoConnect() {
  if (autoconn.value.enabled) {
    window.serialAPI?.setAutoConnect?.(true, { ...autoconn.value })
  } else {
    window.serialAPI?.setAutoConnect?.(false)
  }
}
function onSettingsClose() {
  saveAuto()
  applyAutoConnect()
}

// ===== 连接成功后验证 BMS 应答再跳转实时监测页 =====
const { basicInfo, readBasic } = useJbd()
const pendingVerify = ref(false)
const pendingJump = ref(false)
let verifyTimer: ReturnType<typeof setTimeout> | null = null
// 嘉百达等设备在串口刚打开后首帧常被丢弃（第一次发送无返回，第二次才有应答）。
// 连接验证补发多次（间隔 400ms），任一收到即成功，彻底规避首帧丢弃导致的「超时无响应」。
let verifyRetryTimers: number[] = []
function clearVerifyRetries() {
  verifyRetryTimers.forEach((t) => clearTimeout(t))
  verifyRetryTimers = []
}
function startVerify(autoJump = false) {
  pendingVerify.value = true
  pendingJump.value = autoJump
  clearVerifyRetries()
  // 第 0 次立即发（可能丢弃），其后每 400ms 补发一次，最多 3 次
  for (let i = 0; i < 3; i++) {
    const t = window.setTimeout(() => { if (pendingVerify.value) readBasic() }, i * 400)
    verifyRetryTimers.push(t)
  }
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = setTimeout(() => {
    clearVerifyRetries()
    if (pendingVerify.value) {
      pendingVerify.value = false
      pendingJump.value = false
      ElMessage.warning('串口已打开，但未收到 BMS 应答，请确认设备与串口参数')
    }
  }, 3000)
}
watch(basicInfo, (v) => {
  if (v && pendingVerify.value) {
    pendingVerify.value = false
    clearVerifyRetries()
    const shouldJump = pendingJump.value
    pendingJump.value = false
    if (verifyTimer) { clearTimeout(verifyTimer); verifyTimer = null }
    // 仅自动连接成功才自动跳转到实时监测页；手动连接只验证、停留当前页
    if (shouldJump) active.value = 'monitor'
  }
})

function handleStatusChange(status: SerialStatus) {
  if (status.connected) {
    portPath.value = status.portPath || ''
    setConnected(status.portPath || '', ui.baudRate)
    jbdBus.setConnected(true)
    // 仅自动连接成功才验证后跳转；手动连接只验证、不跳转
    startVerify(!!status.auto)
  } else {
    setDisconnected()
    jbdBus.setConnected(false)
    pendingVerify.value = false
    pendingJump.value = false
  }
}

// ===== 顶部状态栏关键读数（来自 store.ui.live）=====
const readouts = computed(() => {
  const l = ui.live
  const fmt = (v: number | null, d = 2, u = '') => (v === null ? '--' : v.toFixed(d) + (u ? ' ' + u : ''))
  return [
    { k: '总压', v: fmt(l.totalVoltage_V, 2, 'V'), color: 'var(--data-voltage)' },
    { k: '电流', v: fmt(l.current_A, 2, 'A'), color: l.current_A != null && l.current_A < 0 ? 'var(--data-temp)' : 'var(--data-current)' },
    { k: 'SOC', v: fmt(l.soc, 1, '%'), color: 'var(--data-soc)' },
    { k: '最高温', v: fmt(l.maxTemp_C, 1, '℃'), color: 'var(--data-temp)' },
  ]
})

const statusHint = computed(() => {
  if (!connected.value) return '未连接设备 · 请前往「设备连接」建立串口通信'
  if (ui.conn === 'error') return '通信异常 · 检测不到设备响应'
  return `已连接 ${ui.portPath} @ ${ui.baudRate} · 数据链路正常`
})

// ===== 采样率 / 时钟 =====
const rate = ref(0)
const clock = ref('')
let lastCount = 0
let tickTimer: number | null = null
function tick() {
  const now = new Date()
  clock.value = now.toLocaleTimeString('zh-CN', { hour12: false })
  rate.value = ui.sampleCount - lastCount
  lastCount = ui.sampleCount
}

// ===== 设置 =====
const settingsOpen = ref(false)
const compact = ref(localStorage.getItem('vg_density') === '1')

// ===== 生命周期 =====
onMounted(() => {
  window.addEventListener('keydown', onKey)
  tickTimer = window.setInterval(tick, 1000)
  tick()
  // 启用自动连接时先停留在「设备连接」页，连接验证成功后再跳转到实时监测页
  if (autoconn.value.enabled) active.value = 'connect'
  // 关键：把帧总线接到真实串口。否则 jbdBus.send/sendAck 发现 sender 为 null，
  // 会立即返回超时帧，表现为「发送数据没有成功 / 读不到应答」。
  jbdBus.setSender(handleSend)

  window.serialAPI?.onData?.((data: number[]) => {
    const bytes = Array.from(data)
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    addLog('recv', `接收: ${hex}`)
    // 把原始字节喂给 JBD 帧总线
    jbdBus.feed(bytes)
  })
  window.serialAPI?.onError?.((error: string) => {
    addLog('error', error)
    markCommError()
  })
  window.serialAPI?.onStatusChange?.((status: SerialStatus) => {
    handleStatusChange(status)
  })

  // 按持久化的配置启动自动连接（若启用），在监听器就绪后再开启
  applyAutoConnect()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (tickTimer) clearInterval(tickTimer)
  window.serialAPI?.removeAllListeners?.()
  jbdBus.clear()
})
</script>

<style scoped>
.app {
  display: grid;
  grid-template-rows: var(--h-statusbar) 1fr var(--h-footer);
  height: 100vh;
  background: var(--bg-canvas);
  color: var(--text-primary);
}
.app-compact { --space-6: 12px; --space-5: 10px; --h-control: 30px; }

/* ---------- 顶部状态栏 ---------- */
.statusbar {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-6);
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-strong);
  min-height: 0;
  z-index: var(--z-statusbar);
}
.sb-left { display: flex; align-items: center; gap: var(--space-5); }
.brand { display: flex; align-items: center; gap: var(--space-3); }
.brand-mark { width: 22px; height: 22px; fill: none; stroke: var(--brand); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
.brand-text { display: flex; flex-direction: column; line-height: 1.1; }
.brand-name { font-size: 14px; font-weight: var(--fw-bold); letter-spacing: 0.04em; color: var(--text-primary); }
.brand-sub { font-size: 10px; color: var(--text-tertiary); letter-spacing: 0.02em; }
.sb-divider { width: 1px; height: 22px; background: var(--border-strong); }

.sb-center { display: flex; align-items: center; gap: var(--space-8); margin-left: var(--space-6); }
.sb-readout { display: flex; align-items: baseline; gap: var(--space-3); }
.sb-rk { font-size: var(--fs-label); font-weight: var(--fw-semibold); letter-spacing: 0.06em; color: var(--text-secondary); text-transform: uppercase; }
.sb-rv { font-size: var(--fs-num-md); font-weight: var(--fw-semibold); font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; }

.sb-port { display: flex; align-items: center; gap: var(--space-3); }
.sb-port .el-select { --el-component-size-small: 24px; }
.sb-port .el-button { height: 24px; padding: 0 12px; font-size: var(--fs-caption); }

.sb-right { display: flex; align-items: center; gap: var(--space-5); margin-left: auto; }
.sb-chip {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 24px; padding: 0 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--critical-border); background: var(--critical-bg);
  color: var(--critical); font-size: var(--fs-micro); font-weight: var(--fw-semibold);
  cursor: pointer;
}
.chip-ico { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.sb-rate { font-size: var(--fs-caption); color: var(--text-secondary); }
.sb-rate b { color: var(--text-primary); font-weight: var(--fw-semibold); }
.sb-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  background: transparent; border: 1px solid var(--border-default); color: var(--text-secondary);
  cursor: pointer;
}
.sb-icon:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-strong); }
.sb-icon:disabled { opacity: 0.55; cursor: default; }
.spin { animation: updater-spin 0.9s linear infinite; }
@keyframes updater-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.sb-clock { font-size: var(--fs-caption); color: var(--text-secondary); }
.sb-ver { font-size: var(--fs-caption); color: var(--text-tertiary); }

/* ---------- 主体 ---------- */
.body {
  display: grid;
  grid-template-columns: auto 1fr;
  min-height: 0;
}
.rail { width: var(--w-rail-expanded); }
.rail.collapsed { width: var(--w-rail-collapsed); }

.rail {
  display: flex; flex-direction: column;
  background: var(--bg-canvas);
  border-right: 1px solid var(--border-strong);
  padding: var(--space-4) 0;
  z-index: var(--z-rail);
  transition: width var(--dur-base) var(--ease-standard);
  overflow: hidden;
}
.rail-items { display: flex; flex-direction: column; gap: var(--space-2); padding: 0 var(--space-3); flex: 1; }
.rail-item {
  position: relative;
  display: flex; align-items: center; gap: var(--space-4);
  height: 44px; padding: 0 var(--space-4);
  background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--text-secondary); cursor: pointer; text-align: left;
  border-left: 2px solid transparent;
}
.rail-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.rail-item.active {
  background: var(--brand-bg-subtle);
  border-left: 2px solid var(--brand);
  color: var(--text-primary);
}
.rail-ico { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; color: inherit; }
.rail-item.active .rail-ico { color: var(--brand-text); }
.rail-label { font-size: var(--fs-body-sm); font-weight: var(--fw-medium); white-space: nowrap; opacity: 1; transition: opacity var(--dur-fast); }
.rail-badge {
  position: absolute; right: var(--space-3); top: 50%; transform: translateY(-50%);
  min-width: 16px; height: 16px; padding: 0 5px; border-radius: var(--radius-pill);
  background: var(--critical); color: #fff; font-size: var(--fs-micro); font-weight: var(--fw-semibold);
  display: inline-flex; align-items: center; justify-content: center;
}
.rail.collapsed .rail-label,
.rail.collapsed .rail-badge { display: none; }
.rail.collapsed .rail-item { justify-content: center; padding: 0; }

.rail-collapse {
  display: flex; align-items: center; gap: var(--space-3);
  margin: var(--space-4) var(--space-3) 0;
  height: 32px; padding: 0 var(--space-4);
  background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-secondary); cursor: pointer; font-size: var(--fs-caption);
}
.rail-collapse:hover { background: var(--bg-hover); color: var(--text-primary); }
.rail.collapsed .rail-collapse { justify-content: center; padding: 0; }
.rail.collapsed .rail-collapse-label { display: none; }

/* ---------- 工作区 ---------- */
.work { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-base); }
.toolbar {
  display: flex; align-items: center; gap: var(--space-4);
  height: var(--h-toolbar); padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.tb-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  background: transparent; border: 1px solid var(--border-default); color: var(--text-secondary); cursor: pointer;
}
.tb-toggle:hover { background: var(--bg-hover); color: var(--text-primary); }
.tb-title { font-size: var(--fs-view-title); font-weight: var(--fw-semibold); color: var(--text-primary); }
.tb-spacer { flex: 1; }
.tb-hint { font-size: var(--fs-caption); color: var(--text-tertiary); }

/* 迷你告警条 */
.alertbar {
  display: flex; align-items: center; gap: var(--space-3);
  height: var(--h-alertbar); padding: 0 var(--space-6);
  background: var(--critical-bg); border-bottom: 1px solid var(--critical-border);
  cursor: pointer; flex-shrink: 0;
}
.ab-ico { color: var(--critical); font-weight: var(--fw-bold); }
.ab-text { font-size: var(--fs-caption); color: var(--text-primary); }
.ab-action { margin-left: auto; font-size: var(--fs-caption); color: var(--critical); font-weight: var(--fw-semibold); }

.content { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; }

/* ---------- 底部状态条 ---------- */
.footer {
  display: flex; align-items: center; gap: var(--space-6);
  height: var(--h-footer); padding: 0 var(--space-6);
  background: var(--bg-canvas); border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-caption); color: var(--text-tertiary);
}
.ft-center { margin-left: auto; }
.ft-right { color: var(--text-tertiary); }

/* ---------- 自动连接设置 ---------- */
.set-row--col { flex-direction: column; align-items: stretch; gap: var(--space-4); }
.set-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.set-head .set-desc { max-width: 420px; }
.set-desc--mirror { margin-top: var(--space-2); color: var(--text-tertiary); }
.link {
  color: var(--info);
  cursor: pointer;
  text-decoration: none;
}
.link:hover { text-decoration: underline; }
.set-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4);
  padding: var(--space-4); background: var(--bg-canvas);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
}
.set-field { display: flex; flex-direction: column; gap: var(--space-2); }
.set-field label { font-size: var(--fs-caption); color: var(--text-secondary); font-weight: var(--fw-medium); }

/* 设置页更新状态着色 */
.up-state--downloaded { color: var(--ok-bright); }
.up-state--error { color: var(--critical); }
.up-state--downloading,
.up-state--available { color: var(--info); }
.up-state--not-available,
.up-state--dev-disabled { color: var(--text-tertiary); }
</style>
