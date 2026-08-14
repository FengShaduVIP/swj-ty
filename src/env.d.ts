/// <reference types="vite/client" />

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

interface Window {
  serialAPI: SerialAPI
}
