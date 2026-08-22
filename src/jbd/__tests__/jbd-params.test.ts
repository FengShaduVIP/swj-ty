import { describe, it, expect } from 'vitest'
import {
  PARAM_TABLE, paramRawToDisplay, paramDisplayToRaw, paramFormat, paramDisplayDecimals,
  splitScd, combineScd, scdDelayMaxIndex, isChipScdKnown,
} from '../jbd-params'

describe('PARAM_TABLE', () => {
  it('索引唯一且有序', () => {
    const idx = PARAM_TABLE.map((p) => p.index)
    expect(new Set(idx).size).toBe(idx.length)
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1])
  })

  it('覆盖 0~55 单寄存器段', () => {
    for (let i = 0; i <= 55; i++) {
      expect(PARAM_TABLE.some((p) => p.index === i)).toBe(true)
    }
  })
})

describe('参数换算往返（display ↔ raw）', () => {
  it('标称容量（0.01Ah 步进）：30Ah ↔ raw 3000', () => {
    expect(paramDisplayToRaw(0, 30)).toBe(3000)
    expect(paramRawToDisplay(0, 3000)).toBe(30)
  })

  it('温度（0.1K 开尔文）：45℃ ↔ raw 3181', () => {
    expect(paramDisplayToRaw(8, 45)).toBe(3181)
    expect(paramRawToDisplay(8, 3181)).toBeCloseTo(45, 5)
  })

  it('温度 0℃ 与负温度', () => {
    expect(paramDisplayToRaw(8, 0)).toBe(2731)
    expect(paramDisplayToRaw(8, -20)).toBe(2531)
    expect(paramRawToDisplay(8, 2531)).toBeCloseTo(-20, 5)
  })

  it('检流电阻：1mΩ 走 0.1mR 单位，0.05mΩ 走 0.01mR 单位（bit15 置位）', () => {
    expect(paramDisplayToRaw(28, 1)).toBe(10)          // 1.0 mΩ → 10 × 0.1mR
    expect(paramRawToDisplay(28, 10)).toBeCloseTo(1, 5)
    expect(paramDisplayToRaw(28, 0.05)).toBe(0x8000 | 5) // 0.05 mΩ → bit15 + 5 × 0.01mR
    expect(paramRawToDisplay(28, 0x8005)).toBeCloseTo(0.05, 5)
  })

  it('有符号放电过流（×10mA）：-100A ↔ 0xFFF6', () => {
    expect(paramDisplayToRaw(25, -100)).toBe(0xfff6)
    expect(paramRawToDisplay(25, 0xfff6)).toBe(-100)
  })

  it('未知寄存器：原值直通', () => {
    expect(paramRawToDisplay(9999, 1234)).toBe(1234)
    expect(paramDisplayToRaw(9999, 1234)).toBe(1234)
  })
})

describe('paramFormat / paramDisplayDecimals', () => {
  it('日期寄存器按位域展开', () => {
    const raw = 1 | (6 << 5) | (25 << 9) // 2025-06-01
    expect(paramFormat(5, raw)).toBe('2025-6-1')
  })

  it('bitmap/raw 显示为 4 位十六进制', () => {
    expect(paramFormat(29, 0x00a5)).toBe('0x00A5')
  })

  it('小数位数与 scale 匹配', () => {
    expect(paramDisplayDecimals(0)).toBe(2)   // 0.01
    expect(paramDisplayDecimals(8)).toBe(1)   // temp
    expect(paramDisplayDecimals(28)).toBe(2)  // shunt
    expect(paramDisplayDecimals(20)).toBe(0)  // mV 整数
  })
})

describe('scd 复合保护（二级过流/短路）', () => {
  it('splitScd / combineScd 往返：level 高半字节、delay 低半字节', () => {
    expect(combineScd(0x0a, 0x05)).toBe(0x0a5)
    expect(splitScd(0x0a5)).toEqual({ level: 0x0a, delay: 0x05 })
    expect(splitScd(0x1234)).toEqual({ level: 3, delay: 4 }) // 仅低字节有效
  })

  it('集澈(5) 短路延时有效档上界为 3、二级过流延时上界为 7', () => {
    expect(scdDelayMaxIndex(5, 'scd')).toBe(3)
    expect(scdDelayMaxIndex(5, 'ocd')).toBe(7)
  })

  it('isChipScdKnown：null/未知为 false，TI(0) 与 1~6 为 true', () => {
    expect(isChipScdKnown(null)).toBe(false)
    expect(isChipScdKnown(undefined as unknown as null)).toBe(false)
    expect(isChipScdKnown(0)).toBe(true)
    for (const c of [1, 2, 3, 4, 5, 6]) expect(isChipScdKnown(c)).toBe(true)
    expect(isChipScdKnown(99)).toBe(false)
  })
})
