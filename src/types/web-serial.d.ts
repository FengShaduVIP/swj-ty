/**
 * Web Serial API 类型声明（照搬 SWJ 项目的最小可用子集）。
 *
 * TypeScript 5.9 的 lib.dom.d.ts 仍未内置 Serial / SerialPort，
 * 故在项目内声明。注意：本项目的 env.d.ts 已有同名的 `SerialPortInfo`
 * （IPC 串口列表用，含必填 path），为避免 interface 合并后 `getInfo()`
 * 返回值类型不满足该必填字段，这里改用内联对象类型描述端口信息。
 */

export {}

declare global {
  interface SerialOptions {
    baudRate: number
    dataBits?: number
    stopBits?: number
    parity?: 'none' | 'even' | 'odd'
    /** 仅 Chromium 支持，用于设置读缓冲大小 */
    bufferSize?: number
    flowControl?: 'none' | 'hardware'
  }

  interface SerialPort extends EventTarget {
    readonly readable: ReadableStream<Uint8Array> | null
    readonly writable: WritableStream<Uint8Array> | null
    open(options: SerialOptions): Promise<void>
    close(): Promise<void>
    forget(): Promise<void>
    getInfo(): { usbVendorId?: number; usbProductId?: number }
  }

  interface SerialPortFilter {
    usbVendorId?: number
    usbProductId?: number
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[]
  }

  interface Serial extends EventTarget {
    getPorts(): Promise<SerialPort[]>
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
  }

  interface Navigator {
    readonly serial: Serial
  }

  interface WorkerNavigator {
    readonly serial: Serial
  }
}
