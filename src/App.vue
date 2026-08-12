<template>
  <div class="app-container">
    <!-- 顶部标题栏 -->
    <header class="app-header">
      <div class="header-left">
        <el-icon :size="24"><Connection /></el-icon>
        <h1>串口调试工具</h1>
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
          :ports="ports"
          :logs="dataLogs"
          @connect="handleConnect"
          @disconnect="handleDisconnect"
          @refresh="handleRefreshPorts"
          @clear="dataLogs = []"
        />
      </div>
      <div class="right-panel">
        <el-tabs v-model="activeTab" class="proto-tabs">
          <el-tab-pane label="JBD BMS" name="jbd">
            <JbdPanel
              :connected="connected"
            />
          </el-tab-pane>
          <el-tab-pane label="JBD 宏" name="jbd-macro">
            <JbdMacro
              :connected="connected"
            />
          </el-tab-pane>
          <el-tab-pane label="JBD 参数配置" name="jbd-config">
            <JbdParamConfig
              :connected="connected"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import SerialPanel from './components/SerialPanel.vue'
import JbdPanel from './components/JbdPanel.vue'
import JbdMacro from './components/JbdMacro.vue'
import JbdParamConfig from './components/JbdParamConfig.vue'
import { jbdBus } from './jbd/jbd-bus'

// ===== 组件引用 =====
const activeTab = ref('jbd')

// ===== 状态 =====
const connected = ref(false)
const portPath = ref('')
const ports = ref<SerialPortInfo[]>([])

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
    const list = await window.serialAPI.listPorts()
    ports.value = list
    addLog('info', `刷新串口列表: 找到 ${list.length} 个串口`)
    return list
  } catch (err: any) {
    ElMessage.error('获取串口列表失败: ' + (err.message || err))
    ports.value = []
    return []
  }
}

// ===== 统一发送 =====
async function handleSend(data: number[]) {
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
  // JBD 发送通道：经 App 写串口并记日志
  jbdBus.setSender((frame) => { handleSend(frame) })

  // 监听串口数据：JBD 统一喂给帧总线
  window.serialAPI.onData((data: number[]) => {
    const hex = data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    addLog('recv', `接收: ${hex}`)

    jbdBus.feed(data)
  })

  window.serialAPI.onError((error: string) => {
    addLog('error', error)
  })

  window.serialAPI.onStatusChange((status: SerialStatus) => {
    connected.value = status.connected
    portPath.value = status.portPath || ''
  })
})

onUnmounted(() => {
  window.serialAPI.removeAllListeners()
  jbdBus.clear()
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
  overflow: hidden;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: #1a1e24;
}

.proto-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.proto-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 12px;
  background: #161a1f;
}
.proto-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.proto-tabs :deep(.el-tab-pane) {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.proto-tabs :deep(.el-tab-pane)::-webkit-scrollbar {
  display: none;
}
</style>
