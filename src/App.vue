<template>
  <div class="app-container">
    <!-- 顶部标题栏 -->
    <header class="app-header">
      <div class="header-left">
        <el-icon :size="24"><Connection /></el-icon>
        <h1>串口 Modbus 调试工具</h1>
      </div>
      <div class="header-right">
        <el-tag :type="connected ? 'success' : 'danger'" effect="dark" size="large">
          {{ connected ? `已连接 ${portPath}` : '未连接' }}
        </el-tag>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="app-main">
      <div class="left-panel">
        <SerialPanel
          :connected="connected"
          :port-path="portPath"
          @connect="handleConnect"
          @disconnect="handleDisconnect"
          @refresh="handleRefreshPorts"
        />
      </div>
      <div class="right-panel">
        <ModbusPanel
          ref="modbusPanelRef"
          :connected="connected"
          @send="handleSendModbus"
        />
        <DataLog
          :logs="dataLogs"
          @clear="dataLogs = []"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import SerialPanel from './components/SerialPanel.vue'
import ModbusPanel from './components/ModbusPanel.vue'
import DataLog from './components/DataLog.vue'

// ===== 组件引用 =====
const modbusPanelRef = ref<InstanceType<typeof ModbusPanel> | null>(null)

// ===== 状态 =====
const connected = ref(false)
const portPath = ref('')

interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  content: string
}

const dataLogs = ref<LogEntry[]>([])

function addLog(type: LogEntry['type'], content: string) {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + now.getMilliseconds().toString().padStart(3, '0')
  dataLogs.value.push({ time, type, content })
  // 保留最近 500 条
  if (dataLogs.value.length > 500) {
    dataLogs.value = dataLogs.value.slice(-500)
  }
}

// ===== 串口连接 =====
async function handleConnect(config: SerialConnectConfig) {
  try {
    await window.serialAPI.connect(config)
    connected.value = true
    portPath.value = config.path
    addLog('info', `串口已连接: ${config.path} @ ${config.baudRate}bps`)
  } catch (err: any) {
    ElMessage.error('连接失败: ' + (err.message || err))
    addLog('error', `连接失败: ${err.message || err}`)
  }
}

async function handleDisconnect() {
  try {
    await window.serialAPI.disconnect()
    connected.value = false
    portPath.value = ''
    addLog('info', '串口已断开')
  } catch (err: any) {
    ElMessage.error('断开失败: ' + (err.message || err))
  }
}

async function handleRefreshPorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await window.serialAPI.listPorts()
    addLog('info', `刷新串口列表: 找到 ${ports.length} 个串口`)
    return ports
  } catch (err: any) {
    ElMessage.error('获取串口列表失败: ' + (err.message || err))
    return []
  }
}

// ===== Modbus 收发 =====
async function handleSendModbus(data: number[]) {
  try {
    await window.serialAPI.send(data)
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    addLog('send', `发送: ${hex}`)
  } catch (err: any) {
    ElMessage.error('发送失败: ' + (err.message || err))
    addLog('error', `发送失败: ${err.message || err}`)
  }
}

// ===== 生命周期 =====
onMounted(() => {
  // 监听串口数据
  window.serialAPI.onData((data: number[]) => {
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    addLog('recv', `接收: ${hex}`)

    // 自动解析 Modbus 响应
    if (modbusPanelRef.value) {
      modbusPanelRef.value.parseReadResponse(data)
    }
  })

  // 监听错误
  window.serialAPI.onError((error: string) => {
    addLog('error', error)
  })

  // 监听状态变化
  window.serialAPI.onStatusChange((status: SerialStatus) => {
    connected.value = status.connected
    portPath.value = status.portPath || ''
  })
})

onUnmounted(() => {
  window.serialAPI.removeAllListeners()
})
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0c0e10;
  color: #f0f1f2;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #1a1e24;
  border-bottom: 1px solid #2a2e34;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #00BFA5;
}

.header-left h1 {
  font-size: 18px;
  font-weight: 600;
  color: #f0f1f2;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
  background: #2a2e34;
}

.left-panel {
  width: 360px;
  flex-shrink: 0;
  background: #1a1e24;
  overflow-y: auto;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
</style>
