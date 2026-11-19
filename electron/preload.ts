import { contextBridge, ipcRenderer } from 'electron'

// === 自动更新相关类型 ===
export type UpdaterState =
  | 'idle' | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'dev-disabled'

export interface UpdaterStatus {
  state: UpdaterState
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
  error?: string
  checkedAt?: number
  source?: string
}

export interface UpdaterConfig {
  enabled: boolean
  source: string
  checkOnStartup: boolean
  checkIntervalMs: number
  autoDownload: boolean
  currentVersion: string
}

export interface BackendLoginResult {
  ok: boolean
  userId?: number
  username?: string
  expiresTime?: number
  error?: string
}

export interface BackendAuthStatus {
  loggedIn: boolean
  userId?: number
  username?: string
  expiresTime?: number
}

export interface BackendAuthAPI {
  login: (credentials: { username: string; password: string }) => Promise<BackendLoginResult>
  getStatus: () => Promise<BackendAuthStatus>
  logout: () => Promise<{ ok: boolean }>
}

export interface DispatchUploadResult {
  ok: boolean
  error?: string
}

export interface UpdaterAPI {
  checkNow: () => Promise<{ ok: boolean; state?: string; error?: string }>
  /** 用户确认后开始下载更新（手动确认策略：不自动下载） */
  download: () => Promise<{ ok: boolean; error?: string }>
  quitAndInstall: () => Promise<{ ok: boolean; error?: string }>
  getConfig: () => Promise<UpdaterConfig>
  onStatus: (callback: (status: UpdaterStatus) => void) => void
  removeStatusListeners: () => void
}

// 暴露无边框窗口控制能力（最小化/最大化还原/关闭 + 最大化状态广播）
contextBridge.exposeInMainWorld('winAPI', {
  minimize: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('win:toggleMaximize'),
  close: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('win:close'),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('win:maximized', (_event, maximized: boolean) => callback(maximized))
  }
})

// 暴露后台登录能力（请求在主进程执行，accessToken 不进入渲染进程）
contextBridge.exposeInMainWorld('authAPI', {
  login: (credentials: { username: string; password: string }): Promise<BackendLoginResult> =>
    ipcRenderer.invoke('auth:login', credentials),

  getStatus: (): Promise<BackendAuthStatus> =>
    ipcRenderer.invoke('auth:status'),

  logout: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('auth:logout')
})

// 暴露参数下发记录上传能力（HTTP 请求与 token 均留在主进程）
contextBridge.exposeInMainWorld('dispatchAPI', {
  upload: (record: {
    btName: string
    dispatchedAt: number
    params: { label: string; index?: number; value: unknown }[]
  }): Promise<DispatchUploadResult> =>
    ipcRenderer.invoke('dispatch:upload', record)
})

// 暴露参数下发确认密码校验（密码常量留在主进程，渲染层 bundle 不落明文）
contextBridge.exposeInMainWorld('bmsAPI', {
  verifyDispatchPwd: (candidate: string): Promise<boolean> =>
    ipcRenderer.invoke('bms:verifyDispatchPwd', candidate)
})

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('serialAPI', {
  // 获取串口列表
  listPorts: (): Promise<SerialPortInfo[]> => ipcRenderer.invoke('serial:list'),

  // 连接串口
  connect: (config: SerialConnectConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('serial:connect', config),

  // 断开串口
  disconnect: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('serial:disconnect'),

  // 发送数据
  send: (data: number[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('serial:send', data),

  // 获取连接状态
  getStatus: (): Promise<SerialStatus> =>
    ipcRenderer.invoke('serial:status'),

  // 设置/取消自动连接（按 VID/PID 匹配 USB 串口）
  setAutoConnect: (enabled: boolean, config?: AutoConnectConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('serial:setAutoConnect', enabled, config),

  // 读取当前自动连接配置
  getAutoConnect: (): Promise<AutoConnectConfig | null> =>
    ipcRenderer.invoke('serial:getAutoConnect'),

  // 监听串口数据
  onData: (callback: (data: number[]) => void) => {
    ipcRenderer.on('serial:data', (_event, data: number[]) => callback(data))
  },

  // 监听错误
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('serial:error', (_event, error: string) => callback(error))
  },

  // 监听状态变化
  onStatusChange: (callback: (status: SerialStatus) => void) => {
    ipcRenderer.on('serial:statusChange', (_event, status: SerialStatus) => callback(status))
  },

  // 移除监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('serial:data')
    ipcRenderer.removeAllListeners('serial:error')
    ipcRenderer.removeAllListeners('serial:statusChange')
  }
})

// 暴露自动更新 API 给渲染进程（安全桥接）
contextBridge.exposeInMainWorld('updaterAPI', {
  /** 立即检查一次更新（手动触发） */
  checkNow: (): Promise<{ ok: boolean; state?: string; error?: string }> =>
    ipcRenderer.invoke('updater:checkNow'),

  /** 用户确认后开始下载更新（手动确认策略：不自动下载） */
  download: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('updater:download'),

  /** 退出并应用已下载的更新（重启） */
  quitAndInstall: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('updater:quitAndInstall'),

  /** 读取更新配置（源、频率、开关等） */
  getConfig: (): Promise<UpdaterConfig> =>
    ipcRenderer.invoke('updater:getConfig'),

  /** 订阅更新状态广播 */
  onStatus: (callback: (status: UpdaterStatus) => void) => {
    ipcRenderer.on('updater:status', (_event, status: UpdaterStatus) => callback(status))
  },

  /** 移除更新状态监听 */
  removeStatusListeners: () => {
    ipcRenderer.removeAllListeners('updater:status')
  }
})

// 暴露「在系统默认浏览器打开外部链接」能力（避免外部网页被载入应用内）
contextBridge.exposeInMainWorld('shellAPI', {
  /** 用系统默认浏览器打开外部链接，url 须为 http/https */
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('app:openExternal', url)
})

// 暴露通讯日志独立窗口能力（主窗口推送 / 日志窗口接收，主进程中转）
contextBridge.exposeInMainWorld('logWinAPI', {
  /** 主窗口：打开/聚焦日志窗口（默认停靠主窗口右侧外侧） */
  open: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('log:open'),
  /** 主窗口 → 日志窗口：批量追加条目 */
  push: (lines: { id: number; time: string; type: string; content: string }[]) =>
    ipcRenderer.send('log:push', lines),
  /** 日志窗口：历史日志回填就绪（打开后由主进程广播一次） */
  onReady: (callback: () => void) => {
    ipcRenderer.on('log:ready', () => callback())
  },
  /** 日志窗口：接收追加条目 */
  onAppend: (callback: (lines: { id: number; time: string; type: string; content: string }[]) => void) => {
    ipcRenderer.on('log:append', (_event, lines) => callback(lines))
  },
  /** 日志窗口：接收清空指令 */
  onClear: (callback: () => void) => {
    ipcRenderer.on('log:clear', () => callback())
  },
  /** 日志窗口：发起清空请求（经主进程中转到主窗口） */
  requestClear: () => ipcRenderer.send('log:clear-request'),
  /** 日志窗口：接收容量常量（单一来源 src/constants） */
  onCfg: (callback: (cfg: { maxLines: number }) => void) => {
    ipcRenderer.on('log:cfg', (_event, cfg) => callback(cfg))
  },
  /** 主窗口：推送主题到日志窗口（dark = true 深色） */
  setTheme: (dark: boolean) => ipcRenderer.send('log:theme', dark),
  /** 日志窗口：接收主题切换 */
  onTheme: (callback: (dark: boolean) => void) => {
    ipcRenderer.on('log:theme', (_event, dark) => callback(dark))
  }
})

// === 类型定义 ===

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  friendlyName?: string
  vendorId?: string
  productId?: string
}

export interface SerialConnectConfig {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

export interface SerialStatus {
  connected: boolean
  portPath?: string
  baudRate?: number
  /** 本次连接是否由自动连接守护建立（渲染层用于决定是否自动跳转监测页） */
  auto?: boolean
}

/** 自动连接配置：按 VID/PID（可选名称）匹配 USB 串口 */
export interface AutoConnectConfig {
  enabled: boolean
  vendorId?: string
  productId?: string
  friendlyName?: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}
