/**
 * 自动更新核心模块（主进程）
 * ----------------------------------------------------------------------------
 * 方案：electron-updater（官方 github provider）
 *
 * 更新源     ：GitHub Releases —— github.com/FengShaduVIP/swj-ty
 *              （与现有 CI 流程一致：打 tag 触发软硬发布，electron-builder
 *               会自动产出 latest.yml / *.blockmap，electron-updater 据此比对）
 * 触发方式   ：仅用户点击「检查更新」时手动检查，不做启动检查与后台轮询
 * 检查频率   ：checkOnStartup = false / checkIntervalMs = 0（不轮询）
 * 更新策略   ：手动检查 → 发现新版本弹「确认更新 / 稍后」→ 用户确认后才下载
 *              → 下载完成弹「立即重启更新」，由用户决定何时重启（退出不自动安装）
 * 安全/回滚  ：下载写入临时目录，运行中的安装包完全不被触碰；
 *              仅 quitAndInstall() 才替换。下载/网络失败则原版本完好，
 *              前端展示错误并提供「重试」。NSIS 安装失败亦保留旧版本。
 * 优雅降级   ：开发模式（app.isPackaged === false）自动跳过，仅告知前端，
 *              避免控制台报错；网络异常不影响任何核心业务。
 * ----------------------------------------------------------------------------
 */
import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo, ProgressInfo } from 'electron-updater'

// ======== 更新配置（单一来源，便于调参）========
export const UPDATER_CONFIG = {
  /** 更新源 provider：github | generic | s3 | ... 本项目用 GitHub Releases */
  provider: 'github' as const,
  owner: 'FengShaduVIP',
  repo: 'swj-ty',
  /**
   * 私有仓库或受限下载时设置令牌（公开仓库留空即可）。
   * 通过环境变量注入，避免把令牌写进代码仓库：
   *   GH_UPDATE_TOKEN=ghp_xxx pnpm electron:build:win
   */
  token: process.env.GH_UPDATE_TOKEN || '',
  /** 启动后是否立即检查一次（手动确认策略：不做启动自动检查） */
  checkOnStartup: false,
  /** 启动检查延迟（ms）—— 让位给启动关键资源，避免抢占 */
  startupDelayMs: 5_000,
  /** 轮询间隔（ms）—— 0 表示不轮询，仅手动检查 */
  checkIntervalMs: 0,
  /** 发现新版本是否后台自动下载（手动确认策略：由用户点「确认更新」触发 downloadUpdate） */
  autoDownload: false,
  /** 应用退出时是否自动应用已下载的更新（手动确认策略：仅用户点「立即重启更新」才安装） */
  autoInstallOnAppQuit: false,
}

// ======== 状态类型（与主进程/渲染层共享语义）========
type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev-disabled'

interface UpdaterProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface UpdaterStatus {
  state: UpdaterState
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
  progress?: UpdaterProgress
  error?: string
  checkedAt?: number
  /** 更新源描述，如 github:FengShaduVIP/swj-ty */
  source?: string
}

interface UpdaterConfig {
  enabled: boolean
  source: string
  checkOnStartup: boolean
  checkIntervalMs: number
  autoDownload: boolean
  currentVersion: string
}

// ======== 工具：语义化版本比较 ========
// 返回 >0 表示 a 比 b 新，<0 表示 a 比 b 旧，0 表示相同（忽略预发布后缀）
export function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/i, '').split('-')[0]
  const pa = clean(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = clean(b).split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da - db
  }
  return 0
}

function releaseNotesToString(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes.trim() || undefined
  if (Array.isArray(notes)) {
    return notes.map((n) => n.note?.trim() || '').filter(Boolean).join('\n\n') || undefined
  }
  return undefined
}

// ======== 模块级运行时状态 ========
/** 当前已发现的待更新信息，用于在各事件间保留 version / notes */
let activeUpdate: { version: string; releaseNotes?: string } | null = null
let lastEmittedState: UpdaterState = 'idle'
let startupTimer: ReturnType<typeof setTimeout> | null = null
let pollingTimer: ReturnType<typeof setInterval> | null = null
/** 防止并发检查（autoUpdater 不支持同时多次 checkForUpdates） */
let checking = false

function sourceLabel(): string {
  return `${UPDATER_CONFIG.provider}:${UPDATER_CONFIG.owner}/${UPDATER_CONFIG.repo}`
}

/** 向所有窗口广播更新状态（渲染层据此驱动提示 UI） */
function emit(partial: Partial<UpdaterStatus> & { state: UpdaterState }): void {
  // 已下载待重启时，忽略后续轮询带来的 checking/available，避免覆盖重启提示
  if (
    (partial.state === 'checking' || partial.state === 'available') &&
    lastEmittedState === 'downloaded'
  ) {
    return
  }
  const payload: UpdaterStatus = {
    currentVersion: app.getVersion(),
    source: sourceLabel(),
    // 默认携带当前待更新信息，除非本次事件显式覆盖
    ...(activeUpdate ? { latestVersion: activeUpdate.version, releaseNotes: activeUpdate.releaseNotes } : {}),
    ...partial,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', payload)
  }
  lastEmittedState = partial.state
}

function safeCheck(): void {
  if (checking) return
  checking = true
  // checkForUpdates 失败由 'error' 事件统一处理，这里不再重复拒绝
  autoUpdater
    .checkForUpdates()
    .catch(() => { /* noop */ })
    .finally(() => { checking = false })
}

function buildConfig(): UpdaterConfig {
  return {
    enabled: app.isPackaged,
    source: sourceLabel(),
    checkOnStartup: UPDATER_CONFIG.checkOnStartup,
    checkIntervalMs: UPDATER_CONFIG.checkIntervalMs,
    autoDownload: UPDATER_CONFIG.autoDownload,
    currentVersion: app.getVersion(),
  }
}

/** 主进程入口：在 app.whenReady() 中调用一次 */
export function initAutoUpdater(): void {
  // ---- 开发模式：跳过更新服务器，仅告知前端 ----
  if (!app.isPackaged) {
    emit({ state: 'dev-disabled' })
    ipcMain.handle('updater:getConfig', () => buildConfig())
    ipcMain.handle('updater:checkNow', async () => ({
      ok: false,
      state: 'dev-disabled',
      error: '开发模式不检查更新',
    }))
    ipcMain.handle('updater:quitAndInstall', async () => ({ ok: false }))
    return
  }

  // ---- 生产模式：配置 electron-updater ----
  autoUpdater.autoDownload = UPDATER_CONFIG.autoDownload
  autoUpdater.autoInstallOnAppQuit = UPDATER_CONFIG.autoInstallOnAppQuit
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  // 显式设置更新源（覆盖 package.json repository / appId 推断）
  autoUpdater.setFeedURL({
    provider: UPDATER_CONFIG.provider,
    owner: UPDATER_CONFIG.owner,
    repo: UPDATER_CONFIG.repo,
    ...(UPDATER_CONFIG.token ? { token: UPDATER_CONFIG.token } : {}),
  } as any)

  // ---- 事件绑定 ----
  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking', checkedAt: Date.now() })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    activeUpdate = { version: info.version, releaseNotes: releaseNotesToString(info.releaseNotes) }
    emit({ state: 'available', checkedAt: Date.now() })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    activeUpdate = null
    emit({ state: 'not-available', latestVersion: info.version, checkedAt: Date.now() })
  })

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    emit({
      state: 'downloading',
      progress: {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    activeUpdate = { version: info.version, releaseNotes: releaseNotesToString(info.releaseNotes) }
    emit({ state: 'downloaded', checkedAt: Date.now() })
  })

  autoUpdater.on('error', (err: Error) => {
    // 下载/网络失败不影响已安装应用：仅提示并保留重试能力（回滚=无变更）
    emit({ state: 'error', error: err?.message || String(err), checkedAt: Date.now() })
  })

  // ---- IPC：渲染层交互 ----
  ipcMain.handle('updater:getConfig', () => buildConfig())

  ipcMain.handle('updater:checkNow', async () => {
    if (checking) return { ok: true, state: lastEmittedState }
    checking = true
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true, state: lastEmittedState }
    } catch (e: any) {
      return { ok: false, state: 'error', error: e?.message || String(e) }
    } finally {
      checking = false
    }
  })

  ipcMain.handle('updater:quitAndInstall', async () => {
    try {
      // 应用已下载的更新并重启；isForceRunAfter=true 确保更新后自动重新打开
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /** 用户点「确认更新」后开始下载（autoDownload=false，不做后台自动下载） */
  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // ---- 调度：启动延迟检查 + 周期轮询 ----
  if (UPDATER_CONFIG.checkOnStartup) {
    startupTimer = setTimeout(() => safeCheck(), UPDATER_CONFIG.startupDelayMs)
  }
  if (UPDATER_CONFIG.checkIntervalMs > 0) {
    pollingTimer = setInterval(() => safeCheck(), UPDATER_CONFIG.checkIntervalMs)
  }
}
