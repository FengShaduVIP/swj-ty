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

/** 无边框窗口控制（注入自 preload.ts，标题栏自绘用） */
interface WinAPI {
  minimize: () => Promise<{ ok: boolean }>
  toggleMaximize: () => Promise<{ ok: boolean }>
  close: () => Promise<{ ok: boolean }>
  onMaximizedChange: (callback: (maximized: boolean) => void) => void
}

/** 通讯日志独立窗口（注入自 preload.ts；浏览器 H5 预览无此 API，降级页内浮窗） */
interface LogWinAPI {
  open: () => Promise<{ ok: boolean }>
  push: (lines: { id: number; time: string; type: string; content: string }[]) => void
  onReady: (callback: () => void) => void
  onAppend: (callback: (lines: { id: number; time: string; type: string; content: string }[]) => void) => void
  onClear: (callback: () => void) => void
  requestClear: () => void
  onCfg: (callback: (cfg: { maxLines: number }) => void) => void
  setTheme: (dark: boolean) => void
  onTheme: (callback: (dark: boolean) => void) => void
}

interface Window {
  serialAPI: SerialAPI
  updaterAPI: UpdaterAPI
  shellAPI: ShellAPI
  authAPI: BackendAuthAPI
  dispatchAPI: DispatchAPI
  bmsAPI: BmsAPI
  winAPI?: WinAPI
  logWinAPI?: LogWinAPI
}
