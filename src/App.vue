<template>
  <!-- Element Plus 按需引入后，中文 locale 由 config-provider 提供 -->
  <el-config-provider :locale="zhCn">
  <div class="app">
    <!-- ============ 标题栏（h34 · preview 基准，无边框窗口自绘）============ -->
    <header class="titlebar">
      <div class="app-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="8" width="14" height="9" rx="2"/><path d="M20 11v3"/><path d="M11 10l-2 2.5h3L10 15"/></svg>
      </div>
      <div class="ttl">天一BMS</div>
      <div class="sub"> v{{ version }}</div>
      <div class="win-btns">
        <button title="最小化" @click="winMinimize">─</button>
        <button title="最大化/还原" @click="winToggleMaximize">{{ maximized ? '❐' : '▢' }}</button>
        <button class="close" title="关闭" @click="winClose">✕</button>
      </div>
    </header>

    <!-- ============ 工具栏（h48 · preview 基准）============ -->
    <div class="toolbar">
      <div class="conn-pill" :class="connPillCls">
        <span class="dot" />
        <span>{{ connText }}</span>
      </div>
      <div class="divider" />
      <div class="field-select">串口
        <select v-model="topPort" :disabled="connected">
          <option value="" disabled>选择串口</option>
          <option v-for="port in ports" :key="port.path" :value="port.path">
            {{ port.path }}{{ port.manufacturer ? ` · ${port.manufacturer}` : '' }}
          </option>
        </select>
      </div>
      <button class="btn sm" :disabled="connected" @click="handleRefreshPorts">刷新</button>
      <div class="field-select">波特率
        <select v-model="baudSel" :disabled="connected">
          <option v-for="b in BAUD_OPTIONS" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>
      <button
        v-if="!connected"
        class="btn primary"
        :disabled="!topPort || ui.conn === 'connecting'"
        @click="onTopConnect"
      >{{ ui.conn === 'connecting' ? '连接中…' : '连接' }}</button>
      <button v-else class="btn danger" @click="handleDisconnect">断开</button>
      <div class="spacer" />
      <div class="conn-pill" :class="authSession ? '' : 'auth-off'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <template v-if="authSession"><path d="M20 6 9 17l-5-5"/></template>
          <template v-else><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></template>
        </svg>
        {{ authSession ? `后台已登录 · ${authSession.username}` : '后台未登录' }}
      </div>
      <button v-if="!authSession" class="btn primary" @click="openLoginDialog">后台登录</button>
      <button v-else class="btn ghost" :disabled="authLoading" @click="logoutBackend">退出登录</button>
      <div class="divider" />
      <button class="btn ghost" title="通讯日志" @click="toggleDrawer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"/></svg>日志
      </button>
      <button class="btn ghost" title="系统设置" @click="settingsOpen = true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>设置
      </button>
      <button class="btn ghost" @click="toggleTheme">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
        <span>{{ isDark ? '浅色' : '深色' }}</span>
      </button>
    </div>

    <!-- ============ 主体：头部页签 + 页面 ============ -->
    <nav class="tabs">
      <button
        v-for="v in views"
        :key="v.key"
        class="tab"
        :class="{ active: active === v.key }"
        @click="active = v.key"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <template v-if="v.key === 'monitor'"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></template>
          <template v-else-if="v.key === 'config'"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></template>
          <template v-else><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></template>
        </svg>
        {{ v.title }}
          <span v-if="v.key === 'monitor' && ui.alarmCount" class="cnt">{{ ui.alarmCount }}</span>
      </button>
    </nav>

    <main class="work">
        <!-- 页面 1：实时监测（active 控制自动刷新循环） -->
        <JbdPanel v-show="active === 'monitor'" :active="active === 'monitor'" />
        <!-- 页面 2：参数配置 -->
        <JbdParamConfig v-show="active === 'config'" />
        <!-- 页面 3：下发记录 -->
        <DispatchLog v-show="active === 'log'" />
      </main>

    <!-- ============ 底部状态条（h28 · preview 基准）============ -->
    <footer class="statusbar">
      <span :class="connected ? 'ok' : ''">● {{ connStatusText }}</span>
      <span v-if="connected" :class="{ 'link-err': linkDown }">{{ linkText }}</span>
      <span v-if="ui.alarmCount" class="alarm" @click="goMonitor">⚠ 告警 {{ ui.alarmCount }}</span>
      <div class="r">
        <span>采样 <b class="num">{{ ui.sampleCount }}</b></span>
        <span class="num">{{ clock }}</span>
        <span>v{{ version }}</span>
      </div>
    </footer>

    <!-- ============ 通讯日志浮窗（可拖拽/缩放，默认停靠右侧） ============ -->
    <LogFloat v-if="drawerOpen" :logs="dataLogs" :max-lines="LOG_MAX_LINES" @close="drawerOpen = false" @clear="clearComm" />

    <!-- ============ 弹窗：后台登录 ============ -->
    <div v-if="loginDialogVisible" class="mask" @click.self="loginDialogVisible = false">
      <div class="dlg">
        <h3>后台登录</h3>
        <div class="tip">登录后台后才能下发参数、上传派工记录。accessToken 仅保存在内存，重启后需重新登录。</div>
        <input v-model="loginUsername" type="text" placeholder="用户名" :disabled="authLoading" @keyup.enter="submitLogin">
        <input v-model="loginPassword" type="password" placeholder="密码" :disabled="authLoading" @keyup.enter="submitLogin">
        <div v-if="loginError" class="err-tips">{{ loginError }}</div>
        <div class="ft">
          <button class="btn" :disabled="authLoading" @click="loginDialogVisible = false">取消</button>
          <button class="btn primary" :disabled="authLoading" @click="submitLogin">登录</button>
        </div>
      </div>
    </div>

    <!-- ============ 弹窗：下发口令（引擎驱动，PwdDialog 组件化）============ -->
    <PwdDialog />

    <!-- ============ 弹窗：系统设置（仅保留软件更新）============ -->
    <div v-if="settingsOpen" class="mask" @click.self="settingsOpen = false">
      <div class="dlg dlg-set">
        <h3>系统设置</h3>

        <div class="set-line">
          <div>
            <div class="lb">软件更新</div>
            <div class="d">仅在点击「检查更新」时检查；发现新版本需确认后才下载。更新源：{{ updaterConfig?.source || 'GitHub Releases' }}。
              <span class="link" @click="openGitee">Gitee 手动下载</span>
            </div>
            <div v-if="updaterStatus" class="d up-state" :class="`up-state--${updaterState.state}`">{{ updaterStatus }}</div>
          </div>
          <button class="btn sm" :disabled="updating" @click="onCheckUpdate">{{ updating ? '检查中…' : '检查更新' }}</button>
        </div>

        <div class="ft">
          <button class="btn primary" @click="settingsOpen = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- ============ 软件更新提示（右下角，不打断业务）============ -->
    <UpdateNotifier />
  </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
// 全局中文语言包：el-date-picker 等组件的弹层以中文呈现
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import UpdateNotifier from './components/UpdateNotifier.vue'
import JbdPanel from './components/JbdPanel.vue'
import JbdParamConfig from './components/JbdParamConfig.vue'
import DispatchLog from './components/DispatchLog.vue'
import LogFloat from './components/LogFloat.vue'
import PwdDialog from './components/param-config/PwdDialog.vue'
import { useUpdater } from './composables/useUpdater'
import { ui, setConnected, setConnecting, setDisconnected, markCommError, type LogEntry } from './store'
import { jbdBus } from './jbd/jbd-bus'
import { describeFrame as describeJbdFrame, toHex } from './jbd/jbd-protocol'
import { useJbd } from './jbd/useJbd'
import type { AuthSession } from './auth/auth'
import { LOG_MAX_LINES } from './constants'
import { useDispatch, dispatchAuthSession } from './components/param-config/useDispatch'

// 版本号由 vite define 编译期注入（避免为读一个字段把整个 package.json 打进 bundle）
const version = __APP_VERSION__ || '1.0.0'

// 下发引擎单例（密码弹窗状态由本组件渲染）
const engine = useDispatch()

// ===== 自动更新（共享状态 + 手动检查入口）=====
const { status: updaterState, config: updaterConfig, checkNow } = useUpdater()
const updating = ref(false)
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

// ===== 导航视图（preview 基准四页）=====
const views = [
  { key: 'monitor', title: '实时监测' },
  { key: 'config',  title: '参数配置' },
  { key: 'log',     title: '下发记录' },
]
const active = ref('monitor')
function goMonitor() { active.value = 'monitor' }

// ===== 主题（浅色默认 + 顶栏切换，data-theme 与 html.dark 同步）=====
const isDark = ref(localStorage.getItem('theme') === 'dark')
function applyTheme() {
  document.documentElement.dataset.theme = isDark.value ? 'dark' : ''
  document.documentElement.classList.toggle('dark', isDark.value)
}
applyTheme()
function toggleTheme() {
  isDark.value = !isDark.value
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  applyTheme()
  pushLogTheme()
}
/** 日志窗口主题跟随（IPC 推送；storage 事件为主路径，file:// 打包场景兜底） */
function pushLogTheme() {
  if (isElectron) window.logWinAPI!.setTheme(isDark.value)
}
watch(isDark, pushLogTheme)

// ===== 无边框窗口控制 =====
const maximized = ref(false)
function winMinimize() { window.winAPI?.minimize() }
function winToggleMaximize() { window.winAPI?.toggleMaximize() }
function winClose() { window.winAPI?.close() }

// ===== 状态 =====
const connected = computed(() => ui.conn === 'connected')
const portPath = ref('')
const ports = ref<SerialPortInfo[]>([])
const topPort = ref('')
const BAUD_OPTIONS = [9600, 4800, 19200, 38400, 57600, 115200]
const baudSel = ref(9600)
// 串口连接成功后，把顶部下拉框同步到当前端口；断开时保留原选择，方便重连
watch(() => ui.portPath, (p) => { if (p) topPort.value = p }, { immediate: true })

// ===== 后台登录（token 只留在 Electron 主进程）=====
type RendererAuthSession = Pick<AuthSession, 'userId' | 'username' | 'expiresTime'>
const authSession = ref<RendererAuthSession | null>(null)
const authLoading = ref(false)
const loginDialogVisible = ref(false)
const loginUsername = ref('admin')
const loginPassword = ref('')
const loginError = ref('')
let authExpiryTimer: number | undefined

// 同步给下发引擎（决定参数下发是否放行）
watch(authSession, (v) => { dispatchAuthSession.value = v }, { immediate: true })

function clearAuthExpiryTimer() {
  if (authExpiryTimer !== undefined) {
    window.clearTimeout(authExpiryTimer)
    authExpiryTimer = undefined
  }
}

function setAuthSession(session: RendererAuthSession | null) {
  clearAuthExpiryTimer()
  authSession.value = session
  if (!session) return
  const delay = session.expiresTime - Date.now()
  if (delay <= 0) {
    authSession.value = null
    return
  }
  authExpiryTimer = window.setTimeout(() => {
    authSession.value = null
    ElMessage.warning('后台登录已过期，请重新登录后再下发参数')
  }, delay)
}

async function refreshAuthStatus() {
  if (!window.authAPI) return
  try {
    const status = await window.authAPI.getStatus()
    setAuthSession(
      status.loggedIn
        ? { userId: status.userId!, username: status.username!, expiresTime: status.expiresTime! }
        : null,
    )
  } catch {
    setAuthSession(null)
    ElMessage.error('获取后台登录状态失败')
  }
}

function openLoginDialog() {
  loginUsername.value = 'admin'
  loginPassword.value = ''
  loginError.value = ''
  loginDialogVisible.value = true
}

async function submitLogin() {
  if (authLoading.value) return
  if (!window.authAPI) {
    loginError.value = '当前环境不支持后台登录'
    return
  }
  authLoading.value = true
  loginError.value = ''
  try {
    const result = await window.authAPI.login({
      username: loginUsername.value,
      password: loginPassword.value,
    })
    if (!result.ok) {
      loginError.value = result.error || '登录失败'
      return
    }
    setAuthSession({
      userId: result.userId!,
      username: result.username!,
      expiresTime: result.expiresTime!,
    })
    loginDialogVisible.value = false
    ElMessage.success(`后台登录成功：${result.username}`)
  } catch {
    loginError.value = '后台登录请求失败，请稍后重试'
  } finally {
    authLoading.value = false
  }
}

async function logoutBackend() {
  if (authLoading.value) return
  authLoading.value = true
  try {
    await window.authAPI?.logout()
    setAuthSession(null)
    ElMessage.success('已退出后台登录')
  } catch {
    ElMessage.error('退出后台登录失败')
  } finally {
    authLoading.value = false
  }
}

// ===== 通讯日志（App 生成；Electron 下同步推送独立日志窗口，浏览器降级页内浮窗）=====
const isElectron = typeof window !== 'undefined' && 'logWinAPI' in window
const dataLogs = ref<LogEntry[]>([])
let logSeq = 0
function addLog(type: LogEntry['type'], content: string) {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + now.getMilliseconds().toString().padStart(3, '0')
  const entry: LogEntry = { id: ++logSeq, time, type, content }
  dataLogs.value.push(entry)
  if (isElectron) window.logWinAPI!.push([entry])
  // 用 splice 原地裁剪而非 slice 重建数组：配合浮窗的 id key，
  // 旧条目 DOM 因 key 不变而复用，避免高频日志下全量重渲
  const excess = dataLogs.value.length - LOG_MAX_LINES
  if (excess > 0) dataLogs.value.splice(0, excess)
}
// ===== 日志窗口：Electron 开独立系统窗口（贴主窗右侧外侧），浏览器降级页内浮窗 =====
const drawerOpen = ref(false)
function toggleDrawer() {
  if (isElectron) {
    window.logWinAPI!.open()
  } else {
    drawerOpen.value = !drawerOpen.value
  }
}
function clearComm() {
  dataLogs.value = []
}
if (isElectron) {
  // 日志窗口打开后回填历史；日志窗口里的清空按钮经主进程中转回来
  window.logWinAPI!.onReady(() => {
    window.logWinAPI!.setTheme(isDark.value)
    window.logWinAPI!.push([...dataLogs.value])
  })
  window.logWinAPI!.onClear(() => clearComm())
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
    baudRate: baudSel.value,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  })
}
async function handleRefreshPorts(): Promise<SerialPortInfo[]> {
  try {
    const list = await window.serialAPI.listPorts()
    ports.value = list
    // 默认选中第一个串口（未手选时）
    if (!topPort.value && list.length) topPort.value = list[0].path
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
  if (!connected.value) return
  try {
    await window.serialAPI.send(data)
    const hex = toHex(data)
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
const DATABIT_OPTIONS: (5 | 6 | 7 | 8)[] = [7, 8]
const STOPBIT_OPTIONS: (1 | 1.5 | 2)[] = [1, 1.5, 2]
void DATABIT_OPTIONS
void STOPBIT_OPTIONS
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

// ===== 连接成功后验证 BMS 应答再跳转实时监测页 =====
const { basicInfo } = useJbd()
const pendingVerify = ref(false)
const pendingJump = ref(false)
let verifyTimer: ReturnType<typeof setTimeout> | null = null
// 发帧由 useJbd.initAfterConnect 统一串行执行（首帧丢弃补偿：最多 3 次重发），
// 这里只负责等待应答结果并提示 / 跳转，不再自己补发避免与初始化序列抢总线。
function startVerify(autoJump = false) {
  pendingVerify.value = true
  pendingJump.value = autoJump
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = setTimeout(() => {
    if (pendingVerify.value) {
      pendingVerify.value = false
      pendingJump.value = false
      ElMessage.warning('串口已打开，但未收到 BMS 应答，请确认设备与串口参数')
    }
  }, 8000)
}
watch(basicInfo, (v) => {
  if (v && pendingVerify.value) {
    pendingVerify.value = false
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
    setConnected(status.portPath || '', status.baudRate || ui.baudRate)
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

// ===== 工具栏 / 状态条 文案 =====
const connPillCls = computed(() => {
  switch (ui.conn) {
    case 'connected': return ''
    case 'connecting': return 'warn'
    case 'error': return 'err'
    default: return 'gray'
  }
})
const connText = computed(() => {
  switch (ui.conn) {
    case 'connected': return `已连接 · ${ui.portPath}`
    case 'connecting': return '连接中…'
    case 'error': return '通信异常'
    default: return '未连接'
  }
})
const connStatusText = computed(() => {
  switch (ui.conn) {
    case 'connected': return `已连接 ${ui.portPath} @ ${ui.baudRate}`
    case 'connecting': return '连接中…'
    case 'error': return '通信异常 · 检测不到设备响应'
    default: return '未连接设备'
  }
})
// ===== 链路健康（jbd-bus 断链熔断：连续 5 次无应答 → 异常；任一有效应答 → 恢复）=====
const linkDown = ref(false)
jbdBus.onLinkChange((down) => { linkDown.value = down })
const linkText = computed(() => (linkDown.value ? '数据链路异常（连续无应答，已暂停自动轮询）' : '数据链路正常'))

// ===== 时钟 =====
const clock = ref('')
let tickTimer: number | null = null
function tick() {
  clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

// ===== 设置 =====
const settingsOpen = ref(false)

// ===== 生命周期 =====
onMounted(() => {
  tickTimer = window.setInterval(tick, 1000)
  tick()
  refreshAuthStatus()
  window.winAPI?.onMaximizedChange?.((m) => { maximized.value = m })
  // 关键：把帧总线接到真实串口。否则 jbdBus.send/sendAck 发现 sender 为 null，
  // 会立即返回超时帧，表现为「发送数据没有成功 / 读不到应答」。
  jbdBus.setSender(handleSend)

  window.serialAPI?.onData?.((data: number[]) => {
    const bytes = Array.from(data)
    addLog('recv', `接收: ${toHex(bytes)}`)
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
  // 首次进入自动刷新一次串口列表，方便直接选择
  handleRefreshPorts()
})
onUnmounted(() => {
  clearAuthExpiryTimer()
  if (tickTimer) clearInterval(tickTimer)
  window.serialAPI?.removeAllListeners?.()
  jbdBus.clear()
})
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 1180px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--bg);
  color: var(--t1);
}

/* ============ 标题栏 ============ */
.titlebar {
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}
.titlebar .app-ico {
  margin: 0 8px 0 12px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: linear-gradient(135deg, var(--brand), #39c6f5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.titlebar .app-ico svg { width: 12px; height: 12px; stroke: #fff; }
.titlebar .ttl { font-weight: 700; font-size: 13px; }
.titlebar .sub { color: var(--t3); font-size: 12px; margin-left: 8px; }
.titlebar .win-btns { margin-left: auto; display: flex; height: 100%; -webkit-app-region: no-drag; }
.titlebar .win-btns button {
  width: 44px;
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.titlebar .win-btns button:hover { background: var(--hover); color: var(--t1); }
.titlebar .win-btns button.close:hover { background: var(--err); color: #fff; }

/* ============ 工具栏 ============ */
.toolbar {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  overflow-x: auto;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.conn-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 20px;
  background: var(--ok-weak);
  color: var(--ok);
  font-weight: 600;
  font-size: 12.5px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.conn-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: pulse 2s infinite; }
.conn-pill.warn { background: var(--warn-weak); color: var(--warn); }
.conn-pill.warn .dot { background: var(--warn); }
.conn-pill.err { background: var(--err-weak); color: var(--err); }
.conn-pill.err .dot { background: var(--err); animation: none; }
.conn-pill.gray { background: var(--inset); color: var(--t3); }
.conn-pill.gray .dot { background: var(--t3); animation: none; }
.conn-pill.auth-off { background: var(--warn-weak); color: var(--warn); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.divider { width: 1px; height: 24px; background: var(--border); margin: 0 4px; flex: 0 0 1px; }
.spacer { flex: 1; }

.field-select { display: flex; align-items: center; gap: 6px; color: var(--t2); font-size: 12px; }
.field-select select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 26px 6px 10px;
  font-size: 12.5px;
  color: var(--t1);
  outline: none;
  cursor: pointer;
  max-width: 240px;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2398a0ac' stroke-width='2.4'><path d='m6 9 6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
}
.field-select select:disabled { opacity: 0.6; cursor: not-allowed; }

/* .btn 按钮体系已迁至全局 style.css（子组件同样使用） */

/* ============ 头部页签 ============ */
.tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 12px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px 9px;
  border: none;
  background: transparent;
  color: var(--t2);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  white-space: nowrap;
}
.tab svg { width: 16px; height: 16px; }
.tab:hover { color: var(--t1); background: var(--hover); }
.tab.active { color: var(--brand); background: var(--hover); }
.tab.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  background: var(--brand);
  border-radius: 2px;
}
.tab .cnt {
  background: var(--err);
  color: #fff;
  font-size: 10.5px;
  min-width: 16px;
  height: 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* ============ 页面工作区 ============ */
.work {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
}
.work > * { min-width: 0; }/* ============ 底部状态条 ============ */
.statusbar {
  height: 28px;
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  color: var(--t3);
  font-size: 11.5px;
}
.statusbar .ok { color: var(--ok); font-weight: 600; }
.statusbar .alarm { color: var(--err); font-weight: 700; cursor: pointer; }
.statusbar .link-err { color: var(--err); font-weight: 700; }
.statusbar .r { margin-left: auto; display: flex; gap: 18px; }

/* 通讯日志浮窗样式已移至 components/LogFloat.vue */

/* ============ 弹窗（preview .dlg / .mask）============ */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 16, 0.45);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}
[data-theme="dark"] .mask { background: rgba(0, 0, 0, 0.55); }
.dlg {
  width: 400px;
  max-width: calc(100vw - 60px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 20px 22px;
  animation: pop 0.18s ease;
}
@keyframes pop {
  from { transform: translateY(10px) scale(0.98); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.dlg h3 { font-size: 14.5px; margin-bottom: 6px; color: var(--t1); }
.dlg .tip { color: var(--t2); font-size: 12.5px; margin-bottom: 14px; line-height: 1.7; }
.dlg input[type="text"],
.dlg input[type="password"] {
  width: 100%;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
  margin-bottom: 10px;
}
.dlg input:focus { border-color: var(--brand); }
.dlg .ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  flex-shrink: 0;
}
.dlg .err-tips { color: var(--err); font-size: 12px; margin: -4px 0 8px; }
.dlg-set { width: 460px; }

/* 设置行（preview .set-line）*/
.set-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  gap: 12px;
}
.set-line .lb { color: var(--t1); font-size: 13px; }
.set-line .d { color: var(--t3); font-size: 11.5px; margin-top: 2px; line-height: 1.6; }
.link { color: var(--info); cursor: pointer; }
.link:hover { text-decoration: underline; }
.up-state { margin-top: 4px; }
.up-state--downloaded { color: var(--ok); }
.up-state--error { color: var(--err); }
.up-state--downloading, .up-state--available { color: var(--info); }

.set-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 10px;
  margin: 8px 0;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.set-field { display: flex; flex-direction: column; gap: 4px; }
.set-field label { font-size: 11px; color: var(--t2); font-weight: 600; }
.set-field input,
.set-field select {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 9px;
  font-size: 12.5px;
  outline: none;
}
.set-field input:focus, .set-field select:focus { border-color: var(--brand); }

.about { padding: 10px 0 4px; }
.about-name { font-size: 12.5px; font-weight: 700; color: var(--t1); }
.about-meta { font-size: 11px; color: var(--t3); margin-top: 3px; }

/* ============ chips（抽屉计数）============ */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
}
.chip.gray { background: var(--inset); color: var(--t2); }

/* ============ CSS 开关（设置弹窗用）============ */
.switch { position: relative; width: 38px; height: 21px; flex: 0 0 38px; cursor: pointer; display: inline-block; }
.switch input { display: none; }
.switch .tk {
  position: absolute;
  inset: 0;
  background: var(--border-strong);
  border-radius: 12px;
  transition: 0.18s;
}
.switch .tk::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: 0.18s;
}
.switch input:checked + .tk { background: var(--brand); }
.switch input:checked + .tk::after { left: 19px; }
.switch input:disabled + .tk { opacity: 0.45; cursor: not-allowed; }
</style>
