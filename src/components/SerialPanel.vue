<template>
  <div class="serial-view">
    <!-- 左：串口配置 -->
    <div class="sv-left">
      <section class="panel conn-card">
        <header class="panel-h">
          <span class="panel-title"><el-icon><Setting /></el-icon> 串口配置</span>
        </header>

        <div class="conn-body">
          <!-- 连接状态指示 -->
          <div class="conn-state">
            <ConnIndicator :state="ui.conn" />
            <StatusBadge :status="ui.conn === 'connected' ? 'ok' : (ui.conn === 'error' ? 'critical' : 'neutral')"
                         :label="ui.conn === 'connected' ? '链路正常' : (ui.conn === 'error' ? '链路异常' : '离线')" />
          </div>

          <!-- 协议选择 -->
          <div class="form-group">
            <label>通讯协议</label>
            <el-select v-model="ui.protocol" :disabled="connected" style="width: 100%" @change="onProtocolChange">
              <el-option label="嘉佰达 (JBD)" value="jbd" />
              <el-option label="天一 (Modbus-RTU)" value="tianyi" />
            </el-select>
          </div>

          <!-- 从机地址（仅天一） -->
          <div v-if="ui.protocol === 'tianyi'" class="form-group">
            <label>从机地址</label>
            <el-input-number v-model="ui.slaveAddr" :disabled="connected" :min="1" :max="247" controls-position="right" style="width: 100%" />
          </div>

          <!-- 串口号 -->
          <div class="form-group">
            <label>串口号</label>
            <el-select
              v-model="selectedPort"
              placeholder="请选择串口"
              :disabled="connected"
              style="width: 100%"
              @focus="refreshPorts"
            >
              <el-option
                v-for="port in props.ports"
                :key="port.path"
                :label="`${port.path} ${port.manufacturer || ''}`"
                :value="port.path"
              />
            </el-select>
          </div>

          <!-- 波特率 -->
          <div class="form-group">
            <label>波特率</label>
            <el-select v-model="baudRate" :disabled="connected" style="width: 100%">
              <el-option v-for="rate in baudRates" :key="rate" :label="rate.toString()" :value="rate" />
            </el-select>
          </div>

          <!-- 数据位 / 停止位 / 校验位 -->
          <div class="form-row">
            <div class="form-group" style="flex: 1">
              <label>数据位</label>
              <el-select v-model="dataBits" :disabled="connected" style="width: 100%">
                <el-option label="8" :value="8" />
                <el-option label="7" :value="7" />
                <el-option label="6" :value="6" />
                <el-option label="5" :value="5" />
              </el-select>
            </div>
            <div class="form-group" style="flex: 1">
              <label>停止位</label>
              <el-select v-model="stopBits" :disabled="connected" style="width: 100%">
                <el-option label="1" :value="1" />
                <el-option label="1.5" :value="1.5" />
                <el-option label="2" :value="2" />
              </el-select>
            </div>
            <div class="form-group" style="flex: 1">
              <label>校验位</label>
              <el-select v-model="parity" :disabled="connected" style="width: 100%">
                <el-option label="无" value="none" />
                <el-option label="奇校验" value="odd" />
                <el-option label="偶校验" value="even" />
              </el-select>
            </div>
          </div>

          <!-- 连接 / 断开 -->
          <div class="form-actions">
            <el-button
              v-if="!connected"
              type="primary"
              :icon="Link"
              :disabled="!selectedPort"
              :loading="connecting"
              @click="doConnect"
              style="width: 100%"
            >
              连接设备
            </el-button>
            <el-button
              v-else
              type="danger"
              :icon="SwitchButton"
              @click="doDisconnect"
              style="width: 100%"
            >
              断开连接
            </el-button>
          </div>

          <!-- 连接参数摘要 -->
          <div v-if="connected" class="conn-meta">
            <div class="meta-row" v-for="m in metaRows" :key="m.k">
              <span class="meta-k">{{ m.k }}</span>
              <span class="meta-v num">{{ m.v }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 右：通信日志 -->
    <div class="sv-right">
      <DataLog :logs="logs" @clear="$emit('clear')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting, Link, SwitchButton } from '@element-plus/icons-vue'
import DataLog from './DataLog.vue'
import ConnIndicator from './ConnIndicator.vue'
import StatusBadge from './StatusBadge.vue'
import { ui, setProtocol, setSlaveAddr } from '@/store'

interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  content: string
}

const props = withDefaults(defineProps<{
  connected: boolean
  portPath?: string
  ports?: SerialPortInfo[]
  logs?: LogEntry[]
}>(), {
  ports: () => [],
  logs: () => []
})

const emit = defineEmits<{
  connect: [config: SerialConnectConfig]
  disconnect: []
  refresh: []
  clear: []
}>()

const selectedPort = ref('')
const baudRate = ref(9600)
const dataBits = ref<5 | 6 | 7 | 8>(8)
const stopBits = ref<1 | 1.5 | 2>(1)
const parity = ref<'none' | 'even' | 'odd' | 'mark' | 'space'>('none')
const connecting = ref(false)

const baudRates = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 56000, 57600, 115200, 128000, 256000]

const parityLabel = computed(() => {
  const map: Record<string, string> = { none: '无', even: '偶校验', odd: '奇校验' }
  return map[parity.value] || parity.value
})

const metaRows = computed(() => {
  const rows = [
    { k: '协议', v: ui.protocol === 'jbd' ? '嘉佰达 (JBD)' : '天一 (Modbus-RTU)' },
    { k: '串口', v: props.portPath || selectedPort.value || '--' },
    { k: '波特率', v: baudRate.value.toString() },
    { k: '数据位', v: dataBits.value.toString() },
    { k: '停止位', v: stopBits.value.toString() },
    { k: '校验位', v: parityLabel.value },
  ]
  if (ui.protocol === 'tianyi') rows.splice(1, 0, { k: '从机地址', v: ui.slaveAddr.toString() })
  return rows
})

function onProtocolChange() {
  // 切换协议时同步到 store；默认天一协议波特率 9600
  if (ui.protocol === 'tianyi' && baudRate.value !== 9600) baudRate.value = 9600
}

function refreshPorts() { emit('refresh') }

async function doConnect() {
  connecting.value = true
  try {
    emit('connect', {
      path: selectedPort.value,
      baudRate: baudRate.value,
      dataBits: dataBits.value,
      stopBits: stopBits.value,
      parity: parity.value,
    })
  } finally {
    connecting.value = false
  }
}
function doDisconnect() { emit('disconnect') }

onMounted(() => { refreshPorts() })
</script>

<style scoped>
.serial-view {
  display: flex;
  gap: var(--space-5);
  padding: var(--space-6);
  height: 100%;
  min-height: 0;
}
.sv-left { flex: 0 0 360px; min-width: 0; display: flex; flex-direction: column; }
.sv-right { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }

.conn-card { display: flex; flex-direction: column; min-height: 0; }
.panel-h {
  display: flex; align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
}
.conn-body { padding: var(--space-5); overflow-y: auto; }

.conn-state {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-5);
}

.form-group { margin-bottom: var(--space-4); }
.form-group > label {
  display: block;
  font-size: var(--fs-caption);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
}
.form-row { display: flex; gap: var(--space-3); }
.form-actions { margin-top: var(--space-5); }

.conn-meta {
  margin-top: var(--space-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  overflow: hidden;
}
.meta-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.meta-row:last-child { border-bottom: none; }
.meta-k { font-size: var(--fs-caption); color: var(--text-secondary); }
.meta-v { font-size: var(--fs-num-sm); color: var(--text-primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; }

/* 窄窗口：纵向堆叠 */
@media (max-width: 1080px) {
  .serial-view { flex-direction: column; }
  .sv-left { flex: 0 0 auto; }
  .sv-right { flex: 1; min-height: 200px; }
}
</style>
