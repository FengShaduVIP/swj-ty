import { describe, it, expect } from 'vitest'
import {
  calcChecksum, buildRead, buildWrite, parseFrame, parseCellVoltages,
  parseHardwareVersion, parseBasicInfo, toSigned16, toHex, describeFrame,
  CMD,
} from '../jbd-protocol'

/** 构造一帧 BMS 风格的响应（0xDD | cmd | status | len | data | chkH chkL | 0x77） */
function buildResponse(cmd: number, status: number, data: number[], callbackId: number[] = []): number[] {
  const len = data.length & 0xff
  const [hi, lo] = calcChecksum([status, len, ...data])
  return [0xdd, cmd & 0xff, status & 0xff, len, ...data, hi, lo, 0x77, ...callbackId]
}

describe('calcChecksum', () => {
  it('补码校验和：字节数和 + 校验 = 0x10000', () => {
    const bytes = [0x03, 0x00]
    const [hi, lo] = calcChecksum(bytes)
    expect(((bytes[0] + bytes[1] + hi * 256 + lo) & 0xffff)).toBe(0)
    expect([hi, lo]).toEqual([0xff, 0xfd])
  })
})

describe('buildRead / buildWrite', () => {
  it('读基本信息帧字节与文档示例结构一致', () => {
    // DD A5 03 00 <chkH chkL> 77，chk = -(03+00) = FFFD
    expect(buildRead(CMD.BASIC_INFO)).toEqual([0xdd, 0xa5, 0x03, 0x00, 0xff, 0xfd, 0x77])
  })

  it('写标志为 0x5A', () => {
    const f = buildWrite(0xfb, [0x00, 0x01])
    expect(f[1]).toBe(0x5a)
    expect(f[2]).toBe(0xfb)
    expect(f[3]).toBe(2)
  })

  it('蓝牙名称帧与设备真值示例一致（V3--F82064）', () => {
    // 来自 jbd-protocol 注释中的真机验证帧：
    // DD 5A A2 0B 0A 56 33 2D 2D 46 38 32 30 36 34 FD 1C 77
    const nameBytes = Array.from(new TextEncoder().encode('V3--F82064'))
    const f = buildWrite(0xa2, [nameBytes.length, ...nameBytes])
    expect(f).toEqual([0xdd, 0x5a, 0xa2, 0x0b, 0x0a, 0x56, 0x33, 0x2d, 0x2d, 0x46, 0x38, 0x32, 0x30, 0x36, 0x34, 0xfd, 0x1c, 0x77])
  })
})

describe('parseFrame', () => {
  it('解析合法响应帧：校验通过、数据一致', () => {
    const data = [0x01, 0x02, 0x03]
    const f = parseFrame(buildResponse(0x03, 0x00, data))
    expect(f).not.toBeNull()
    expect(f!.valid).toBe(true)
    expect(f!.cmd).toBe(0x03)
    expect(f!.status).toBe(0x00)
    expect(f!.data).toEqual(data)
  })

  it('保留帧尾后的 CALLBACK_ID', () => {
    const f = parseFrame(buildResponse(0x03, 0x00, [0xaa], [0x12, 0x34]))
    expect(f!.valid).toBe(true)
    expect(f!.callbackId).toEqual([0x12, 0x34])
  })

  it('校验和不匹配 → valid=false', () => {
    const frame = buildResponse(0x03, 0x00, [0x01])
    frame[5] ^= 0xff // 破坏校验低字节
    const f = parseFrame(frame)
    expect(f!.valid).toBe(false)
  })

  it('无起始字节返回 null；长度不足返回 null', () => {
    expect(parseFrame([0x01, 0x02])).toBeNull()
    expect(parseFrame([0xdd, 0x03])).toBeNull()
  })
})

describe('toSigned16', () => {
  it('补码转换', () => {
    expect(toSigned16(0)).toBe(0)
    expect(toSigned16(0x7fff)).toBe(0x7fff)
    expect(toSigned16(0x8000)).toBe(-0x8000)
    expect(toSigned16(0xffff)).toBe(-1)
  })
})

describe('parseCellVoltages', () => {
  it('按大端 U16 逐对解出单体电压', () => {
    expect(parseCellVoltages([0x0f, 0x3d, 0x0f, 0x40])).toEqual([0x0f3d, 0x0f40])
    expect(parseCellVoltages([])).toEqual([])
  })
})

describe('parseHardwareVersion', () => {
  it('去掉前导 0x00 占位后按 ASCII 解码', () => {
    expect(parseHardwareVersion([0x00, 0x00, 0x56, 0x33])).toBe('V3')
    expect(parseHardwareVersion([0x48, 0x31])).toBe('H1')
  })
})

describe('parseBasicInfo', () => {
  it('完整解析基本信息（单位换算 / 日期位域 / FET 位 / NTC 温度）', () => {
    const dateRaw = (1) | (6 << 5) | (25 << 9) // 2025-06-01
    const data = [
      0x01, 0xa4,        // 总压 420 ×10mV = 4200mV
      0x00, 0x05,        // 电流 5 ×10mA = 50mA
      0x07, 0xd0,        // 剩余 2000 ×10 = 20000mAh
      0x07, 0xd0,        // 标称 2000 ×10 = 20000mAh
      0x00, 0x64,        // 循环 100
      (dateRaw >> 8) & 0xff, dateRaw & 0xff,
      0x00, 0x05,        // 均衡低 16 位 bit0/bit2
      0x00, 0x00,        // 均衡高
      0x00, 0x00,        // 保护状态
      0x21,              // 软件版本 2.1
      80,                // RSOC 80%
      0x03,              // FET：充电+放电开
      16,                // 电芯数
      2,                 // NTC 数
      0x0a, 0xcd,        // NTC1: 2765 → (2765-2731)/10 = 3.4℃
      0x0a, 0xf0,        // NTC2: 2800 → 6.9℃
    ]
    const bi = parseBasicInfo(data)
    expect(bi.totalVoltage_mV).toBe(4200)
    expect(bi.current_mA).toBe(50)
    expect(bi.remainingCapacity_mAh).toBe(20000)
    expect(bi.nominalCapacity_mAh).toBe(20000)
    expect(bi.cycleCount).toBe(100)
    expect(bi.manufactureDate).toEqual({ year: 2025, month: 6, day: 1 })
    expect(bi.balanceLow).toBe(0x05)
    expect(bi.swVersion).toBe('2.1')
    expect(bi.rsoc).toBe(80)
    expect(bi.fet.charge).toBe(true)
    expect(bi.fet.discharge).toBe(true)
    expect(bi.cellCount).toBe(16)
    expect(bi.ntcCount).toBe(2)
    expect(bi.temperatures_C[0]).toBeCloseTo(3.4, 5)
    expect(bi.temperatures_C[1]).toBeCloseTo(6.9, 5)
  })

  it('unit100 位（bit7）置位时容量/电流倍率由 ×10 改为 ×100', () => {
    const base = [
      0x00, 0x2a, 0x00, 0x05, 0x00, 0x64, 0x00, 0x64, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x80, 0x10, 0x00, 0x00, // fet bit7 = unit100
    ]
    const bi = parseBasicInfo(base)
    expect(bi.fet.unit100).toBe(true)
    expect(bi.current_mA).toBe(5 * 100)
    expect(bi.remainingCapacity_mAh).toBe(100 * 100)
  })
})

describe('toHex / describeFrame', () => {
  it('toHex 大写两位', () => {
    expect(toHex([0xdd, 0x5, 0x77])).toBe('DD 05 77')
  })

  it('describeFrame 识别常见指令', () => {
    expect(describeFrame(buildRead(CMD.BASIC_INFO))).toBe('读取基本信息')
    expect(describeFrame(buildRead(CMD.CELL_VOLTAGE))).toBe('读取单体电压')
    expect(describeFrame(buildWrite(0xa2, [0x01, 0x41]))).toBe('设置蓝牙名称')
  })

  it('describeFrame 对未知帧返回空串', () => {
    expect(describeFrame([0x01, 0x02])).toBe('')
  })
})
