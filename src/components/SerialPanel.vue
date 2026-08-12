<template>
  <div class="serial-panel">
    <!-- 串口配置区（顶部，固定，内容过多时内部滚动） -->
    <div class="serial-config">
      <h3 class="panel-title">
        <el-icon><Setting /></el-icon>
        串口配置
      </h3>

      <!-- 串口选择 -->
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
          <el-option
            v-for="rate in baudRates"
            :key="rate"
            :label="rate.toString()"
            :value="rate"
          />
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

      <!-- 连接/断开按钮 -->
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
          连接串口
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

      <!-- 连接状态信息 -->
      <div v-if="connected" class="status-info">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="串口">{{ portPath }}</el-descriptions-item>
          <el-descriptions-item label="波特率">{{ baudRate }}</el-descriptions-item>
          <el-descriptions-item label="数据位">{{ dataBits }}</el-descriptions-item>
          <el-descriptions-item label="停止位">{{ stopBits }}</el-descriptions-item>
          <el-descriptions-item label="校验位">{{ parityLabel }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </div>

    <!-- 通信日志（配置下方，占满剩余高度） -->
    <DataLog :logs="logs" @clear="$emit('clear')" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Setting, Link, SwitchButton } from '@element-plus/icons-vue'
import DataLog from './DataLog.vue'

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

function refreshPorts() {
  emit('refresh')
}

async function doConnect() {
  connecting.value = true
  try {
    emit('connect', {
      path: selectedPort.value,
      baudRate: baudRate.value,
      dataBits: dataBits.value,
      stopBits: stopBits.value,
      parity: parity.value
    })
  } finally {
    connecting.value = false
  }
}

function doDisconnect() {
  emit('disconnect')
}

onMounted(() => {
  refreshPorts()
})
</script>

<style scoped>
.serial-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 配置区：顶部固定，空间不足时内部滚动 */
.serial-config {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #f0f1f2;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #2a2e34;
}

.panel-title .el-icon {
  color: #00BFA5;
}

.form-group {
  margin-bottom: 12px;
}

.form-group > label {
  display: block;
  font-size: 13px;
  color: #8a8e94;
  margin-bottom: 4px;
}

.form-row {
  display: flex;
  gap: 8px;
}

.form-actions {
  margin-top: 16px;
}

.status-info {
  margin-top: 16px;
}
</style>
