/**
 * 天一 Modbus-RTU 帧总线：单例。
 * 封装 Modbus 切帧与串行发送队列，确保任意两条请求之间 ≥500ms 间隔且上一条已响应。
 *
 * 数据流：App 收到串口字节 → tianyiBus.feed(bytes)
 *                              → ModbusSession 切帧 → 广播给所有 onFrame 订阅者
 * 发送：任意组件 → tianyiBus.send(frame) / tianyiBus.sendAck(frame)
 *                              → 串行队列（单条在途锁，帧间强制 500ms）依次写串口并等待应答
 */
import { parseModbusFrame, type ModbusFrame } from './tianyi-protocol'
import { FRAME_TIMEOUT_MS } from '../constants'

type FrameListener = (frame: ModbusFrame) => void
type TimeoutFrame = ModbusFrame & { timeout: true }

const TIMEOUT_FRAME = (): TimeoutFrame => ({
  slave: 0, func: 0, data: [], crcOk: false, timeout: true,
})

const QUEUE_CAP = 32
/** Modbus-RTU 协议要求同一总线上任意两条请求间隔 ≥ 500ms */
const INTER_FRAME_GAP_MS = 500

interface QueueJob {
  frame: number[]
  expectedFunc: number
  resolve: (f: ModbusFrame) => void
  timeoutMs: number
}

class ModbusSession {
  private buf: number[] = []
  private onFrame: (f: ModbusFrame) => void

  constructor(onFrame: (f: ModbusFrame) => void) {
    this.onFrame = onFrame
  }

  feed(bytes: number[]): void {
    this.buf.push(...bytes)
    this.parse()
  }

  private parse(): void {
    while (this.buf.length >= 5) {
      // 查找有效从机地址起始（0x01-0xF7 为有效从机地址，0x00 广播）
      let start = 0
      while (start < this.buf.length && (this.buf[start] === 0 || this.buf[start] > 0xf7)) {
        start++
      }
      if (start > 0) {
        this.buf = this.buf.slice(start)
        if (this.buf.length < 5) return
      }

      const func = this.buf[1] & 0xff
      const exception = !!(func & 0x80)
      let frameLen: number
      if (exception) {
        frameLen = 5 // slave + func + exceptionCode + crc2
      } else {
        const cleanFunc = func & 0x7f
        if (cleanFunc === 0x03 || cleanFunc === 0x04) {
          const byteCount = this.buf[2] & 0xff
          frameLen = 1 + 1 + 1 + byteCount + 2
        } else if (cleanFunc === 0x06 || cleanFunc === 0x10) {
          frameLen = 8
        } else {
          // 未知功能码，丢弃首字节重新尝试
          this.buf.shift()
          continue
        }
      }

      if (this.buf.length < frameLen) return
      const candidate = this.buf.slice(0, frameLen)
      const parsed = parseModbusFrame(candidate)
      if (parsed && parsed.crcOk) {
        this.onFrame(parsed)
        this.buf = this.buf.slice(frameLen)
      } else {
        // CRC 错误则丢弃首字节继续尝试同步
        this.buf.shift()
      }
    }
  }

  reset(): void {
    this.buf = []
  }
}

class TianyiBus {
  private session: ModbusSession
  private listeners = new Set<FrameListener>()
  private onceResolvers: ((frame: ModbusFrame) => void)[] = []
  private sender: ((frame: number[]) => void) | null = null
  private senderReady = false

  private outQueue: QueueJob[] = []
  private busy = false
  private lastSendAt = 0

  constructor() {
    this.session = new ModbusSession((f) => this.dispatch(f))
  }

  feed(bytes: number[]): void {
    this.session.feed(bytes)
  }

  private dispatch(f: ModbusFrame): void {
    if (this.onceResolvers.length) {
      const resolvers = [...this.onceResolvers]
      resolvers.forEach((r) => r(f))
    }
    this.listeners.forEach((l) => l(f))
  }

  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  setSender(fn: (frame: number[]) => void): void {
    this.sender = fn
  }

  setConnected(ready: boolean): void {
    this.senderReady = ready
  }

  private enqueue(frame: number[], expectedFunc: number, timeoutMs = FRAME_TIMEOUT_MS): Promise<ModbusFrame> {
    return new Promise((resolve) => {
      if (this.outQueue.length >= QUEUE_CAP) {
        console.warn('[tianyiBus] 发送队列已满，丢弃帧:', frame)
        resolve(TIMEOUT_FRAME())
        return
      }
      this.outQueue.push({ frame, expectedFunc, resolve, timeoutMs })
      this.pump()
    })
  }

  private pump(): void {
    if (this.busy) return
    const job = this.outQueue.shift()
    if (!job) return
    if (!this.sender || !this.senderReady) {
      job.resolve(TIMEOUT_FRAME())
      this.pump()
      return
    }

    this.busy = true
    const elapsed = Date.now() - this.lastSendAt
    const delay = Math.max(0, INTER_FRAME_GAP_MS - elapsed)

    const doSend = () => {
      let settled = false
      const wrapped = (f: ModbusFrame) => {
        if (f.func !== job.expectedFunc) return
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.removeResolver(wrapped)
        this.busy = false
        this.lastSendAt = Date.now()
        job.resolve(f)
        this.pump()
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.removeResolver(wrapped)
        this.busy = false
        this.lastSendAt = Date.now()
        job.resolve(TIMEOUT_FRAME())
        this.pump()
      }, job.timeoutMs)
      this.onceResolvers.push(wrapped)
      this.sender!(job.frame)
      this.lastSendAt = Date.now()
    }

    if (delay > 0) {
      setTimeout(doSend, delay)
    } else {
      doSend()
    }
  }

  private removeResolver(w: (f: ModbusFrame) => void): void {
    this.onceResolvers = this.onceResolvers.filter((r) => r !== w)
  }

  sendAck(frame: number[], timeoutMs = FRAME_TIMEOUT_MS): Promise<ModbusFrame> {
    const expectedFunc = frame[1] & 0x7f
    return this.enqueue(frame, expectedFunc, timeoutMs)
  }

  send(frame: number[]): void {
    const expectedFunc = frame[1] & 0x7f
    void this.enqueue(frame, expectedFunc)
  }

  onceResponse(timeoutMs = FRAME_TIMEOUT_MS, expectedFunc?: number): Promise<ModbusFrame> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const wrapped = (f: ModbusFrame) => {
        if (expectedFunc !== undefined && f.func !== expectedFunc) return
        if (timer) { clearTimeout(timer); timer = null }
        this.onceResolvers = this.onceResolvers.filter((r) => r !== wrapped)
        resolve(f)
      }
      timer = setTimeout(() => {
        this.onceResolvers = this.onceResolvers.filter((r) => r !== wrapped)
        resolve(TIMEOUT_FRAME())
      }, timeoutMs)
      this.onceResolvers.push(wrapped)
    })
  }

  clear(): void {
    this.onceResolvers = []
    this.outQueue = []
    this.busy = false
    this.session.reset()
  }
}

export const tianyiBus = new TianyiBus()
