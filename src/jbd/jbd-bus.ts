/**
 * JBD 帧总线：单例。封装 JbdSession，让多个 UI 组件（实时面板、趋势曲线、批量宏）
 * 共享同一路串口帧流，并复用同一发送通道，避免重复建会话 / 抢响应。
 *
 * 数据流：App 收到串口字节 → jbdBus.feed(bytes)
 *                              → JbdSession 切帧 → 广播给所有 onFrame 订阅者
 * 发送：任意组件 → jbdBus.send(frame) → App 注册的 sender（写串口 + 记日志）
 */
import { JbdSession } from './jbd-session'
import type { Frame } from './jbd-protocol'

type FrameListener = (frame: Frame) => void
type TimeoutFrame = Frame & { timeout: true }

const TIMEOUT_FRAME = (): TimeoutFrame => ({
  cmd: -1, status: -1, len: 0, data: [], checksum: [0, 0], callbackId: [], valid: false, timeout: true,
})

class JbdBus {
  private session: JbdSession
  private listeners = new Set<FrameListener>()
  private onceResolvers: ((frame: Frame) => void)[] = []
  private sender: ((frame: number[]) => void) | null = null

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

  /** 发送一帧（经 App 注册的 sender 写串口） */
  send(frame: number[]): void {
    if (!this.sender) {
      console.warn('[jbdBus] 未注册发送器，丢弃帧:', frame)
      return
    }
    this.sender(frame)
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
    this.session.reset()
  }
}

export const jbdBus = new JbdBus()
