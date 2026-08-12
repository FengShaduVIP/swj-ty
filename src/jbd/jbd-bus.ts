/**
 * JBD 帧总线：单例。封装 JbdSession，让多个 UI 组件（实时面板、趋势曲线、批量宏）
 * 共享同一路串口帧流，并复用同一发送通道，避免重复建会话 / 抢响应。
 *
 * 数据流：App 收到串口字节 → jbdBus.feed(bytes)
 *                              → JbdSession 切帧 → 广播给所有 onFrame 订阅者
 * 发送：任意组件 → jbdBus.send(frame) / jbdBus.sendAck(frame)
 *                              → 串行队列（单条在途锁）依次写串口并等待应答
 *
 * 设计要点（2026-08-12 加固）：
 *  - 方案1：所有发送进入串行队列，确保同一时刻只有一条命令在途，等其应答（或超时）
 *    后再发下一条，彻底消除自动轮询 / 参数读写 / 宏脚本之间的总线抢占与帧交叠。
 *  - 应答配对采用「命令码」匹配：发送帧的 frame[2] 即 BMS 回显的命令码（见 jbd-protocol）。
 */
import { JbdSession } from './jbd-session'
import type { Frame } from './jbd-protocol'

type FrameListener = (frame: Frame) => void
type TimeoutFrame = Frame & { timeout: true }

const TIMEOUT_FRAME = (): TimeoutFrame => ({
  cmd: -1, status: -1, len: 0, data: [], checksum: [0, 0], callbackId: [], valid: false, timeout: true,
})

/** 发送队列深度上限：超出则丢弃新帧（避免断线/无应答时队列无限堆积） */
const QUEUE_CAP = 32
/** 单帧等待应答的默认超时（ms） */
const DEFAULT_ACK_TIMEOUT = 1500

interface QueueJob {
  frame: number[]
  expectedCmd: number
  resolve: (f: Frame) => void
  timeoutMs: number
}

class JbdBus {
  private session: JbdSession
  private listeners = new Set<FrameListener>()
  private onceResolvers: ((frame: Frame) => void)[] = []
  private sender: ((frame: number[]) => void) | null = null

  // ===== 命令串行化队列（方案1：单条在途锁）=====
  private outQueue: QueueJob[] = []
  private busy = false

  constructor() {
    this.session = new JbdSession((f) => this.dispatch(f))
  }

  /** App 收到串口原始字节时调用 */
  feed(bytes: number[]): void {
    this.session.feed(bytes)
  }

  private dispatch(f: Frame): void {
    // 先派发给「等待下一帧」的一次性订阅者（宏脚本 / 参数配置用）
    // 每个 resolver 自己按 expectedCmd 过滤，不匹配就继续等待
    if (this.onceResolvers.length) {
      const resolvers = [...this.onceResolvers]
      resolvers.forEach((r) => r(f))
    }
    // 再广播给常驻订阅者（实时面板等）
    this.listeners.forEach((l) => l(f))
  }

  /** 订阅帧，返回取消订阅函数 */
  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** App 注册底层发送函数（写串口 + 记日志） */
  setSender(fn: (frame: number[]) => void): void {
    this.sender = fn
  }

  // ===== 串行队列实现 =====
  private enqueue(frame: number[], expectedCmd: number, timeoutMs = DEFAULT_ACK_TIMEOUT): Promise<Frame> {
    return new Promise((resolve) => {
      if (this.outQueue.length >= QUEUE_CAP) {
        console.warn('[jbdBus] 发送队列已满，丢弃帧:', frame)
        resolve(TIMEOUT_FRAME())
        return
      }
      this.outQueue.push({ frame, expectedCmd, resolve, timeoutMs })
      this.pump()
    })
  }

  private pump(): void {
    if (this.busy) return
    const job = this.outQueue.shift()
    if (!job) return
    if (!this.sender) {
      job.resolve(TIMEOUT_FRAME())
      this.pump()
      return
    }
    this.busy = true
    let settled = false
    const wrapped = (f: Frame) => {
      if (f.cmd !== job.expectedCmd) return // 仅响应匹配命令码
      if (settled) return
      settled = true
      clearTimeout(timer)
      this.removeResolver(wrapped)
      this.busy = false
      job.resolve(f)
      this.pump()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      this.removeResolver(wrapped)
      this.busy = false
      job.resolve(TIMEOUT_FRAME())
      this.pump()
    }, job.timeoutMs)
    this.onceResolvers.push(wrapped)
    this.sender(job.frame)
  }

  private removeResolver(w: (f: Frame) => void): void {
    this.onceResolvers = this.onceResolvers.filter((r) => r !== w)
  }

  /** 发送并等待应答（用于需要确认结果的指令，如参数读取/下发），返回响应帧或超时帧 */
  sendAck(frame: number[], timeoutMs = DEFAULT_ACK_TIMEOUT): Promise<Frame> {
    const expectedCmd = frame[2] & 0xff
    return this.enqueue(frame, expectedCmd, timeoutMs)
  }

  /** 发送（fire-and-forget，仍经队列串行化，避免抢占总线） */
  send(frame: number[]): void {
    const expectedCmd = frame[2] & 0xff
    void this.enqueue(frame, expectedCmd)
  }

  /** 等待下一帧（用于请求-响应配对 / 宏顺序执行）。超时返回 timeout:true 帧。
   * 传入 expectedCmd 时只响应该命令码的帧，避免多组件并发等待时互相抢响应。 */
  onceResponse(timeoutMs = 1500, expectedCmd?: number): Promise<Frame> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const wrapped = (f: Frame) => {
        if (expectedCmd !== undefined && f.cmd !== expectedCmd) return
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

  /** 清空订阅与缓冲（组件卸载 / 重连时调用，避免 HMR 或重连的残留） */
  clear(): void {
    this.listeners.clear()
    this.onceResolvers = []
    this.outQueue = []
    this.busy = false
    this.session.reset()
  }
}

export const jbdBus = new JbdBus()
