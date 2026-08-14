<template>
  <div class="fw">
    <!-- 警示横幅 -->
    <div class="fw-banner">
      <span class="fw-banner-ico">!</span>
      <span class="fw-banner-text">
        本页为固件升级框架（v1）：已实现 OTA 协议骨架与握手校验，<b>实际分包烧录默认未启用</b>。
        请在非产线设备上验证，切勿误用真实烧录。
      </span>
    </div>

    <div class="fw-grid">
      <!-- 左：固件与步骤 -->
      <section class="card fw-main">
        <div class="card-h">
          <span class="card-title">固件升级</span>
          <span class="card-hint">Modbus OTA · 握手 / 分包 / 跳转</span>
        </div>

        <!-- 文件选择 -->
        <div class="fw-file">
          <input ref="fileInput" type="file" accept=".bin,.hex,.img,.fw" style="display:none" @change="onFileChange" />
          <button class="btn" @click="pickFile">选择固件文件</button>
          <span class="fw-fname">{{ file ? file.name : '未选择文件' }}</span>
          <button v-if="file" class="btn btn-ghost" @click="clearFile">清除</button>
        </div>

        <!-- 固件信息 -->
        <div class="fw-info">
          <div class="kv"><span>文件大小</span><b class="num">{{ fileSizeText }}</b></div>
          <div class="kv"><span>固件包数</span><b class="num">{{ packetText }} 包 · 128 字节/包</b></div>
          <div class="kv"><span>目标从机</span><b class="num">0x{{ slaveHex }}</b></div>
        </div>

        <!-- 跳转模式 -->
        <div class="fw-mode">
          <span class="fw-mode-label">结束跳转模式</span>
          <el-radio-group v-model="jumpMode">
            <el-radio :value="OTA_JUMP_MODE.UPGRADE_ONLY">仅升级</el-radio>
            <el-radio :value="OTA_JUMP_MODE.WIPE_PROTECT_CONFIG">擦除保护参数与配置</el-radio>
            <el-radio :value="OTA_JUMP_MODE.WIPE_ALL">擦除全部区域</el-radio>
          </el-radio-group>
        </div>

        <!-- 进度 -->
        <div class="fw-progress">
          <div class="fw-progress-top">
            <span>传输进度</span>
            <span class="num">{{ progress }}% · 第 {{ currentPacket }}/{{ packetText }} 包</span>
          </div>
          <div class="fw-bar"><div class="fw-bar-fill" :class="{ done }" :style="{ width: progress + '%' }"></div></div>
        </div>

        <!-- 操作按钮 -->
        <div class="fw-actions">
          <button class="btn" :disabled="!connected || !firmwareBytes || upgrading || handshaked" @click="doHandshake">1. 握手</button>
          <button class="btn btn-primary" :disabled="!connected || !handshaked || upgrading" @click="startUpgrade">2. 开始升级</button>
          <button class="btn" :disabled="!connected || !handshaked || upgrading" @click="doJump">3. 结束跳转</button>
          <button class="btn btn-ghost" :disabled="!upgrading" @click="abort">中断</button>
          <button class="btn btn-ghost" @click="resetFlow">重置</button>
        </div>

        <!-- 危险开关 -->
        <div class="fw-danger">
          <label class="fw-switch">
            <input type="checkbox" v-model="realBurn" />
            <span>真实烧录模式（危险）</span>
          </label>
          <span class="fw-danger-hint">
            启用后升级与跳转将真正向设备发送固件数据，可能损坏设备。默认关闭，仅走协议流程与演示进度。
          </span>
        </div>
      </section>

      <!-- 右：日志 -->
      <section class="card fw-log">
        <div class="card-h">
          <span class="card-title">操作日志</span>
          <button class="btn btn-ghost btn-sm" @click="logs = []">清空</button>
        </div>
        <div class="fw-log-body">
          <div v-for="(l, i) in logs" :key="i" class="fw-log-row" :class="'lv-' + l.level">
            <span class="fw-log-time num">{{ l.time }}</span>
            <span class="fw-log-text">{{ l.text }}</span>
          </div>
          <div v-if="!logs.length" class="fw-log-empty">暂无日志</div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { tianyiBus } from '../tianyi/tianyi-bus'
import {
  buildOtaHandshake, buildOtaPacket, buildOtaJump,
  OTA_PACKET_BYTES, OTA_JUMP_MODE, parseOtaResponse, type ModbusFrame,
} from '../tianyi/tianyi-protocol'
import { ui } from '../store'

const props = defineProps<{ connected: boolean }>()

const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const firmwareBytes = ref<Uint8Array | null>(null)
const totalPackets = ref(0)

const jumpMode = ref<number>(OTA_JUMP_MODE.UPGRADE_ONLY)
const realBurn = ref(false)        // 危险：真实烧录默认关闭
const handshaked = ref(false)
const upgrading = ref(false)
const currentPacket = ref(0)
const progress = ref(0)
const done = ref(false)

let demoTimer: ReturnType<typeof setInterval> | null = null

interface LogRow { time: string; level: 'info' | 'ok' | 'warn' | 'err'; text: string }
const logs = ref<LogRow[]>([])

const slave = computed(() => ui.slaveAddr & 0xff)
const slaveHex = computed(() => slave.value.toString(16).padStart(2, '0').toUpperCase())
const fileSizeText = computed(() => (file.value ? file.value.size.toLocaleString('zh-CN') + ' 字节' : '--'))
const packetText = computed(() => (totalPackets.value ? totalPackets.value.toString() : '--'))

function addLog(level: LogRow['level'], text: string) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.value.push({ time: t, level, text })
  if (logs.value.length > 200) logs.value = logs.value.slice(-200)
}

function pickFile() { fileInput.value?.click() }
function clearFile() {
  file.value = null
  firmwareBytes.value = null
  totalPackets.value = 0
  handshaked.value = false
  resetFlow()
}
function onFileChange(e: Event) {
  const inp = e.target as HTMLInputElement
  const f = inp.files?.[0]
  if (!f) return
  file.value = f
  const reader = new FileReader()
  reader.onload = () => {
    const arr = new Uint8Array(reader.result as ArrayBuffer)
    firmwareBytes.value = arr
    totalPackets.value = Math.ceil(arr.length / OTA_PACKET_BYTES)
    handshaked.value = false
    resetFlow()
    addLog('info', `已载入固件：${f.name} · ${arr.length} 字节 · 共 ${totalPackets.value} 包`)
  }
  reader.onerror = () => addLog('err', '文件读取失败')
  reader.readAsArrayBuffer(f)
  inp.value = '' // 允许重复选择同一文件
}

function resetFlow() {
  handshaked.value = false
  upgrading.value = false
  currentPacket.value = 0
  progress.value = 0
  done.value = false
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null }
}
function abort() {
  upgrading.value = false
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null }
  addLog('warn', '用户中断升级流程')
}

async function doHandshake() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (!firmwareBytes.value) { ElMessage.warning('请先选择固件文件'); return }
  handshaked.value = false
  addLog('info', `发送握手：0xF000 · 总包数=${totalPackets.value}`)
  const frame = await tianyiBus.sendAck(buildOtaHandshake(slave.value, totalPackets.value))
  const r = parseOtaResponse(frame)
  if (r === 'ok') {
    handshaked.value = true
    addLog('ok', '握手成功，设备进入升级就绪状态')
    ElMessage.success('握手成功')
  } else if (r === 'fail') {
    addLog('err', `握手失败：设备异常应答（异常码 0x${frame.exceptionCode ?? 0}）`)
    ElMessage.error('握手失败')
  } else {
    addLog('err', '握手超时：未收到设备响应')
    ElMessage.error('握手超时')
  }
}

async function startUpgrade() {
  if (!handshaked.value) { ElMessage.warning('请先完成握手'); return }
  if (upgrading.value) return
  if (realBurn.value) {
    await runRealUpgrade()
  } else {
    runDemoUpgrade()
  }
}

// 演示模式：模拟分包进度，不向设备发送固件数据
function runDemoUpgrade() {
  upgrading.value = true
  done.value = false
  addLog('info', '【演示模式】模拟分包传输进度（不向设备发送固件数据）')
  const total = totalPackets.value
  demoTimer = setInterval(() => {
    currentPacket.value += 1
    progress.value = Math.min(100, Math.round((currentPacket.value / total) * 100))
    if (currentPacket.value >= total) {
      if (demoTimer) { clearInterval(demoTimer); demoTimer = null }
      upgrading.value = false
      done.value = true
      addLog('ok', `【演示模式】分包传输完成（${total} 包），进度 100%`)
      ElMessage.success('（演示）分包传输完成')
    }
  }, 60)
}

// 真实模式：逐包发送（受总线 500ms 帧间隔），完成后再发跳转
async function runRealUpgrade() {
  upgrading.value = true
  done.value = false
  const bytes = firmwareBytes.value!
  const total = totalPackets.value
  for (let seq = 0; seq < total; seq++) {
    if (!upgrading.value) return // 中断
    const start = seq * OTA_PACKET_BYTES
    const slice = bytes.slice(start, start + OTA_PACKET_BYTES)
    const padded = new Uint8Array(OTA_PACKET_BYTES)
    padded.set(slice)
    const addr = (0x001 + seq).toString(16).toUpperCase().padStart(3, '0')
    addLog('info', `发送第 ${seq + 1}/${total} 包 (0xF${addr})`)
    const frame: ModbusFrame = await tianyiBus.sendAck(buildOtaPacket(slave.value, seq, Array.from(padded)))
    const r = parseOtaResponse(frame)
    if (r !== 'ok') {
      upgrading.value = false
      addLog('err', `第 ${seq + 1} 包传输失败（${r === 'timeout' ? '超时' : '异常 0x' + (frame.exceptionCode ?? 0)}），升级中止`)
      ElMessage.error('固件传输失败')
      return
    }
    currentPacket.value = seq + 1
    progress.value = Math.round(((seq + 1) / total) * 100)
  }
  await doJumpInternal()
  upgrading.value = false
  done.value = true
  addLog('ok', '固件分包传输完成，已发送结束跳转指令')
}

async function doJump() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (!handshaked.value) { ElMessage.warning('请先完成握手'); return }
  await doJumpInternal()
}

async function doJumpInternal() {
  if (!realBurn.value) {
    addLog('info', `【演示模式】跳过真实跳转（模式 0x${jumpMode.value.toString(16).padStart(4, '0')}）`)
    ElMessage.info('（演示）未执行真实跳转')
    return
  }
  addLog('info', `发送结束跳转：0xFEAA · 模式 0x${jumpMode.value.toString(16).padStart(4, '0')}`)
  const frame = await tianyiBus.sendAck(buildOtaJump(slave.value, jumpMode.value))
  const r = parseOtaResponse(frame)
  if (r === 'ok') {
    addLog('ok', '跳转成功，设备将重启并进入 BootLoader 升级')
    ElMessage.success('跳转成功')
  } else {
    addLog('err', `跳转失败（${r === 'timeout' ? '超时' : '异常 0x' + (frame.exceptionCode ?? 0)}）`)
    ElMessage.error('跳转失败')
  }
}

onUnmounted(() => {
  if (demoTimer) clearInterval(demoTimer)
  upgrading.value = false
})
</script>

<style scoped>
.fw { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-6); height: 100%; box-sizing: border-box; }

/* 警示横幅 */
.fw-banner {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--critical-bg); border: 1px solid var(--critical-border);
  border-radius: var(--radius-sm);
}
.fw-banner-ico {
  flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%;
  background: var(--critical); color: #fff; font-weight: var(--fw-bold); font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
}
.fw-banner-text { font-size: var(--fs-caption); color: var(--text-primary); line-height: 1.5; }
.fw-banner-text b { color: var(--critical); }

.fw-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--space-5); min-height: 0; flex: 1; }

.card {
  background: var(--bg-surface); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); display: flex; flex-direction: column; min-height: 0;
}
.card-h {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border-subtle);
}
.card-title { font-size: var(--fs-title); font-weight: var(--fw-semibold); color: var(--text-primary); }
.card-hint { font-size: var(--fs-caption); color: var(--text-tertiary); margin-left: auto; }

.fw-main { gap: var(--space-5); padding: 0 0 var(--space-5); }
.fw-main > .card-h { margin-bottom: 0; }

/* 文件选择 */
.fw-file { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5) 0; }
.fw-fname { font-size: var(--fs-body-sm); color: var(--text-secondary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

/* 信息 */
.fw-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); padding: var(--space-2) var(--space-5); }
.kv { display: flex; flex-direction: column; gap: 2px; }
.kv span { font-size: var(--fs-micro); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
.kv b { font-size: var(--fs-num-md); color: var(--text-primary); font-family: var(--font-mono); }

/* 模式 */
.fw-mode { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-2) var(--space-5); flex-wrap: wrap; }
.fw-mode-label { font-size: var(--fs-caption); color: var(--text-secondary); font-weight: var(--fw-medium); }

/* 进度 */
.fw-progress { padding: var(--space-2) var(--space-5); }
.fw-progress-top { display: flex; justify-content: space-between; font-size: var(--fs-caption); color: var(--text-secondary); margin-bottom: var(--space-2); }
.fw-bar { height: 10px; border-radius: var(--radius-pill); background: var(--bg-inset); overflow: hidden; }
.fw-bar-fill { height: 100%; background: var(--brand); transition: width var(--dur-base) var(--ease-standard); }
.fw-bar-fill.done { background: var(--ok); }

/* 操作按钮 */
.fw-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-2) var(--space-5); }

/* 危险开关 */
.fw-danger {
  display: flex; flex-direction: column; gap: var(--space-2);
  margin: var(--space-2) var(--space-5) 0; padding: var(--space-4);
  background: var(--bg-canvas); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
}
.fw-switch { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: var(--fw-medium); cursor: pointer; }
.fw-switch input { width: 16px; height: 16px; accent-color: var(--critical); }
.fw-danger-hint { font-size: var(--fs-micro); color: var(--text-tertiary); line-height: 1.5; }

/* 日志 */
.fw-log { min-height: 0; }
.fw-log-body { flex: 1; overflow-y: auto; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: 4px; }
.fw-log-row { display: flex; gap: var(--space-3); font-size: var(--fs-caption); line-height: 1.4; }
.fw-log-time { color: var(--text-tertiary); flex-shrink: 0; }
.fw-log-text { color: var(--text-secondary); }
.fw-log-row.lv-ok .fw-log-text { color: var(--ok); }
.fw-log-row.lv-warn .fw-log-text { color: var(--warning); }
.fw-log-row.lv-err .fw-log-text { color: var(--critical); }
.fw-log-empty { color: var(--text-tertiary); font-size: var(--fs-caption); padding: var(--space-4); text-align: center; }

/* 按钮（与既有组件一致） */
.btn {
  height: var(--h-control); padding: 0 var(--space-5);
  background: var(--bg-raised); border: 1px solid var(--border-default);
  border-radius: var(--radius-sm); color: var(--text-primary);
  font-size: var(--fs-body-sm); cursor: pointer; white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--border-strong); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--brand-hover); }
.btn-ghost { background: transparent; border-color: var(--border-subtle); color: var(--text-secondary); }
.btn-sm { height: 26px; padding: 0 var(--space-3); font-size: var(--fs-caption); }
</style>
