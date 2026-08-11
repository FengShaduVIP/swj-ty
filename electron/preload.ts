import { contextBridge, ipcRenderer } from 'electron'

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
}
