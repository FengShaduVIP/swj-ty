import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { EventEmitter } from 'events'

export class SerialManager {
  private port: SerialPort | null = null
  private emitter = new EventEmitter()
  private isConnected = false
  private currentPortPath: string | null = null
  private currentBaudRate: number | null = null

  /** 列出所有可用串口 */
  async listPorts() {
    try {
      return await SerialPort.list()
    } catch (error) {
      throw new Error(`获取串口列表失败: ${(error as Error).message}`)
    }
  }

  /** 连接串口 */
  async connect(config: {
    path: string
    baudRate: number
    dataBits?: 5 | 6 | 7 | 8
    stopBits?: 1 | 1.5 | 2
    parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
  }) {
    // 先断开已有连接
    await this.disconnect()

    const options: SerialPortOpenOptions<any> = {
      path: config.path,
      baudRate: config.baudRate,
      dataBits: (config.dataBits ?? 8) as 8,
      stopBits: (config.stopBits ?? 1) as 1,
      parity: config.parity ?? 'none',
      autoOpen: false
    }

    return new Promise<void>((resolve, reject) => {
      this.port = new SerialPort(options)

      this.port.open((err) => {
        if (err) {
          this.port = null
          this.emitter.emit('error', `串口打开失败: ${err.message}`)
          reject(err)
          return
        }

        this.isConnected = true
        this.currentPortPath = config.path
        this.currentBaudRate = config.baudRate

        // 设置数据接收监听
        this.port!.on('data', (data: Buffer) => {
          this.emitter.emit('data', data)
        })

        this.port!.on('error', (err) => {
          this.emitter.emit('error', `串口错误: ${err.message}`)
        })

        this.port!.on('close', () => {
          this.isConnected = false
          this.emitter.emit('statusChange', { connected: false })
        })

        this.emitter.emit('statusChange', {
          connected: true,
          portPath: config.path,
          baudRate: config.baudRate
        })

        resolve()
      })
    })
  }

  /** 断开串口 */
  async disconnect(): Promise<void> {
    if (!this.port || !this.isConnected) return

    return new Promise((resolve) => {
      this.port!.close((err) => {
        if (err) {
          this.emitter.emit('error', `串口关闭失败: ${err.message}`)
        }
        this.port = null
        this.isConnected = false
        this.currentPortPath = null
        this.currentBaudRate = null
        this.emitter.emit('statusChange', { connected: false })
        resolve()
      })
    })
  }

  /** 发送数据 */
  async send(data: Buffer | number[]): Promise<void> {
    if (!this.port || !this.isConnected) {
      throw new Error('串口未连接')
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)

    return new Promise((resolve, reject) => {
      this.port!.write(buffer, (err) => {
        if (err) {
          reject(err)
        } else {
          this.port!.drain((drainErr) => {
            if (drainErr) reject(drainErr)
            else resolve()
          })
        }
      })
    })
  }

  /** 获取当前连接状态 */
  getStatus() {
    return {
      connected: this.isConnected,
      portPath: this.currentPortPath,
      baudRate: this.currentBaudRate
    }
  }

  /** 数据回调 */
  onData(callback: (data: Buffer) => void) {
    this.emitter.on('data', callback)
  }

  /** 错误回调 */
  onError(callback: (error: string) => void) {
    this.emitter.on('error', callback)
  }

  /** 状态变化回调 */
  onStatusChange(callback: (status: { connected: boolean; portPath?: string }) => void) {
    this.emitter.on('statusChange', callback)
  }
}
