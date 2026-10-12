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

// 暴露屏幕级通知能力（独立透明置顶小窗，固定屏幕右上角，不自动关闭）
contextBridge.exposeInMainWorld('notifyAPI', {
  /** 显示通知（替换当前可见通知），须手动关闭 */
  show: (p: { title: string; message: string; type?: 'success' | 'warning' }): void => {
    ipcRenderer.send('notify:show', p)
  },

  /** 关闭当前通知（通知窗上的关闭按钮调用） */
  close: (): void => {
    ipcRenderer.send('notify:close')
  },

  /** 通知窗：监听主进程发来的通知内容 */
  onShow: (callback: (p: { title: string; message: string; type: string }) => void) => {
    ipcRenderer.on('notify:data', (_event, p) => callback(p))
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

// 暴露浮动窗口控制能力（窗口的创建/销毁在主进程管理）
contextBridge.exposeInMainWorld('floatAPI', {
  /** 打开浮窗（已存在则置前） */
  open: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('float:open'),

  /** 关闭浮窗（仅浮窗自身关闭按钮调用） */
  close: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('float:close'),

  /** 显示并聚焦主窗口（浮窗"回到主界面"按钮） */
  showMain: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('float:showMain'),

  /** 切换浮窗置顶 */
  setAlwaysOnTop: (enabled: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('float:setAlwaysOnTop', enabled),

  /** 请求主窗口执行强制下发（参数状态与确认框都在主窗口） */
  requestForceWrite: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('float:requestForceWrite'),

  /** 请求主窗口执行单参数下发/复位 MCU（action: bt-name | bms-code | reset-mcu，value 为浮窗输入框值） */
  requestParamAction: (action: 'bt-name' | 'bms-code' | 'reset-mcu', value?: string): void => {
    ipcRenderer.send('float:paramAction', { action, value })
  },

  /** 主窗口：蓝牙名称/BMS编码当前值变化时同步给浮窗输入框 */
  pushFieldValues: (v: { btName: string; bmsCode: string }): void => {
    ipcRenderer.send('float:pushValues', v)
  },

  /** 主窗口：addLog 后把日志条目逐条同步给浮窗（浮窗不存在时主进程丢弃） */
  pushLog: (entry: { id: number; time: string; type: string; content: string }): void => {
    ipcRenderer.send('float:pushLog', entry)
  },

  /** 主窗口：当前导入模板名变化时同步给浮窗 */
  pushTemplate: (name: string): void => {
    ipcRenderer.send('float:pushTemplate', name)
  },

  /** 主窗口：监听浮窗发来的强制下发请求 */
  onForceWrite: (callback: () => void) => {
    ipcRenderer.on('float:forceWrite', () => callback())
  },

  /** 主窗口：监听浮窗发来的单参数下发/复位 MCU 请求 */
  onParamAction: (callback: (action: string, value?: string) => void) => {
    ipcRenderer.on('float:paramAction', (_event, payload: { action: string; value?: string }) =>
      callback(payload.action, payload.value))
  },

  /** 浮窗：监听主窗口推送的蓝牙名称/BMS编码当前值 */
  onFieldValues: (callback: (v: { btName: string; bmsCode: string }) => void) => {
    ipcRenderer.on('float:values', (_event, v: { btName: string; bmsCode: string }) => callback(v))
  },

  /** 浮窗：监听主窗口转发来的通讯日志 */
  onLog: (callback: (entry: { id: number; time: string; type: string; content: string }) => void) => {
    ipcRenderer.on('float:log', (_event, entry) => callback(entry))
  },

  /** 浮窗：监听主窗口推送的当前模板名 */
  onTemplate: (callback: (name: string) => void) => {
    ipcRenderer.on('float:template', (_event, name: string) => callback(name))
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
