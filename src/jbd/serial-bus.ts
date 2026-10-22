/**
 * SerialBus —— 照搬 SWJ 项目（src/core/serial.ts）的串口总线实现。
 *
 * 与 SWJ 的差异仅在于通道：SWJ 直接持有 Web Serial 的 port；
 * 本项目同样直接使用 Electron/Chromium 内置的 navigator.serial（不引入原生模块），
 * 因此逻辑可原样移植：读循环累积字节 → 按长度切帧 → 按命令码配对等待者。
 *
 * 发送采用「一问一答」：transact 写入后等待同命令码应答，超时抛错；
 * 每次重试前清空接收缓冲，避免上一轮迟到的应答把这一轮的帧切错位。
 * 整个过程没有队列，靠调用方串行 await + waitRefreshIdle 让位来保证不并发。
 */
import { JbdSession } from './jbd-session'
import type { Frame } from './jbd-protocol'

export interface WebPortInfo {
  index: number
  label: string
  usbVendorId?: number
  usbProductId?: number
}

export interface OpenOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
  flowControl?: 'none' | 'hardware'
}

type Waiter = {
  cmd: number
  resolve: (f: Frame) => void
  reject: (e: Error) => void
  timer: number
}

/**
 * 实时轮询让位标志（照搬 SWJ device.ts 的 refreshing / waitRefreshIdle）。
 *
 * transact 每次发送前会清空接收缓冲，两路事务并行会把对方的应答切错位，
 * 因此长操作（读参数/写参数）开始前先让正在跑的轮询结束。
 */
let refreshing = false

/** 收发流量钩子（供 App 记录通讯日志；参数层不直接依赖 store） */
export type TrafficHook = (dir: 'tx' | 'rx', bytes: number[]) => void
let trafficHook: TrafficHook | null = null

export function setTrafficHook(fn: TrafficHook | null): void {
  trafficHook = fn
}

export function isRefreshing(): boolean {
  return refreshing
}

/** 尝试进入刷新态；已有刷新在跑时返回 false */
export function tryEnterRefresh(): boolean {
  if (refreshing) return false
  refreshing = true
  return true
}

export function exitRefresh(): void {
  refreshing = false
}

/** 等静默轮询收尾再发新帧 */
export async function waitRefreshIdle(maxMs = 3000): Promise<void> {
  const t0 = Date.now()
  while (refreshing && Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 40))
  }
}

export class SerialBus {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private keepReading = false
  private session = new JbdSession((f) => this.dispatch(f))
  private waiters: Waiter[] = []
  private listeners = new Set<(f: Frame) => void>()
  private errorHandler: ((e: Error) => void) | null = null

  get isOpen(): boolean {
    return this.port !== null && this.keepReading
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator
  }

  /** 已授权过的串口列表 */
  static async granted(): Promise<WebPortInfo[]> {
    if (!SerialBus.supported()) return []
    const ports = await navigator.serial.getPorts()
    return ports.map((p, i) => {
      const info = p.getInfo()
      return {
        index: i,
        label: SerialBus.describe(info),
        usbVendorId: info.usbVendorId,
        usbProductId: info.usbProductId
      }
    })
  }

  private static describe(info: { usbVendorId?: number; usbProductId?: number }): string {
    const vid = info.usbVendorId?.toString(16).toUpperCase().padStart(4, '0')
    const pid = info.usbProductId?.toString(16).toUpperCase().padStart(4, '0')
    if (vid && pid) return `USB VID:${vid} PID:${pid}`
    return '串口设备'
  }

  /** 弹出系统选择框 */
  static async request(): Promise<SerialPort | null> {
    if (!SerialBus.supported()) return null
    try {
      return await navigator.serial.requestPort()
    } catch {
      return null
    }
  }

  onFrame(fn: (r: Frame) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  onError(fn: (e: Error) => void): void {
    this.errorHandler = fn
  }

  async open(port: SerialPort, opts: OpenOptions): Promise<void> {
    await this.close()
    await port.open({
      baudRate: opts.baudRate,
      dataBits: opts.dataBits ?? 8,
      stopBits: opts.stopBits ?? 1,
      parity: opts.parity ?? 'none',
      flowControl: opts.flowControl ?? 'none',
      bufferSize: 4096
    })
    this.port = port
    this.session.reset()
    this.keepReading = true
    void this.readLoop()
  }

  async close(): Promise<void> {
    this.keepReading = false
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    this.reader = null
    this.waiters.forEach((w) => {
      clearTimeout(w.timer)
      w.reject(new Error('端口已关闭'))
    })
    this.waiters = []
    try {
      await this.port?.close()
    } catch {
      /* ignore */
    }
    this.port = null
    this.session.reset()
    exitRefresh()
  }

  private async readLoop(): Promise<void> {
    const port = this.port
    if (!port?.readable) return
    const reader = port.readable.getReader()
    this.reader = reader
    try {
      while (this.keepReading) {
        const { value, done } = await reader.read()
        if (done) break
        if (value && value.length) this.dispatchBytes(Array.from(value))
      }
    } catch (e) {
      if (this.keepReading) this.errorHandler?.(e as Error)
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* ignore */
      }
      this.reader = null
    }
  }

  private dispatchBytes(bytes: number[]): void {
    trafficHook?.('rx', bytes)
    this.session.feed(bytes)
  }

  private dispatch(f: Frame): void {
    this.listeners.forEach((l) => l(f))
    const idx = this.waiters.findIndex((w) => w.cmd === f.cmd)
    if (idx >= 0) {
      const w = this.waiters.splice(idx, 1)[0]
      clearTimeout(w.timer)
      w.resolve(f)
    }
  }

  /**
   * 发送一帧并等待对应命令码的应答。
   * 现场 CH340 转接板偶发丢帧，故支持重试：每次重试前清空接收缓冲，
   * 避免上一轮迟到的应答把这一轮的帧切错位。
   */
  async transact(frame: number[], cmd: number, timeoutMs = 1200, retries = 1): Promise<Frame> {
    if (!this.port) throw new Error('串口未打开')
    const max = Math.max(1, retries)
    let lastErr: Error | null = null
    for (let attempt = 1; attempt <= max; attempt++) {
      this.session.reset()
      try {
        return await this.sendOnce(frame, cmd, timeoutMs)
      } catch (e) {
        lastErr = e as Error
        const retryable = lastErr.message.includes('超时')
        if (attempt < max && retryable) {
          await new Promise((r) => setTimeout(r, 60))
          continue
        }
        if (retryable && max > 1) {
          throw new Error(`${lastErr.message}，已重试 ${max - 1} 次`)
        }
        throw lastErr
      }
    }
    throw lastErr ?? new Error('通讯失败')
  }

  /** 仅写不等应答（不参与应答配对，调用方自行订阅 onFrame） */
  async sendRaw(frame: number[]): Promise<void> {
    if (!this.port) throw new Error('串口未打开')
    await this.write(frame)
  }

  private async sendOnce(frame: number[], cmd: number, timeoutMs: number): Promise<Frame> {
    const waiter = new Promise<Frame>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer)
        reject(new Error(`等待应答超时（命令 0x${cmd.toString(16).toUpperCase()}）`))
      }, timeoutMs)
      this.waiters.push({ cmd, resolve, reject, timer })
    })
    await this.write(frame)
    const f = await waiter
    if (!f.valid) throw new Error('应答校验失败')
    return f
  }

  private async write(frame: number[]): Promise<void> {
    const writer = this.port?.writable?.getWriter()
    if (!writer) throw new Error('串口不可写')
    try {
      await writer.write(new Uint8Array(frame))
      trafficHook?.('tx', frame)
    } finally {
      writer.releaseLock()
    }
  }
}

export const serialBus = new SerialBus()
