import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron'
import { join } from 'path'
import { SerialManager, type AutoConnectConfig } from './serial'
import { initAutoUpdater } from './updater'
import { isAuthSessionValid, loginBackend, type AuthSession } from '../src/auth/auth'
import { uploadDispatchRecord } from '../src/auth/dispatchUpload'
import { isDispatchUploadRecord } from '../src/dispatch/uploadDecision'

let mainWindow: BrowserWindow | null = null
let floatWindow: BrowserWindow | null = null
const serialManager = new SerialManager()
let authSession: AuthSession | null = null

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
      contextIsolation: true
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  // 主窗口关闭时浮窗一并关闭（保持"关窗即退出"的现有行为）
  mainWindow.on('closed', () => {
    mainWindow = null
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.close()
    }
  })
}

// 浮动窗口：置顶无边框小窗，加载同一 bundle 并以 #float hash 区分渲染浮窗组件；
// 数据由主进程把串口事件广播给所有窗口，浮窗纯被动解析显示，不参与轮询发送
function createFloatWindow() {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.show()
    floatWindow.focus()
    return
  }

  floatWindow = new BrowserWindow({
    width: 900,
    height: 168,
    minWidth: 840,
    minHeight: 140,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    fullscreenable: false,
    title: '天一BMS 浮窗',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    floatWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#float`)
  } else {
    floatWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: 'float' })
  }

  // 浮窗打开时补发最近一次模板名与蓝牙名称/BMS编码值（由主窗口推送并在此缓存）
  floatWindow.webContents.on('did-finish-load', () => {
    floatWindow!.webContents.send('float:template', floatTemplateName)
    floatWindow!.webContents.send('float:values', floatFieldValues)
  })

  floatWindow.on('closed', () => {
    floatWindow = null
  })
}

// 向所有窗口广播（主窗口最小化时浮窗仍需接收串口数据与状态）
function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

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
// 注意：这是业务确认口令而非安全边界——能访问 IPC 的代码仍可调用本句柄做穷举比对。
const DISPATCH_PWD = 'tyln@1688'
ipcMain.handle('bms:verifyDispatchPwd', (_event, candidate: unknown) => {
  return typeof candidate === 'string' && candidate === DISPATCH_PWD
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

// 2. 连接串口（任何窗口发起都算手动操作，解除自动连接的暂停标记）
ipcMain.handle('serial:connect', async (_event, config: {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
}) => {
  serialManager.clearManualOverride()
  await serialManager.connect(config)
  return { success: true }
})

// 3. 断开串口（任何窗口发起都算手动操作，暂停自动重连，避免断开后 1.5s 内被守护抢连）
ipcMain.handle('serial:disconnect', async () => {
  serialManager.setManualOverride()
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

// 8. 监听串口数据 - 广播到所有窗口（主窗口 + 浮窗各自独立解析）
serialManager.onData((data: Buffer) => {
  broadcast('serial:data', Array.from(data))
})

serialManager.onError((error: string) => {
  broadcast('serial:error', error)
})

serialManager.onStatusChange((status: { connected: boolean; portPath?: string }) => {
  broadcast('serial:statusChange', status)
})

// ======== 浮动窗口 IPC ========
ipcMain.handle('float:open', () => {
  createFloatWindow()
  return { success: true }
})

ipcMain.handle('float:close', () => {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.close()
  }
  return { success: true }
})

ipcMain.handle('float:showMain', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  return { success: true }
})

// 浮窗置顶开关
ipcMain.handle('float:setAlwaysOnTop', (_event, enabled: unknown) => {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.setAlwaysOnTop(typeof enabled === 'boolean' ? enabled : true)
  }
  return { success: true }
})

// 主窗口 → 浮窗：通讯日志逐条转发（浮窗日志与参数配置页同源同格式）
ipcMain.on('float:pushLog', (_event, entry: unknown) => {
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.webContents.send('float:log', entry)
  }
})

// 主窗口 → 浮窗：当前导入的模板名（主进程缓存一份，浮窗晚开也能补发）
let floatTemplateName = ''
ipcMain.on('float:pushTemplate', (_event, name: unknown) => {
  floatTemplateName = typeof name === 'string' ? name : ''
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.webContents.send('float:template', floatTemplateName)
  }
})

// 主窗口 → 浮窗：当前蓝牙名称/BMS编码值（读取设备或导入模板后推送，缓存 + 补发）
let floatFieldValues: { btName: string; bmsCode: string } = { btName: '', bmsCode: '' }
ipcMain.on('float:pushValues', (_event, v: unknown) => {
  const val = v as { btName?: unknown; bmsCode?: unknown } | null
  floatFieldValues = {
    btName: typeof val?.btName === 'string' ? val.btName : '',
    bmsCode: typeof val?.bmsCode === 'string' ? val.bmsCode : '',
  }
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.webContents.send('float:values', floatFieldValues)
  }
})

// 浮窗的连接/断开由浮窗直接调用 serial:connect / serial:disconnect（主进程串口管理器统一治理），
// 不再经主窗口中转；此处仅保留需要主窗口状态的强制下发请求。

// 浮窗 → 主窗口：强制下发请求。参数状态只存在于主窗口的参数配置页，
// 因此浮窗仅作遥控器：主进程唤醒主窗口后转发请求，由主窗弹出确认框并执行下发
ipcMain.handle('float:requestForceWrite', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('float:forceWrite')
    return { success: true }
  }
  return { success: false }
})

// 浮窗 → 主窗口：单参数下发（蓝牙名称/BMS编码，可携带浮窗输入框的值）与复位 MCU 请求。
// 字段写入、登录态校验与确认框都在主窗口，浮窗仅遥控：唤醒主窗口后转发动作与值
ipcMain.on('float:paramAction', (_event, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    const p = (payload ?? {}) as { action?: unknown; value?: unknown }
    mainWindow.webContents.send('float:paramAction', {
      action: typeof p.action === 'string' ? p.action : '',
      value: typeof p.value === 'string' ? p.value : undefined,
    })
  }
})

// ======== 屏幕级通知窗（右上角、置顶所有窗口、不自动关闭） ========
// DOM 通知（ElNotification）只能存在于某个窗口内部；此通知窗独立于主窗/浮窗，
// 固定在主屏工作区右上角，点击关闭按钮才消失，且创建/显示均不抢焦点。
let notifyWindow: BrowserWindow | null = null
let pendingNotify: { title: string; message: string; type: string } | null = null

const NOTIFY_W = 380
const NOTIFY_H = 104

function createNotifyWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  notifyWindow = new BrowserWindow({
    width: NOTIFY_W,
    height: NOTIFY_H,
    x: workArea.x + workArea.width - NOTIFY_W - 12,
    y: workArea.y + 12,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  // screen-saver 层级：盖过浮窗（floating）与其他应用窗口
  notifyWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.VITE_DEV_SERVER_URL) {
    notifyWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#notify`)
  } else {
    notifyWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: 'notify' })
  }

  notifyWindow.webContents.on('did-finish-load', () => {
    if (pendingNotify) notifyWindow!.webContents.send('notify:data', pendingNotify)
    notifyWindow!.showInactive()
  })
  notifyWindow.on('closed', () => {
    notifyWindow = null
  })
}

ipcMain.on('notify:show', (_event, raw: unknown) => {
  const p = (raw ?? {}) as { title?: unknown; message?: unknown; type?: unknown }
  pendingNotify = {
    title: typeof p.title === 'string' ? p.title : '通知',
    message: typeof p.message === 'string' ? p.message : '',
    type: p.type === 'warning' ? 'warning' : 'success',
  }
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    notifyWindow.webContents.send('notify:data', pendingNotify)
    notifyWindow.showInactive()
  } else {
    createNotifyWindow() // did-finish-load 后发送内容并显示
  }
})

ipcMain.on('notify:close', () => {
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    notifyWindow.close()
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
