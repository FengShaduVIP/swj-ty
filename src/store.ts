/* =========================================================================
 * 全局 UI 状态 store（轻量 reactive，非 Pinia）
 * 让顶部状态栏能读取「连接状态 + 关键实时读数 + 告警数 + 采样计数」，
 * 由 App.vue（连接）与各视图（实时采样）写入。
 * ========================================================================= */
import { reactive } from 'vue'

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ProtocolId = 'jbd'

export interface LiveSample {
  totalVoltage_V: number | null
  current_A: number | null
  soc: number | null
  maxTemp_C: number | null
  cellCount: number | null
}

export const ui = reactive({
  /** 连接状态：未连接 / 连接中 / 已连接 / 通信异常 */
  conn: 'disconnected' as ConnState,
  portPath: '',
  baudRate: 0,
  /** 当前选中的通讯协议（现仅支持嘉佰达 JBD） */
  protocol: 'jbd' as ProtocolId,
  /** 通信超时/错误最近发生时间戳（用于状态栏异常判断） */
  lastCommErrorAt: 0,
  /** 累计采样次数 */
  sampleCount: 0,
  /** 当前告警/保护条数 */
  alarmCount: 0,
  /** 最近一次实时采样（供状态栏关键读数展示） */
  live: {
    totalVoltage_V: null,
    current_A: null,
    soc: null,
    maxTemp_C: null,
    cellCount: null,
  } as LiveSample,
})

export function setConnected(port: string, baud: number) {
  ui.conn = 'connected'
  ui.portPath = port
  ui.baudRate = baud
  ui.lastCommErrorAt = 0
}

export function setConnecting() {
  ui.conn = 'connecting'
}

export function setDisconnected() {
  ui.conn = 'disconnected'
  ui.portPath = ''
  ui.baudRate = 0
  ui.live = { totalVoltage_V: null, current_A: null, soc: null, maxTemp_C: null, cellCount: null }
}

export function markCommError() {
  ui.lastCommErrorAt = Date.now()
  ui.conn = 'error'
}

export function pushSample() {
  ui.sampleCount++
}
