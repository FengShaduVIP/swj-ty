import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron'
import { join } from 'path'
import { SerialManager, type AutoConnectConfig } from './serial'
import { initAutoUpdater } from './updater'
import { isAuthSessionValid, loginBackend, type AuthSession } from '../src/auth/auth'
import { LOG_MAX_LINES } from '../src/constants'
import { uploadDispatchRecord } from '../src/auth/dispatchUpload'
import { isDispatchUploadRecord } from '../src/dispatch/uploadDecision'

let mainWindow: BrowserWindow | null = null
const serialManager = new SerialManager()
let authSession: AuthSession | null = null

// UI 自动化走查入口：dev 模式设置 CDP_DEBUG_PORT=9222 时开放远程调试端口
// （生产不设置该环境变量，无任何行为变化）
if (process.env.CDP_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CDP_DEBUG_PORT)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '天一BMS',
    // 无边框窗口：标题栏由渲染层自绘（design/preview.html 基准），窗口控制走 win:* IPC
    frame: false,
    backgroundColor: '#eef0f4',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 最大化状态变化广播给渲染层（自绘标题栏的最大化/还原图标切换）
  const sendMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)
  // 主窗口关闭时连带关闭日志窗口（否则无数据源的日志窗会让应用无法退出）
  mainWindow.on('closed', () => {
    if (logWindow && !logWindow.isDestroyed()) logWindow.close()
    mainWindow = null
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// ======== 无边框窗口控制 IPC（最小化 / 最大化还原 / 关闭）========
ipcMain.handle('win:minimize', () => {
  mainWindow?.minimize()
  return { ok: true }
})
ipcMain.handle('win:toggleMaximize', () => {
  if (!mainWindow) return { ok: false }
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return { ok: true }
})
ipcMain.handle('win:close', () => {
  mainWindow?.close()
  return { ok: true }
})

// ======== 串口 IPC 通信 ========

// ======== 后台登录 IPC（token 只保存在主进程内存，应用重启后需重新登录）========
ipcMain.handle('auth:login', async (_event, credentials: { username?: unknown; password?: unknown }) => {
  const { username, password } = credentials || {}
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return { ok: false as const, error: '请输入用户名和密码' }
  }

  try {
    const session = await loginBackend(username, password)
    authSession = session
    return {
      ok: true as const,
      userId: session.userId,
      username: session.username,
      expiresTime: session.expiresTime,
    }
  } catch (error) {
    authSession = null
    return { ok: false as const, error: error instanceof Error ? error.message : '登录失败' }
  }
})

ipcMain.handle('auth:status', () => {
  const session = authSession
  if (!isAuthSessionValid(session)) {
    authSession = null
    return { loggedIn: false as const }
  }
  return {
    loggedIn: true as const,
    userId: session.userId,
    username: session.username,
    expiresTime: session.expiresTime,
  }
})

ipcMain.handle('auth:logout', () => {
  authSession = null
  return { ok: true as const }
})

// ======== 强制下发确认密码 ========
// 密码常量只存于主进程，渲染层 bundle 不落明文（devtools 源码/产物中不可见）。
// 注意：这是业务确认口令而非安全边界——能访问 IPC 的代码仍可调用本句柄做穷举比对，
// 故加简单限流：连续错 5 次锁定 30s。
const DISPATCH_PWD = 'tyln@1688'
let pwdFails = 0
let pwdLockUntil = 0
ipcMain.handle('bms:verifyDispatchPwd', (_event, candidate: unknown) => {
  if (Date.now() < pwdLockUntil) return false
  const ok = typeof candidate === 'string' && candidate === DISPATCH_PWD
  if (ok) {
    pwdFails = 0
  } else if (++pwdFails >= 5) {
    pwdLockUntil = Date.now() + 30_000
    pwdFails = 0
  }
  return ok
})

// ======== 参数下发记录上传 IPC（accessToken 保持在主进程，渲染进程只传业务数据）========
ipcMain.handle('dispatch:upload', async (_event, record: unknown) => {
  const session = authSession
  if (!isAuthSessionValid(session)) {
    authSession = null
    return { ok: false as const, error: '后台登录已过期，请重新登录后再上传下发记录' }
  }
  if (!isDispatchUploadRecord(record)) {
    return { ok: false as const, error: '下发记录数据格式错误' }
  }

  try {
    await uploadDispatchRecord(record, session.accessToken)
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : '上传下发记录失败' }
  }
})

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

// 9. 在系统默认浏览器中打开外部链接（如 Gitee 手动下载页）
//    仅放行 http/https，避免渲染层传入任意协议造成安全风险
ipcMain.handle('app:openExternal', async (_event, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url)
    return { ok: true as const }
  }
  return { ok: false as const, error: '仅支持 http/https 链接' }
})

// ======== 通讯日志独立窗口（贴主窗口右侧外侧，纯被动显示，内容经主窗中转）========
let logWindow: BrowserWindow | null = null

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show()
    logWindow.focus()
    return
  }
  // 默认停靠主窗口右侧外侧，留 8px 缝；按最近显示屏工作区夹回可见范围
  const main = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  const width = 460
  const height = main ? main.height : 720
  let x = main ? main.x + main.width + 8 : 120
  let y = main ? main.y : 100
  const { workArea } = screen.getDisplayNearestPoint({ x, y })
  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width)
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)

  logWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    title: '通讯日志',
    minWidth: 320,
    minHeight: 200,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  logWindow.setMenuBarVisibility(false)
  logWindow.on('closed', () => { logWindow = null })

  const loaded = process.env.VITE_DEV_SERVER_URL
    ? logWindow.loadURL(process.env.VITE_DEV_SERVER_URL.replace(/\/+$/, '') + '/log.html')
    : logWindow.loadFile(join(__dirname, '../dist/log.html'))
  // 载入完成后：日志窗口下发容量常量（单一来源 src/constants），主窗口回填历史日志
  loaded.then(() => {
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.webContents.send('log:cfg', { maxLines: LOG_MAX_LINES })
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:ready')
    }
  }).catch(() => { /* 窗口被快速关闭等场景，忽略 */ })
}

ipcMain.handle('log:open', () => {
  createLogWindow()
  return { ok: true }
})

// 主窗口 → 日志窗口：追加条目（批量）
ipcMain.on('log:push', (_event, lines: unknown) => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log:append', lines)
  }
})

// 日志窗口 → 清空请求中转：主窗口清 dataLogs，日志窗口自身也清 DOM
ipcMain.on('log:clear-request', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log:clear')
  }
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log:clear')
  }
})

// 主窗口 → 日志窗口：主题切换跟随（dark = true 深色）
ipcMain.on('log:theme', (_event, dark: unknown) => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log:theme', dark === true)
  }
})

// ======== App 生命周期 ========

app.whenReady().then(() => {
  // 去掉默认菜单栏（File/Edit/View 等），仅保留应用界面自身
  Menu.setApplicationMenu(null)
  createWindow()
  // 启动自动更新（仅打包后生效；开发模式自动跳过，不阻断串口业务）
  initAutoUpdater()

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
