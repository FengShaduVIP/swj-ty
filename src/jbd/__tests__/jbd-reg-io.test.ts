import { describe, it, expect } from 'vitest'
import { parseRegRead, planReadChunks, decodeAsciiBytes } from '../jbd-reg-io'

describe('parseRegRead', () => {
  it('解析 [regH, regL, count, v0H, v0L, ...] 数据区', () => {
    const data = [0x00, 0x00, 0x02, 0x0b, 0xb8, 0x0b, 0xb8]
    expect(parseRegRead(data)).toEqual({ reg: 0, count: 2, values: [3000, 3000] })
  })

  it('高位起始寄存器（如 88 = 0x0058）', () => {
    const data = [0x00, 0x58, 0x01, 0x0a, 0x0a]
    expect(parseRegRead(data)).toEqual({ reg: 88, count: 1, values: [0x0a0a] })
  })

  it('数据不足 / count=0 / 空输入返回 null', () => {
    expect(parseRegRead([])).toBeNull()
    expect(parseRegRead(undefined)).toBeNull()
    expect(parseRegRead([0, 0, 0, 1])).toBeNull()      // count=0
    expect(parseRegRead([0, 0, 2, 0x0b, 0xb8])).toBeNull() // 长度不足
  })
})

describe('planReadChunks', () => {
  it('连续段合并、段间分离', () => {
    expect(planReadChunks([0, 1, 2, 3, 4, 5, 40, 41], 48))
      .toEqual([{ start: 0, count: 6 }, { start: 40, count: 2 }])
  })

  it('乱序输入先排序；超长段按 chunkCap 切分', () => {
    expect(planReadChunks([41, 40, 0], 48)).toEqual([{ start: 0, count: 1 }, { start: 40, count: 2 }])
    const regs = Array.from({ length: 5 }, (_, i) => 100 + i)
    expect(planReadChunks(regs, 2)).toEqual([
      { start: 100, count: 2 }, { start: 102, count: 2 }, { start: 104, count: 1 },
    ])
  })

  it('空输入返回空', () => {
    expect(planReadChunks([])).toEqual([])
  })
})

describe('decodeAsciiBytes', () => {
  it('首字节长度 + ASCII 字符', () => {
    // "AB" → [len=2, 'A', 'B', 0x00 填充]
    expect(decodeAsciiBytes([2, 0x41, 0x42, 0x00])).toBe('AB')
  })

  it('长度字节为 0：后续全量解码', () => {
    expect(decodeAsciiBytes([0, 0x41, 0x42])).toBe('AB')
  })

  it('控制字符被剔除', () => {
    expect(decodeAsciiBytes([2, 0x41, 0x01])).toBe('A')
  })

  it('空输入返回空串', () => {
    expect(decodeAsciiBytes([])).toBe('')
  })
})
