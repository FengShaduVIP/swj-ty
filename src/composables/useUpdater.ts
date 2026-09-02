/**
 * useUpdater —— 更新状态共享组合式（渲染层单例）
 * ----------------------------------------------------------------------------
 * 订阅主进程广播的 updater:status，向组件暴露统一的状态与操作方法。
 * 模块级 ref 保证 App.vue 与 UpdateNotifier.vue 共享同一份状态。
 */
import { ref } from 'vue'

const status = ref<UpdaterStatus>({
  state: 'idle',
  currentVersion: '',
})

const config = ref<UpdaterConfig | null>(null)

let bound = false
/** 手动检查的时间戳，用于区分「启动轮询无更新」与「用户主动检查无更新」 */
let manualCheckAt = 0

function bind() {
  if (bound || typeof window === 'undefined' || !window.updaterAPI) return
  bound = true
  window.updaterAPI.onStatus((s: UpdaterStatus) => {
    status.value = s
  })
  window.updaterAPI.getConfig()
    .then((c: UpdaterConfig) => { config.value = c })
    .catch(() => { /* 配置读取失败不影响提示 */ })
}

export function useUpdater() {
  bind()

  async function checkNow() {
    manualCheckAt = Date.now()
    try {
      return await window.updaterAPI?.checkNow()
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }

  /** 用户确认后开始下载更新（手动确认策略下的唯一下载入口） */
  function download() {
    return window.updaterAPI?.download()
  }

  function quitAndInstall() {
    return window.updaterAPI?.quitAndInstall()
  }

  /** 是否近期由用户主动触发检查（用于「已是最新」提示的显隐判定） */
  function isRecentManualCheck(withinMs = 15_000): boolean {
    return Date.now() - manualCheckAt < withinMs
  }

  return { status, config, checkNow, download, quitAndInstall, isRecentManualCheck }
}
