/**
 * JBD 串口会话：累积串口字节流，按长度字段切分出完整帧并回调解析结果。
 * 协议无转义，故以「长度字段」(帧第 4 字节) 计算整帧长 = len + 7，
 * 比单纯搜 0xDD/0x77 更稳健，可容忍数据体内出现 0xDD/0x77。
 */
import { parseFrame, type Frame } from './jbd-protocol'

export class JbdSession {
  private buf: number[] = []
  private readonly maxBuf = 4096

  constructor(private onFrame: (frame: Frame) => void) {}

  /** 喂入一帧串口收到的字节（可能分片或粘连） */
  feed(chunks: number[]): void {
    this.buf.push(...chunks)
    if (this.buf.length > this.maxBuf) this.buf = this.buf.slice(-this.maxBuf / 2)

    let i = 0
    while (i < this.buf.length) {
      if (this.buf[i] !== 0xdd) { i++; continue }
      if (i + 3 >= this.buf.length) break // 还需 cmd/status/len
      const len = this.buf[i + 3] & 0xff
      const frameLen = len + 7
      if (this.buf.length < i + frameLen) break // 帧不完整，等待更多数据
      const frameBytes = this.buf.slice(i, i + frameLen)
      if (frameBytes[frameBytes.length - 1] === 0x77) {
        const f = parseFrame(frameBytes)
        if (f) this.onFrame(f)
      }
      i += frameLen
    }
    this.buf = this.buf.slice(i)
  }

  reset(): void {
    this.buf = []
  }
}
