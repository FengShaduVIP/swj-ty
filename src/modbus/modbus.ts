/**
 * Modbus RTU 协议封装
 * 支持功能码: 0x03 (读保持寄存器), 0x06 (写单寄存器), 0x10 (写多寄存器)
 */

// CRC16 查找表 (Modbus)
const CRC16_TABLE: number[] = [
  0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
  0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
  0xCC01, 0x0CC0, 0x0D80, 0xCD41, 0x0F00, 0xCFC1, 0xCE81, 0x0E40,
  0x0A00, 0xCAC1, 0xCB81, 0x0B40, 0xC901, 0x09C0, 0x0880, 0xC841,
  0xD801, 0x18C0, 0x1980, 0xD941, 0x1B00, 0xDBC1, 0xDA81, 0x1A40,
  0x1E00, 0xDEC1, 0xDF81, 0x1F40, 0xDD01, 0x1DC0, 0x1C80, 0xDC41,
  0x1400, 0xD4C1, 0xD581, 0x1540, 0xD701, 0x17C0, 0x1680, 0xD641,
  0xD201, 0x12C0, 0x1380, 0xD341, 0x1100, 0xD1C1, 0xD081, 0x1040,
  0xF001, 0x30C0, 0x3180, 0xF141, 0x3300, 0xF3C1, 0xF281, 0x3240,
  0x3600, 0xF6C1, 0xF781, 0x3740, 0xF501, 0x35C0, 0x3480, 0xF441,
  0x3C00, 0xFCC1, 0xFD81, 0x3D40, 0xFF01, 0x3FC0, 0x3E80, 0xFE41,
  0xFA01, 0x3AC0, 0x3B80, 0xFB41, 0x3900, 0xF9C1, 0xF881, 0x3840,
  0x2800, 0xE8C1, 0xE981, 0x2940, 0xEB01, 0x2BC0, 0x2A80, 0xEA41,
  0xEE01, 0x2EC0, 0x2F80, 0xEF41, 0x2D00, 0xEDC1, 0xEC81, 0x2C40,
  0xE401, 0x24C0, 0x2580, 0xE541, 0x2700, 0xE7C1, 0xE681, 0x2640,
  0x2200, 0xE2C1, 0xE381, 0x2340, 0xE101, 0x21C0, 0x2080, 0xE041,
  0xA001, 0x60C0, 0x6180, 0xA141, 0x6300, 0xA3C1, 0xA281, 0x6240,
  0x6600, 0xA6C1, 0xA781, 0x6740, 0xA501, 0x65C0, 0x6480, 0xA441,
  0x6C00, 0xACC1, 0xAD81, 0x6D40, 0xAF01, 0x6FC0, 0x6E80, 0xAE41,
  0xAA01, 0x6AC0, 0x6B80, 0xAB41, 0x6900, 0xA9C1, 0xA881, 0x6840,
  0x7800, 0xB8C1, 0xB981, 0x7940, 0xBB01, 0x7BC0, 0x7A80, 0xBA41,
  0xBE01, 0x7EC0, 0x7F80, 0xBF41, 0x7D00, 0xBDC1, 0xBC81, 0x7C40,
  0xB401, 0x74C0, 0x7580, 0xB541, 0x7700, 0xB7C1, 0xB681, 0x7640,
  0x7200, 0xB2C1, 0xB381, 0x7340, 0xB101, 0x71C0, 0x7080, 0xB041,
  0x5000, 0x90C1, 0x9181, 0x5140, 0x9301, 0x53C0, 0x5280, 0x9241,
  0x9601, 0x56C0, 0x5780, 0x9741, 0x5500, 0x95C1, 0x9481, 0x5440,
  0x9C01, 0x5CC0, 0x5D80, 0x9D41, 0x5F00, 0x9FC1, 0x9E81, 0x5E40,
  0x5A00, 0x9AC1, 0x9B81, 0x5B40, 0x9901, 0x59C0, 0x5880, 0x9841,
  0x8801, 0x48C0, 0x4980, 0x8941, 0x4B00, 0x8BC1, 0x8A81, 0x4A40,
  0x4E00, 0x8EC1, 0x8F81, 0x4F40, 0x8D01, 0x4DC0, 0x4C80, 0x8C41,
  0x4400, 0x84C1, 0x8581, 0x4540, 0x8701, 0x47C0, 0x4680, 0x8641,
  0x8201, 0x42C0, 0x4380, 0x8341, 0x4100, 0x81C1, 0x8081, 0x4040
]

/** 计算 CRC16 Modbus 校验值 */
export function crc16(data: Buffer): number {
  let crc = 0xFFFF
  for (let i = 0; i < data.length; i++) {
    const index = (crc ^ data[i]) & 0xFF
    crc = (crc >> 8) ^ CRC16_TABLE[index]
  }
  return crc
}

/** CRC16 校验结果写入 Buffer（低字节在前） */
export function crc16Buffer(data: Buffer): Buffer {
  const crc = crc16(data)
  const result = Buffer.alloc(data.length + 2)
  data.copy(result)
  result.writeUInt16LE(crc, data.length)
  return result
}

/** 验证 CRC16 */
export function validateCrc16(data: Buffer): boolean {
  if (data.length < 3) return false
  const payload = data.subarray(0, data.length - 2)
  const expectedCrc = data.readUInt16LE(data.length - 2)
  return crc16(payload) === expectedCrc
}

// ==================== Modbus 协议帧构建 ====================

export interface ModbusRequest {
  /** 从站地址 (1-247) */
  slaveId: number
  /** 功能码 */
  functionCode: number
  /** 数据部分 (不含从站地址和CRC) */
  data: Buffer
  /** 完整帧 (含CRC, 可发送) */
  raw: Buffer
}

/** 构建 Modbus RTU 请求帧 */
function buildFrame(slaveId: number, functionCode: number, data: Buffer): ModbusRequest {
  const header = Buffer.alloc(2)
  header.writeUInt8(slaveId, 0)
  header.writeUInt8(functionCode, 1)

  const payload = Buffer.concat([header, data])
  const raw = crc16Buffer(payload)

  const funcData = Buffer.concat([Buffer.from([functionCode]), data])

  return {
    slaveId,
    functionCode,
    data: funcData,
    raw
  }
}

// ==================== 功能码实现 ====================

/**
 * 功能码 0x01 - 读线圈状态
 * @param slaveId 从站地址
 * @param startAddress 起始地址
 * @param quantity 读取数量 (1-2000)
 */
export function readCoils(slaveId: number, startAddress: number, quantity: number): ModbusRequest {
  const data = Buffer.alloc(4)
  data.writeUInt16BE(startAddress, 0)
  data.writeUInt16BE(quantity, 2)
  return buildFrame(slaveId, 0x01, data)
}

/**
 * 功能码 0x03 - 读保持寄存器
 * @param slaveId 从站地址 (1-247)
 * @param startAddress 起始寄存器地址
 * @param quantity 读取寄存器数量 (1-125)
 */
export function readHoldingRegisters(slaveId: number, startAddress: number, quantity: number): ModbusRequest {
  if (quantity < 1 || quantity > 125) {
    throw new Error('寄存器数量超出范围 (1-125)')
  }

  const data = Buffer.alloc(4)
  data.writeUInt16BE(startAddress, 0)   // 起始地址
  data.writeUInt16BE(quantity, 2)        // 寄存器数量

  return buildFrame(slaveId, 0x03, data)
}

/**
 * 功能码 0x06 - 写单个寄存器
 * @param slaveId 从站地址
 * @param address 寄存器地址
 * @param value 写入值
 */
export function writeSingleRegister(slaveId: number, address: number, value: number): ModbusRequest {
  const data = Buffer.alloc(4)
  data.writeUInt16BE(address, 0)
  data.writeUInt16BE(value & 0xFFFF, 2)
  return buildFrame(slaveId, 0x06, data)
}

/**
 * 功能码 0x10 - 写多个寄存器
 * @param slaveId 从站地址
 * @param startAddress 起始寄存器地址
 * @param values 写入的值数组
 */
export function writeMultipleRegisters(slaveId: number, startAddress: number, values: number[]): ModbusRequest {
  const byteCount = values.length * 2
  const data = Buffer.alloc(5 + byteCount)

  data.writeUInt16BE(startAddress, 0)
  data.writeUInt16BE(values.length, 2)
  data.writeUInt8(byteCount, 4)

  values.forEach((val, i) => {
    data.writeUInt16BE(val & 0xFFFF, 5 + i * 2)
  })

  return buildFrame(slaveId, 0x10, data)
}

// ==================== 响应解析 ====================

export interface ModbusResponse {
  slaveId: number
  functionCode: number
  data: Buffer
  raw: Buffer
  valid: boolean
  error?: string
}

/**
 * 解析读保持寄存器响应 (0x03)
 */
export function parseReadHoldingRegistersResponse(raw: Buffer): ModbusResponse {
  if (raw.length < 5) {
    return { slaveId: 0, functionCode: 0, data: Buffer.alloc(0), raw, valid: false, error: '响应长度不足' }
  }

  const slaveId = raw[0]
  const functionCode = raw[1]

  // 检查错误响应 (功能码最高位置1)
  if (functionCode & 0x80) {
    const exceptionCode = raw[2]
    return {
      slaveId,
      functionCode: functionCode & 0x7F,
      data: Buffer.alloc(0),
      raw,
      valid: false,
      error: `异常响应: 异常码 0x${exceptionCode.toString(16).padStart(2, '0')}`
    }
  }

  if (!validateCrc16(raw)) {
    return { slaveId, functionCode, data: Buffer.alloc(0), raw, valid: false, error: 'CRC校验失败' }
  }

  const byteCount = raw[2]
  const data = raw.subarray(3, 3 + byteCount)

  // 将字节转换为寄存器值数组
  const registers: number[] = []
  for (let i = 0; i < data.length; i += 2) {
    registers.push(data.readUInt16BE(i))
  }

  return {
    slaveId,
    functionCode,
    data: Buffer.from(data),
    raw,
    valid: true
  }
}

/**
 * 解析写寄存器响应 (0x06 / 0x10)
 */
export function parseWriteRegisterResponse(raw: Buffer): ModbusResponse {
  if (raw.length < 5) {
    return { slaveId: 0, functionCode: 0, data: Buffer.alloc(0), raw, valid: false, error: '响应长度不足' }
  }

  const slaveId = raw[0]
  const functionCode = raw[1]

  if (functionCode & 0x80) {
    return {
      slaveId,
      functionCode: functionCode & 0x7F,
      data: Buffer.alloc(0),
      raw,
      valid: false,
      error: `异常响应: 异常码 0x${raw[2].toString(16)}`
    }
  }

  if (!validateCrc16(raw)) {
    return { slaveId, functionCode, data: Buffer.alloc(0), raw, valid: false, error: 'CRC校验失败' }
  }

  return { slaveId, functionCode, data: raw.subarray(2, raw.length - 2), raw, valid: true }
}

/**
 * 自动解析响应 (根据功能码)
 */
export function parseResponse(raw: Buffer): ModbusResponse {
  if (raw.length < 3) {
    return { slaveId: 0, functionCode: 0, data: Buffer.alloc(0), raw, valid: false, error: '响应长度不足' }
  }

  const functionCode = raw[1] & 0x7F
  switch (functionCode) {
    case 0x03:
    case 0x04:
      return parseReadHoldingRegistersResponse(raw)
    case 0x06:
    case 0x10:
      return parseWriteRegisterResponse(raw)
    default:
      return { slaveId: raw[0], functionCode, data: Buffer.alloc(0), raw, valid: false, error: `不支持的功能码: 0x${functionCode.toString(16)}` }
  }
}

/**
 * 将寄存器值数组转换为实际物理值
 * 支持: uint16, int16, uint32 (大端), float32 (大端)
 */
export function convertRegisterValues(registers: number[], format: 'uint16' | 'int16' | 'uint32' | 'float32'): number[] {
  const result: number[] = []

  switch (format) {
    case 'uint16':
      return registers.map(r => r & 0xFFFF)

    case 'int16':
      return registers.map(r => {
        const val = r & 0xFFFF
        return val > 0x7FFF ? val - 0x10000 : val
      })

    case 'uint32': {
      for (let i = 0; i < registers.length; i += 2) {
        if (i + 1 < registers.length) {
          const high = (registers[i] & 0xFFFF) >>> 0
          const low = (registers[i + 1] & 0xFFFF) >>> 0
          result.push(high * 0x10000 + low)
        }
      }
      break
    }

    case 'float32': {
      for (let i = 0; i < registers.length; i += 2) {
        if (i + 1 < registers.length) {
          const buf = Buffer.alloc(4)
          buf.writeUInt16BE(registers[i], 0)
          buf.writeUInt16BE(registers[i + 1], 2)
          result.push(Math.round(buf.readFloatBE(0) * 10000) / 10000)
        }
      }
      break
    }
  }

  return result
}

/**
 * 辅助: 打印 Modbus 帧 (调试用)
 */
export function frameToHex(frame: Buffer | number[]): string {
  const bytes = Buffer.isBuffer(frame) ? Array.from(frame) : frame
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

/**
 * 异常码说明
 */
export const EXCEPTION_CODES: Record<number, string> = {
  0x01: '非法功能码',
  0x02: '非法数据地址',
  0x03: '非法数据值',
  0x04: '从站设备故障',
  0x05: '确认',
  0x06: '从站设备忙',
  0x08: '存储奇偶性差错',
  0x0A: '网关路径不可用',
  0x0B: '网关目标设备响应失败'
}
