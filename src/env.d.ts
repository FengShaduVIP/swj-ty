/// <reference types="vite/client" />

// 渲染层版本号：由 vite.config.ts 的 define 编译期注入（值为 package.json version）
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 串口 API 类型（注入自 preload.ts）
interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  friendlyName?: string
  vendorId?: string
  productId?: string
}

interface SerialConnectConfig {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

interface SerialStatus {
  connected: boolean
  portPath?: string
  baudRate?: number
  /** 本次连接是否由自动连接守护建立（渲染层用于决定是否自动跳转监测页） */
  auto?: boolean
}

/** 自动连接配置：按 VID/PID（可选名称）匹配 USB 串口 */
interface AutoConnectConfig {
  enabled: boolean
  vendorId?: string
  productId?: string
  friendlyName?: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

interface SerialAPI {
  listPorts: () => Promise<SerialPortInfo[]>
  connect: (config: SerialConnectConfig) => Promise<{ success: boolean }>
  disconnect: () => Promise<{ success: boolean }>
  send: (data: number[]) => Promise<{ success: boolean }>
  getStatus: () => Promise<SerialStatus>
  setAutoConnect: (enabled: boolean, config?: AutoConnectConfig) => Promise<{ success: boolean }>
  getAutoConnect: () => Promise<AutoConnectConfig | null>
  onData: (callback: (data: number[]) => void) => void
  onError: (callback: (error: string) => void) => void
  onStatusChange: (callback: (status: SerialStatus) => void) => void
  removeAllListeners: () => void
}

// 自动更新 API 类型（注入自 preload.ts）
type UpdaterState =
  | 'idle' | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'dev-disabled'

interface UpdaterStatus {
  state: UpdaterState
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
  error?: string
  checkedAt?: number
  source?: string
}

interface UpdaterConfig {
  enabled: boolean
  source: string
  checkOnStartup: boolean
  checkIntervalMs: number
  autoDownload: boolean
  currentVersion: string
}

interface UpdaterAPI {
  checkNow: () => Promise<{ ok: boolean; state?: string; error?: string }>
  /** 用户确认后开始下载更新（手动确认策略：不自动下载） */
  download: () => Promise<{ ok: boolean; error?: string }>
  quitAndInstall: () => Promise<{ ok: boolean; error?: string }>
  getConfig: () => Promise<UpdaterConfig>
  onStatus: (callback: (status: UpdaterStatus) => void) => void
  removeStatusListeners: () => void
}

interface ShellAPI {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
}

interface BackendLoginResult {
  ok: boolean
  userId?: number
  username?: string
  expiresTime?: number
  error?: string
}

interface BackendAuthStatus {
  loggedIn: boolean
  userId?: number
  username?: string
  expiresTime?: number
}

interface BackendAuthAPI {
  login: (credentials: { username: string; password: string }) => Promise<BackendLoginResult>
  getStatus: () => Promise<BackendAuthStatus>
  logout: () => Promise<{ ok: boolean }>
}

interface DispatchUploadResult {
  ok: boolean
  error?: string
}

interface DispatchAPI {
  upload: (record: {
    btName: string
    dispatchedAt: number
    params: { label: string; index?: number; value: unknown }[]
  }) => Promise<DispatchUploadResult>
}

/** BMS 参数下发相关（注入自 preload.ts） */
interface BmsAPI {
  /** 校验强制下发确认密码（常量存放于主进程，渲染层 bundle 不落明文） */
  verifyDispatchPwd: (candidate: string) => Promise<boolean>
}

/** 屏幕级通知（注入自 preload.ts）：独立透明置顶小窗，固定屏幕右上角，不自动关闭 */
interface NotifyAPI {
  /** 显示通知（替换当前可见通知），须手动关闭 */
  show: (p: { title: string; message: string; type?: 'success' | 'warning' }) => void
  /** 关闭当前通知（通知窗上的关闭按钮调用） */
  close: () => void
  /** 通知窗：监听主进程发来的通知内容 */
  onShow: (callback: (p: { title: string; message: string; type: string }) => void) => void
}

/** 浮动窗口控制（注入自 preload.ts） */
interface FloatLogEntry {
  id: number
  time: string
  type: string
  content: string
}

interface FloatAPI {
  /** 打开浮窗（已存在则置前） */
  open: () => Promise<{ success: boolean }>
  /** 关闭浮窗（仅浮窗自身关闭按钮调用） */
  close: () => Promise<{ success: boolean }>
  /** 显示并聚焦主窗口 */
  showMain: () => Promise<{ success: boolean }>
  /** 切换浮窗置顶 */
  setAlwaysOnTop: (enabled: boolean) => Promise<{ success: boolean }>
  /** 请求主窗口执行强制下发（overrides 携带浮窗输入的蓝牙名称/BMS编码，空串=按页面值） */
  requestForceWrite: (overrides?: { btName: string; bmsCode: string }) => Promise<{ success: boolean }>
  /** 请求主窗口执行单参数下发/复位 MCU（bt-name | bms-code | reset-mcu，value 为浮窗输入框值） */
  requestParamAction: (action: 'bt-name' | 'bms-code' | 'reset-mcu', value?: string) => void
  /** 请求主窗口执行读取全部（进度经 float:progress 同步回浮窗，读取后蓝牙名称/BMS编码自动回填） */
  requestReadAll: () => void
  /** 主窗口：蓝牙名称/BMS编码当前值变化时同步给浮窗输入框 */
  pushFieldValues: (v: { btName: string; bmsCode: string }) => void
  /** 主窗口：addLog 后把日志条目逐条同步给浮窗 */
  pushLog: (entry: FloatLogEntry) => void
  /** 主窗口：当前导入模板名变化时同步给浮窗 */
  pushTemplate: (name: string) => void
  /** 主窗口：浮窗触发的下发/读取进行中，把 busy/进度百分比/类别同步给浮窗进度条 */
  pushProgress: (p: { busy: boolean; progress: number; kind?: 'read' | 'write' }) => void
  /** 主窗口：监听浮窗发来的强制下发请求（overrides 为浮窗输入的蓝牙名称/BMS编码；
   *  skipConfirm=true 表示浮窗侧已弹原生确认框，主窗口不再二次确认） */
  onForceWrite: (
    callback: (overrides?: { btName?: string; bmsCode?: string }, skipConfirm?: boolean) => void
  ) => void
  /** 主窗口：监听浮窗发来的单参数下发/复位 MCU 请求（skipConfirm 同上） */
  onParamAction: (callback: (action: string, value?: string, skipConfirm?: boolean) => void) => void
  /** 浮窗：监听主窗口推送的蓝牙名称/BMS编码当前值 */
  onFieldValues: (callback: (v: { btName: string; bmsCode: string }) => void) => void
  /** 浮窗：监听主窗口转发来的通讯日志 */
  onLog: (callback: (entry: FloatLogEntry) => void) => void
  /** 浮窗：监听主窗口推送的当前模板名 */
  onTemplate: (callback: (name: string) => void) => void
  /** 浮窗：监听主窗口推送的下发/读取进度（busy/百分比/类别） */
  onProgress: (callback: (p: { busy: boolean; progress: number; kind?: 'read' | 'write' }) => void) => void
  /** 主窗口：监听浮窗发来的读取全部请求 */
  onReadAll: (callback: () => void) => void
}

interface Window {
  serialAPI: SerialAPI
  updaterAPI: UpdaterAPI
  shellAPI: ShellAPI
  authAPI: BackendAuthAPI
  dispatchAPI: DispatchAPI
  bmsAPI: BmsAPI
  floatAPI: FloatAPI
  notifyAPI: NotifyAPI
}
