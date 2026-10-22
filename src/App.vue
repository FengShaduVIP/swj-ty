<template>
  <!-- Element Plus 改为按需引入后，中文 locale 由 config-provider 提供（替代 app.use(ElementPlus, { locale })） -->
  <el-config-provider :locale="zhCn">
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
              :label="port.friendlyName ? `${port.friendlyName} · ${port.path}` : port.path"
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
          <span class="sb-divider" />
          <StatusBadge
            :status="authSession ? 'ok' : 'warning'"
            :label="authSession ? `后台已登录 · ${authSession.username}` : '后台未登录'"
          />
          <el-button
            v-if="!authSession"
            type="primary"
            size="small"
            :disabled="authLoading"
            @click="openLoginDialog"
          >
            后台登录
          </el-button>
          <el-button
            v-else
            size="small"
            :disabled="authLoading"
            @click="logoutBackend"
          >
            退出登录
          </el-button>
        </div>
      </div>

      <div class="sb-right">
        <button v-if="ui.alarmCount" class="sb-chip sb-chip--crit" @click="goMonitor">
          <svg class="chip-ico" viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" /></svg>
          告警 {{ ui.alarmCount }}
        </button>
        <span class="sb-rate">采样 <b class="num">{{ rate }}</b> Hz</span>
        <button class="sb-icon" title="浮动窗口" @click="openFloatWindow">
          <el-icon :size="16"><Monitor /></el-icon>
        </button>
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
          <JbdParamConfig
            ref="paramConfigRef"
            v-show="active === 'config'"
            :connected="connected"
            :logs="dataLogs"
            :auth-session="authSession"
          />
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
            <el-select v-model="autoconn.baudRate">
              <el-option v-for="b in BAUD_OPTIONS" :key="b" :label="String(b)" :value="b" />
            </el-select>
          </div>
          <div class="set-field">
            <label>数据位</label>
            <el-select v-model="autoconn.dataBits">
              <el-option v-for="d in DATABIT_OPTIONS" :key="d" :label="String(d)" :value="d" />
            </el-select>
          </div>
          <div class="set-field">
            <label>停止位</label>
            <el-select v-model="autoconn.stopBits">
              <el-option v-for="s in STOPBIT_OPTIONS" :key="s" :label="String(s)" :value="s" />
            </el-select>
          </div>
          <div class="set-field">
            <label>校验位</label>
            <el-select v-model="autoconn.parity">
              <el-option v-for="p in PARITY_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
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

    <!-- ============ 后台登录（tenantName / rememberMe 使用固定默认值）============ -->
    <el-dialog
      v-model="loginDialogVisible"
      title="后台登录"
      width="400px"
      align-center
      class="vg-dialog"
      :close-on-click-modal="false"
    >
      <div class="login-tip">登录后台后才能下发参数。</div>
      <el-input v-model="loginUsername" placeholder="用户名" :disabled="authLoading" @keyup.enter="submitLogin" />
      <el-input
        v-model="loginPassword"
        type="password"
        show-password
        placeholder="密码"
        :disabled="authLoading"
        class="login-password"
        @keyup.enter="submitLogin"
      />
      <div v-if="loginError" class="login-error">{{ loginError }}</div>
      <template #footer>
        <el-button size="small" text :disabled="authLoading" @click="loginDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="authLoading" @click="submitLogin">登录</el-button>
      </template>
    </el-dialog>

    <!-- ============ 软件更新提示（右下角，不打断业务）============ -->
    <UpdateNotifier />
  </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, markRaw } from 'vue'
import { ElMessage } from 'element-plus'
// 全局中文语言包：el-date-picker 等组件的弹层以中文呈现（英文 locale 会显示月份英文缩写）
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { Connection, DataBoard, Setting, Fold, Expand, Operation, Refresh, Tickets, Monitor } from '@element-plus/icons-vue'
import SerialPanel from './components/SerialPanel.vue'
import JbdPanel from './components/JbdPanel.vue'
import JbdParamConfig from './components/JbdParamConfig.vue'
import DispatchLog from './components/DispatchLog.vue'
import ConnIndicator from './components/ConnIndicator.vue'
import StatusBadge from './components/StatusBadge.vue'
import UpdateNotifier from './components/UpdateNotifier.vue'
import { useUpdater } from './composables/useUpdater'
import { ui, setConnected, setConnecting, setDisconnected, markCommError, type LogEntry } from './store'
import { serialBus, setTrafficHook, SerialBus } from './jbd/serial-bus'
import { describeFrame as describeJbdFrame, toHex } from './jbd/jbd-protocol'
import { useJbd } from './jbd/useJbd'
import type { AuthSession } from './auth/auth'
import { LOG_MAX_LINES } from './constants'

// 版本号由 vite define 编译期注入（避免为读一个字段把整个 package.json 打进 bundle）
const version = __APP_VERSION__ || '1.0.0'

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

// 打开置顶浮动小窗（主窗口最小化后仍实时显示电池数据；重复点击置前）
function openFloatWindow() {
  void window.floatAPI.open()
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

// ===== 后台登录：状态显示在顶部连接/断开按钮右侧；token 仍只留在 Electron 主进程 =====
type RendererAuthSession = Pick<AuthSession, 'userId' | 'username' | 'expiresTime'>
const authSession = ref<RendererAuthSession | null>(null)
const authLoading = ref(false)
const loginDialogVisible = ref(false)
const loginUsername = ref('admin')
const loginPassword = ref('')
const loginError = ref('')
let authExpiryTimer: number | undefined

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

const dataLogs = ref<LogEntry[]>([])
let logSeq = 0
// 参数配置页引用：浮窗「强制下发」经主进程转发后由 App 调用其 forceWriteAll
const paramConfigRef = ref<InstanceType<typeof JbdParamConfig> | null>(null)

function addLog(type: LogEntry['type'], content: string) {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + now.getMilliseconds().toString().padStart(3, '0')
  const entry: LogEntry = { id: ++logSeq, time, type, content }
  dataLogs.value.push(entry)
  // 同步给浮动窗口的两行滚动日志条（浮窗不存在时主进程直接丢弃）
  window.floatAPI?.pushLog(entry)
  // 用 splice 原地裁剪而非 slice 重建数组：配合 DataLog 的 id key，
  // 旧条目 DOM 因 key 不变而复用，避免高频日志下 500 行全量重渲
  const excess = dataLogs.value.length - LOG_MAX_LINES
  if (excess > 0) dataLogs.value.splice(0, excess)
}

// ===== 串口连接（Web Serial，照搬 SWJ） =====
/** Web Serial 不暴露 COM 名，用 VID/PID 作为端口标识 */
function portLabel(p: SerialPort): string {
  const info = p.getInfo()
  const vid = info.usbVendorId?.toString(16).toUpperCase().padStart(4, '0')
  const pid = info.usbProductId?.toString(16).toUpperCase().padStart(4, '0')
  return vid && pid ? `USB VID:${vid} PID:${pid}` : '串口设备'
}

/** 按 VID/PID 反查系统端口名（COMx），查不到返回空串（照搬 SWJ device.ts comNameOf） */
async function comNameOf(vid?: number, pid?: number): Promise<string> {
  const v = vid == null ? '' : vid.toString(16).toUpperCase().padStart(4, '0')
  const p = pid == null ? '' : pid.toString(16).toUpperCase().padStart(4, '0')
  if (!v || !p) return ''
  try {
    return String((await window.serialWeb?.portName?.(v, p)) || '')
  } catch {
    return ''
  }
}

/** 枚举已授权串口，并补上 COM 名（界面上直接显示 COM3 而不是一串 VID/PID） */
async function listGrantedPorts(): Promise<SerialPortInfo[]> {
  const list = await SerialBus.granted()
  const mapped: SerialPortInfo[] = []
  for (const p of list) {
    const comName = await comNameOf(p.usbVendorId, p.usbProductId)
    mapped.push({ path: p.label, friendlyName: comName })
  }
  return mapped
}

async function handleConnect(config: SerialConnectConfig) {
  setConnecting()
  try {
    const granted = await navigator.serial.getPorts()
    let port = granted.find((p) => portLabel(p) === config.path) ?? granted[0]
    if (!port) {
      // 首次使用：主进程的 select-serial-port 自动放行（无系统选择框）
      const picked = await SerialBus.request()
      if (!picked) throw new Error('未选择串口')
      port = picked
    }
    // 让主进程的自动选择偏好与本次选中对齐（后续 requestPort 放行同一设备）
    const idx = granted.indexOf(port)
    if (idx >= 0) await window.serialWeb?.setPreference?.(idx)
    await serialBus.open(port, {
      baudRate: config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    })
    const label = portLabel(port)
    portPath.value = label
    setConnected(label, config.baudRate)
    addLog('info', `串口已连接: ${label} @ ${config.baudRate}bps`)
    pushSerialState()
    startVerify(false)
  } catch (err: any) {
    setDisconnected()
    ElMessage.error('连接失败: ' + (err.message || err))
    addLog('error', `连接失败: ${err.message || err}`)
    pushSerialState()
  }
}
async function handleDisconnect() {
  try {
    await serialBus.close()
    setDisconnected()
    portPath.value = ''
    addLog('info', '串口已断开')
  } catch (err: any) {
    ElMessage.error('断开失败: ' + (err.message || err))
  }
  pushSerialState()
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
    let mapped = await listGrantedPorts()
    // 与 SWJ 一致：没有任何已授权串口时，主动触发一次 requestPort 完成授权
    // （主进程 select-serial-port 自动放行，不弹系统选择框）
    if (!mapped.length) {
      const picked = await SerialBus.request()
      if (picked) mapped = await listGrantedPorts()
    }
    ports.value = mapped
    addLog('info', `刷新串口列表: 找到 ${mapped.length} 个已授权串口`)
    pushSerialState()
    return mapped
  } catch (err: any) {
    ElMessage.error('获取串口列表失败: ' + (err.message || err))
    ports.value = []
    pushSerialState()
    return []
  }
}

/** 启动时静默枚举（不触发 requestPort），并把初始状态推给浮窗 */
async function initPortList() {
  try {
    ports.value = await listGrantedPorts()
  } catch {
    /* 枚举失败保留空列表，用户点刷新时重试 */
  }
  pushSerialState()
}

/** 串口状态推给浮窗（端口由本窗口独占，浮窗的端口下拉/连接按钮只是指令入口） */
function pushSerialState() {
  window.floatAPI?.pushSerialState?.({
    connected: connected.value,
    portLabel: portPath.value,
    comName: ports.value.find((p) => p.path === portPath.value)?.friendlyName ?? '',
    baudRate: ui.baudRate,
    ports: ports.value.map((p) => ({ path: p.path, comName: p.friendlyName ?? '' })),
  })
}

// 发送与收发日志统一由 serialBus 的流量钩子负责（见 onMounted 的 setTrafficHook）

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
/**
 * 自动连接：Web Serial 无法后台守护插拔（端口授权绑定在渲染进程），
 * 仅在启动时尝试打开已授权的第一个端口。
 */
async function autoConnectOnStartup() {
  if (!autoconn.value.enabled) return
  if (!SerialBus.supported()) return
  try {
    const granted = await navigator.serial.getPorts()
    if (!granted.length) return
    await handleConnect({
      path: portLabel(granted[0]),
      baudRate: autoconn.value.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    })
  } catch {
    /* 启动自动连接失败不打断启动流程 */
  }
}
function applyAutoConnect() {
  // 配置持久化到 localStorage，由 autoConnectOnStartup 在启动时消费
  saveAuto()
}
function onSettingsClose() {
  saveAuto()
  applyAutoConnect()
}

// ===== 连接成功后验证 BMS 应答再跳转实时监测页 =====
const { basicInfo, cellVoltages, cellMax, cellMin, activeProtects, activeAlarms } = useJbd()
const pendingVerify = ref(false)
const pendingJump = ref(false)
let verifyTimer: ReturnType<typeof setTimeout> | null = null
// 发帧由 useJbd.initAfterConnect 统一串行执行（首帧丢弃补偿：最多 3 次重发），
// 这里只负责等待应答结果并提示 / 跳转，不再自己补发避免与初始化序列抢总线。
// 超时上限需覆盖 3 次 × (1.5s 应答超时 + 400ms 间隔) 的最坏情况。
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

// ===== 浮窗实时快照 =====
// Web Serial 端口授权只在本渲染进程，浮窗拿不到任何字节，实时数据必须靠推送。
// 轮询周期 2s，watch 到快照变化才推一次，未开浮窗时主进程直接丢弃。
const floatLive = computed<FloatLiveSnapshot>(() => {
  const l = ui.live
  const hasCells = cellVoltages.value.length > 0
  return {
    totalV: l.totalVoltage_V,
    currentA: l.current_A,
    soc: l.soc,
    maxTempC: l.maxTemp_C,
    cellMaxV: hasCells ? cellMax.value / 1000 : null,
    cellMinV: hasCells ? cellMin.value / 1000 : null,
    cellDeltaMv: hasCells ? cellMax.value - cellMin.value : null,
    cellCount: cellVoltages.value.length,
    protects: activeProtects.value.slice(),
    alarms: activeAlarms.value.slice(),
  }
})
watch(floatLive, (s) => window.floatAPI?.pushLive?.(s))

// 连接建立后的验证由 handleConnect 触发 startVerify；不再有主进程状态广播


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
  refreshAuthStatus()
  // 启用自动连接时先停留在「设备连接」页，连接验证成功后再跳转到实时监测页
  if (autoconn.value.enabled) active.value = 'connect'
  // 启动时静默枚举已授权串口（不触发 requestPort：无用户手势时必然失败，
  // 授权交给「刷新」/「连接」按钮的用户点击完成，与 SWJ 的 onMounted→listPorts 一致）
  void initPortList()
// 收发流量 → 通讯日志（等价于原 serialAPI.onData 的日志表现）
setTrafficHook((dir, bytes) => {
  const hex = toHex(bytes)
  if (dir === 'tx') {
    const desc = describeJbdFrame(bytes)
    addLog('send', desc ? `${desc}-->主机发送：${hex}` : `发送: ${hex}`)
  } else {
    addLog('recv', `接收: ${hex}`)
  }
})
serialBus.onError((e) => {
  addLog('error', e.message)
  markCommError()
})

  // 浮窗「强制下发」按钮 → 主进程在浮窗上弹原生确认框（不唤醒本窗口）→ 确认后转交参数配置页
  // 执行完整下发流程（overrides 为浮窗输入框的蓝牙名称/BMS编码，forceWriteAll 内会先覆盖页面字段；
  // skipConfirm=true 表示浮窗侧已确认，跳过页内 ElMessageBox 二次确认）
  window.floatAPI?.onForceWrite((overrides, skipConfirm) => {
    active.value = 'config'
    void paramConfigRef.value?.forceWriteAll(overrides, { skipConfirm })
  })

  // 浮窗「蓝牙名称 / BMS编码 / 复位MCU」按钮 → 同样转交参数配置页执行（value 为浮窗输入框值；
  // 复位 MCU 的确认已在浮窗侧完成，skipConfirm=true 时跳过页内二次确认）
  window.floatAPI?.onParamAction((action, value, skipConfirm) => {
    active.value = 'config'
    const pc = paramConfigRef.value
    if (!pc) return
    if (action === 'bt-name') void pc.dispatchBtName(typeof value === 'string' ? value : undefined)
    else if (action === 'bms-code') void pc.dispatchBmsCode(typeof value === 'string' ? value : undefined)
    else if (action === 'reset-mcu') void pc.confirmResetMcu({ skipConfirm })
  })

  // 浮窗「读取全部」按钮 → 静默转发（不唤醒本窗口），读取进度推回浮窗进度条；
  // 读取完成后 bt-name/bms-ver 值更新，经既有 watch 自动推送浮窗输入框实时回填
  window.floatAPI?.onReadAll(() => {
    active.value = 'config'
    void paramConfigRef.value?.readAll({ fromFloat: true })
  })

  // 浮窗的端口下拉/连接/断开按钮 → 转为本窗口的串口动作（端口授权只在本渲染进程）
  window.floatAPI?.onSerialAction?.(async (a) => {
    if (a.action === 'list') {
      await handleRefreshPorts()
      return
    }
    if (a.action === 'disconnect') {
      await handleDisconnect()
      return
    }
    // connect：尚无任何已授权串口时，requestPort 需要本窗口的用户手势，
    // 无法由浮窗代点——唤醒主窗口并提示用户在此点一次「刷新」或「连接」
    if (!ports.value.length && !a.path) {
      addLog('error', '尚无已授权串口：请在主界面点一次「刷新」或「连接」完成授权')
      void window.floatAPI.showMain()
      return
    }
    await handleConnect({
      path: a.path || topPort.value,
      baudRate: a.baudRate || 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    })
  })

  // 按持久化的配置启动自动连接（若启用），在钩子就绪后再执行
  void autoConnectOnStartup()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  clearAuthExpiryTimer()
  if (tickTimer) clearInterval(tickTimer)
  setTrafficHook(null)
  void serialBus.close()
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
.sb-port :deep(.badge) { max-width: 190px; }
.sb-port :deep(.badge-text) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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

.login-tip {
  margin-bottom: 12px;
  font-size: var(--fs-body-sm);
  color: var(--text-secondary);
}
.login-password { margin-top: 10px; }
.login-error {
  margin-top: 8px;
  font-size: var(--fs-caption);
  color: var(--critical);
}

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
