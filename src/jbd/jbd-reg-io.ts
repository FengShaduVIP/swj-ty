/**
 * JBD 0xFA 参数寄存器读写层（构建在 jbd-bus 串行队列之上）
 *
 * 职责：把「构造帧 → sendAck 等待应答 → 解析数据区」的重复模式收敛为少量函数，
 * 统一超时（constants.FRAME_TIMEOUT_MS，替代散落各处的 1500 魔法数字）与
 * 应答校验（timeout / status / 命令码 / 长度），供参数配置页等复用。
 *
 * 应答配对：sendAck 按「命令码」匹配（0xFA 读/写共用命令码，靠 jbd-bus 的
 * 单条在途锁串行化保证不抢帧）。此前的 jbdBus.send + onceResponse 组合，
 * 应答监听与发送作业互相独立，存在跨作业抢帧的理论窗口；统一走 sendAck 后
 * 应答与作业一一绑定，语义更严格。
 */
import { jbdBus } from './jbd-bus'
import { buildReadParam, buildWriteParam, buildEnterFactory, buildExitFactory, CMD } from './jbd-protocol'
import { FRAME_TIMEOUT_MS } from '../constants'

/** 0xFA 读应答解析结果：起始寄存器 + 连续原始值（大端 16 位） */
export interface RegReadResult {
  reg: number
  count: number
  values: number[]
}

/** 解析 0xFA 读应答数据区：[regH, regL, count, v0H, v0L, ...]；非法返回 null */
export function parseRegRead(data: number[] | undefined | null): RegReadResult | null {
  if (!data || data.length < 5) return null
  const reg = (data[0] << 8) | data[1]
  const count = data[2]
  if (count < 1 || data.length < 3 + count * 2) return null
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    values.push(((data[3 + i * 2] << 8) | data[4 + i * 2]) & 0xffff)
  }
  return { reg, count, values }
}

/** 读 count 个连续寄存器；超时/异常返回 null */
export async function readRegs(reg: number, count = 1, timeoutMs = FRAME_TIMEOUT_MS): Promise<RegReadResult | null> {
  const resp = await jbdBus.sendAck(buildReadParam(reg, count), timeoutMs)
  if (!resp || resp.timeout || resp.status !== 0x00 || resp.cmd !== CMD.PARAM) return null
  return parseRegRead(resp.data)
}

/** 读单个寄存器的 16 位原始值；超时/异常返回 null */
export async function readRegRaw(reg: number, timeoutMs = FRAME_TIMEOUT_MS): Promise<number | null> {
  const r = await readRegs(reg, 1, timeoutMs)
  return r && r.reg === reg ? r.values[0] : null
}

/** 批量读：校验应答的起始寄存器/个数与请求一致，返回 reg→raw 映射；不一致/超时返回 null */
export async function readRegMap(reg: number, count: number, timeoutMs = FRAME_TIMEOUT_MS): Promise<Record<number, number> | null> {
  const r = await readRegs(reg, count, timeoutMs)
  if (!r || r.reg !== reg || r.count !== count) return null
  const map: Record<number, number> = {}
  r.values.forEach((v, i) => { map[reg + i] = v })
  return map
}

/** 写寄存器（bytes 为大端字节序列），等待 ACK；返回是否成功 */
export async function writeRegs(reg: number, bytes: number[], timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  const resp = await jbdBus.sendAck(buildWriteParam(reg, bytes), timeoutMs)
  return !!resp && !resp.timeout && resp.status === 0x00
}

/** 进入工厂模式（默认密码 0x5678）；返回是否成功 */
export async function enterFactory(timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  const resp = await jbdBus.sendAck(buildEnterFactory(), timeoutMs)
  return !!resp && !resp.timeout && resp.status === 0x00
}

/** 退出工厂模式；返回是否成功 */
export async function exitFactory(timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> {
  const resp = await jbdBus.sendAck(buildExitFactory(), timeoutMs)
  return !!resp && !resp.timeout && resp.status === 0x00
}

/** 寄存器集合 → 连续段分块（每段 ≤ chunkCap、段内地址连续）。
 *  批量读/批量校验共用：一次 0xFA 往返吃满连续寄存器，段间不跨非连续地址。 */
export function planReadChunks(regs: number[], chunkCap = 48): { start: number; count: number }[] {
  const sorted = [...regs].sort((a, b) => a - b)
  const chunks: { start: number; count: number }[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sorted[j] === sorted[j - 1] + 1) j++
    const runStart = sorted[i]
    const runLen = j - i
    for (let s = runStart; s < runStart + runLen; s += chunkCap) {
      chunks.push({ start: s, count: Math.min(chunkCap, runStart + runLen - s) })
    }
    i = j
  }
  return chunks
}

/** ASCII 块字节流（首字节=长度，其后为字符）→ 字符串。
 *  按 PDF V12：条形码/BMS 编码/厂商信息均以 ASCII 传送，第 1 字节为长度。
 *  UTF-8 解码（与下发侧 buildSetBtName 对齐），剔除控制字符。 */
export function decodeAsciiBytes(bytes: number[]): string {
  if (!bytes.length) return ''
  const len = bytes[0] & 0xff
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const body = len > 0 && len < bytes.length ? bytes.slice(1, 1 + len) : bytes.slice(1)
  return decoder.decode(new Uint8Array(body)).replace(/[\u0000-\u001F\u007F]/g, '').trim()
}
