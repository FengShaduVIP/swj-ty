import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { SerialManager, type AutoConnectConfig } from './serial'

let mainWindow: BrowserWindow | null = null
const serialManager = new SerialManager()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '天一BMS',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 渲染进程沙箱（Electron 20+ 默认开启，此处显式声明意图）：
      // preload 仅使用 contextBridge/ipcRenderer 白名单 API，沙箱不影响功能
      sandbox: true
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// ======== 串口 IPC 通信 ========

// 1. 获取可用串口列表
ipcMain.handle('serial:list', async () => {
  return await serialManager.listPorts()
})

// 2. 连接串口
ipcMain.handle('serial:connect', async (_event, config: {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}) => {
  await serialManager.connect(config)
  return { success: true }
})

// 3. 断开串口
ipcMain.handle('serial:disconnect', async () => {
  await serialManager.disconnect()
  return { success: true }
})

// 4. 发送原始数据
ipcMain.handle('serial:send', async (_event, data: Buffer | number[]) => {
  await serialManager.send(data)
  return { success: true }
})

// 5. 获取连接状态
ipcMain.handle('serial:status', () => {
  return serialManager.getStatus()
})

// 6. 设置/取消自动连接（按 VID/PID 匹配 USB 串口，启动即连 + 插拔重连）
ipcMain.handle('serial:setAutoConnect',
  (_event, enabled: boolean, config?: AutoConnectConfig) => {
    serialManager.setAutoConnect(enabled, config)
    return { success: true }
  })

// 7. 读取当前自动连接配置
ipcMain.handle('serial:getAutoConnect', () => {
  return serialManager.getAutoConnect()
})

// 8. 监听串口数据 - 转发到渲染进程
serialManager.onData((data: Buffer) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serial:data', Array.from(data))
  }
})

// ======== 配置类 IPC ========
// 强制下发密码校验：密码只存在于主进程，不进渲染层 bundle
//（此前硬编码在 JbdParamConfig.vue，解包 asar 即可看到明文）
const DISPATCH_VERIFY_PWD = 'tyln@1688'
ipcMain.handle('config:verifyDispatchPwd', (_event, pwd: unknown) => {
  return typeof pwd === 'string' && pwd === DISPATCH_VERIFY_PWD
})

serialManager.onError((error: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serial:error', error)
  }
})

serialManager.onStatusChange((status: { connected: boolean; portPath?: string }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serial:statusChange', status)
  }
})

// ======== App 生命周期 ========

app.whenReady().then(() => {
  // 去掉默认菜单栏（File/Edit/View 等），仅保留应用界面自身
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  serialManager.disconnect()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
