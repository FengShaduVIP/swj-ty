<template>
  <transition name="up-fade">
    <div v-if="visible" class="up-toast" :class="`up-toast--${kind}`" role="status" aria-live="polite">
      <div class="up-ico">
        <el-icon v-if="kind === 'downloaded' || kind === 'available'" :size="18"><Download /></el-icon>
        <el-icon v-else-if="kind === 'error'" :size="18"><WarningFilled /></el-icon>
        <el-icon v-else :size="18"><CircleCheckFilled /></el-icon>
      </div>

      <div class="up-body">
        <div class="up-title">{{ title }}</div>
        <div v-if="subtitle" class="up-sub">{{ subtitle }}</div>

        <el-progress
          v-if="kind === 'downloading'"
          :percentage="Math.floor(status.progress?.percent || 0)"
          :stroke-width="4"
          :show-text="false"
          class="up-prog"
        />

        <pre v-if="showNotes && notes" class="up-notes">{{ notes }}</pre>
        <div v-if="notes && kind !== 'downloading'" class="up-toggle" @click="showNotes = !showNotes">
          {{ showNotes ? '收起更新内容' : '查看更新内容' }}
        </div>

        <div class="up-actions">
          <template v-if="kind === 'downloaded'">
            <el-button type="primary" size="small" @click="onRestart">立即重启更新</el-button>
            <el-button size="small" text @click="dismiss">稍后</el-button>
          </template>
          <template v-else-if="kind === 'available'">
            <el-button type="primary" size="small" @click="onConfirmUpdate">确认更新</el-button>
            <el-button size="small" text @click="dismiss">稍后</el-button>
          </template>
          <template v-else-if="kind === 'error'">
            <el-button type="primary" size="small" @click="onRetry">重试</el-button>
            <el-button size="small" text @click="dismiss">关闭</el-button>
          </template>
          <template v-else>
            <el-button size="small" text @click="dismiss">知道了</el-button>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Download, WarningFilled, CircleCheckFilled } from '@element-plus/icons-vue'
import { useUpdater } from '../composables/useUpdater'

const { status, checkNow, download, quitAndInstall, isRecentManualCheck } = useUpdater()

const dismissed = ref(false)
const showNotes = ref(false)
let uptodateTimer: ReturnType<typeof setTimeout> | null = null

// 提示类型：available（发现新版本待确认）/ downloaded / error / downloading / uptodate / none（隐藏）
const kind = computed<'available' | 'downloaded' | 'error' | 'downloading' | 'uptodate' | 'none'>(() => {
  switch (status.value.state) {
    case 'available': return 'available'
    case 'downloaded': return 'downloaded'
    case 'error': return 'error'
    case 'downloading': return 'downloading'
    case 'not-available': return isRecentManualCheck() ? 'uptodate' : 'none'
    default: return 'none'
  }
})

const visible = computed(() =>
  !dismissed.value && (kind.value === 'available' || kind.value === 'downloaded' || kind.value === 'error' || kind.value === 'downloading' || kind.value === 'uptodate')
)

const title = computed(() => {
  const s = status.value
  switch (kind.value) {
    case 'available': return `发现新版本 v${s.latestVersion}`
    case 'downloaded': return `最新版本 v${s.latestVersion} 已下载`
    case 'error': return '更新检查失败'
    case 'downloading': return `正在下载更新${s.latestVersion ? ' v' + s.latestVersion : ''}`
    case 'uptodate': return `已是最新版本 v${s.currentVersion}`
    default: return ''
  }
})

const subtitle = computed(() => {
  const s = status.value
  switch (kind.value) {
    case 'available': return `当前 v${s.currentVersion} → v${s.latestVersion}，需你确认后才会下载`
    case 'downloaded': return `当前 v${s.currentVersion} → v${s.latestVersion}，重启后生效`
    case 'error': return s.error || '请检查网络连接后重试'
    case 'downloading': return '下载完成后将提示重启，无需中断当前监测'
    default: return ''
  }
})

const notes = computed(() => status.value.releaseNotes || '')

function dismiss() { dismissed.value = true }

function onRestart() {
  // 触发主进程退出并应用更新（会重启应用）
  quitAndInstall()
}

/** 用户点「确认更新」后才开始下载——手动确认策略下不做后台自动下载 */
function onConfirmUpdate() {
  download()
}

async function onRetry() {
  dismissed.value = false
  await checkNow()
}

// 新状态到达时：重置「稍后/关闭」的忽略标记，让提示重新出现；
// 仅「已是最新」自动 3.5s 隐藏
watch(() => status.value.state, (s) => {
  if (uptodateTimer) { clearTimeout(uptodateTimer); uptodateTimer = null }
  if (s === 'available' || s === 'downloaded' || s === 'error') {
    dismissed.value = false
    showNotes.value = false
  } else if (s === 'not-available' && isRecentManualCheck()) {
    dismissed.value = false
    uptodateTimer = setTimeout(() => { dismissed.value = true }, 3500)
  }
})
</script>

<style scoped>
.up-toast {
  position: fixed;
  right: var(--space-6);
  bottom: calc(var(--h-footer) + var(--space-5));
  z-index: var(--z-toast);
  width: 360px;
  max-width: calc(100vw - 32px);
  display: flex;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-3);
}

.up-ico {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}
.up-toast--downloaded .up-ico { color: var(--ok-bright); background: var(--ok-bg); }
.up-toast--error .up-ico { color: var(--critical); background: var(--critical-bg); }
.up-toast--available .up-ico,
.up-toast--downloading .up-ico,
.up-toast--uptodate .up-ico { color: var(--info); background: var(--info-bg); }

.up-body { flex: 1; min-width: 0; }
.up-title {
  font-size: var(--fs-body-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.up-sub {
  margin-top: 2px;
  font-size: var(--fs-caption);
  color: var(--text-secondary);
  line-height: 1.5;
}
.up-prog { margin-top: var(--space-3); }
.up-notes {
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  max-height: 160px;
  overflow: auto;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.up-toggle {
  margin-top: var(--space-2);
  font-size: var(--fs-micro);
  color: var(--info);
  cursor: pointer;
}
.up-toggle:hover { text-decoration: underline; }
.up-actions {
  margin-top: var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* 过渡动画 */
.up-fade-enter-active,
.up-fade-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}
.up-fade-enter-from,
.up-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
