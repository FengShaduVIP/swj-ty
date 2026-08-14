import { SerialPort, SerialPortOpenOptions } from 'serialport'

/** 由 SerialPort.list() 推导端口类型（含 vendorId/productId/friendlyName 等） */
type ListedPort = Awaited<ReturnType<typeof SerialPort.list>>[number]
import { EventEmitter } from 'events'

/** 自动连接配置：按 VID/PID（可选名称）匹配 USB 串口，自动建链 */
export interface AutoConnectConfig {
  enabled: boolean
  vendorId?: string
  productId?: string
  friendlyName?: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

export class SerialManager {
  private port: SerialPort | null = null
  private emitter = new EventEmitter()
  private isConnected = false
  private currentPortPath: string | null = null
  private currentBaudRate: number | null = null

  // ===== 自动连接守护状态 =====
  private autoConfig: AutoConnectConfig | null = null
  private autoTimer: ReturnType<typeof setInterval> | null = null
  /** 当前连接是否由自动连接建立（用于判定设备移除时是否应主动断开） */
  private autoManaged = false
  /** 正在尝试自动连接，避免轮询周期内重复触发 connect */
  private autoConnecting = false

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
      dataBits: (config.dataBits ?? 8) as 5 | 6 | 7 | 8,
      stopBits: (config.stopBits ?? 1) as 1 | 1.5 | 2,
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
          baudRate: config.baudRate,
          // 标记本次连接是否由自动连接守护建立（渲染层据此决定是否自动跳转监测页）
          auto: this.autoConnecting,
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
  onStatusChange(callback: (status: { connected: boolean; portPath?: string; baudRate?: number; auto?: boolean }) => void) {
    this.emitter.on('statusChange', callback)
  }

  // ===== 自动连接守护 =====
  /** 启用/停用自动连接。启用时立即扫描一次，并启动 1.5s 轮询；停用且当前为自动连接则断开 */
  setAutoConnect(enabled: boolean, config?: AutoConnectConfig) {
    if (enabled && config) {
      // 三项匹配条件全空时不启动轮询定时器（避免空转 1.5s 定时），仅保存配置
      const hasMatch = !!(config.vendorId || config.productId || config.friendlyName)
      this.autoConfig = config
      if (hasMatch) {
        if (!this.autoTimer) this.autoTimer = setInterval(() => void this.autoTick(), 1500)
        void this.autoTick()
      } else if (this.autoTimer) {
        clearInterval(this.autoTimer)
        this.autoTimer = null
      }
    } else {
      this.autoConfig = null
      if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null }
      if (this.autoManaged) { void this.disconnect(); this.autoManaged = false }
    }
  }

  /** 读取当前自动连接配置（供渲染进程初始化 UI） */
  getAutoConnect(): AutoConnectConfig | null {
    return this.autoConfig
  }

  /** 判断端口是否匹配自动连接目标 */
  private matches(port: ListedPort, cfg: AutoConnectConfig): boolean {
    if (cfg.vendorId && port.vendorId && port.vendorId.toLowerCase() !== cfg.vendorId.toLowerCase()) return false
    if (cfg.productId && port.productId && port.productId.toLowerCase() !== cfg.productId.toLowerCase()) return false
    if (cfg.friendlyName && port.friendlyName && !port.friendlyName.toLowerCase().includes(cfg.friendlyName.toLowerCase())) return false
    return true
  }

  /** 轮询扫描：发现目标设备则自动连接；目标消失且为自动连接则断开（支持插拔重连） */
  private async autoTick(): Promise<void> {
    if (!this.autoConfig || this.autoConnecting) return
    const cfg = this.autoConfig
    // 没有任何匹配条件时不盲目连接
    if (!cfg.vendorId && !cfg.productId && !cfg.friendlyName) return
    try {
      const ports = await SerialPort.list()
      const target = ports.find((p) => this.matches(p, cfg))
      if (target) {
        if (!this.isConnected) {
          this.autoConnecting = true
          try {
            await this.connect({
              path: target.path,
              baudRate: cfg.baudRate,
              dataBits: cfg.dataBits ?? 8,
              stopBits: cfg.stopBits ?? 1,
              parity: cfg.parity ?? 'none',
            })
            this.autoManaged = true
          } catch {
            // 连接失败（端口忙/权限/驱动问题），下个周期重试
          } finally {
            this.autoConnecting = false
          }
        }
      } else if (this.autoManaged && this.isConnected) {
        // 目标设备已移除，断开以便重新插入时重连
        this.autoManaged = false
        await this.disconnect()
      }
    } catch {
      // 枚举失败（如驱动异常）忽略，下个周期重试
    }
  }
}
