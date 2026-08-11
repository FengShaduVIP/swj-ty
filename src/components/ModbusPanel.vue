<template>
  <div class="modbus-panel">
    <h3 class="panel-title">
      <el-icon><DataBoard /></el-icon>
      Modbus 指令
    </h3>

    <div class="modbus-content">
      <!-- 功能码选择 -->
      <div class="command-section">
        <h4>读寄存器 (0x03)</h4>
        <div class="form-row">
          <div class="form-group" style="flex: 1">
            <label>从站地址</label>
            <el-input-number
              v-model="readSlaveId"
              :min="1"
              :max="247"
              :disabled="!connected"
              size="small"
              controls-position="right"
              style="width: 100%"
            />
          </div>
          <div class="form-group" style="flex: 1">
            <label>起始地址 (DEC)</label>
            <el-input-number
              v-model="readStartAddr"
              :min="0"
              :max="65535"
              :disabled="!connected"
              size="small"
              controls-position="right"
              style="width: 100%"
            />
          </div>
          <div class="form-group" style="flex: 1">
            <label>数量</label>
            <el-input-number
              v-model="readQuantity"
              :min="1"
              :max="125"
              :disabled="!connected"
              size="small"
              controls-position="right"
              style="width: 100%"
            />
          </div>
        </div>
        <div class="form-row" style="margin-top: 8px">
          <div class="form-group" style="flex: 1">
            <label>数据格式</label>
            <el-select v-model="readFormat" size="small" style="width: 100%">
              <el-option label="uint16 (无符号16位)" value="uint16" />
              <el-option label="int16 (有符号16位)" value="int16" />
              <el-option label="uint32 (无符号32位)" value="uint32" />
              <el-option label="float32 (浮点数)" value="float32" />
            </el-select>
          </div>
          <div class="form-group" style="flex: 1; display: flex; align-items: flex-end">
            <el-button
              type="primary"
              :disabled="!connected || reading"
              :loading="reading"
              @click="doReadRegisters"
              size="small"
              style="width: 100%"
            >
              读取寄存器
            </el-button>
          </div>
        </div>

        <!-- 读取结果显示 -->
        <div v-if="readResult.length > 0" class="result-box">
          <div class="result-header">
            <span>读取结果 ({{ readResult.length }} 个寄存器)</span>
            <el-button text size="small" @click="readResult = []">清除</el-button>
          </div>
          <div class="result-grid">
            <div
              v-for="(val, idx) in readResult"
              :key="idx"
              class="result-item"
            >
              <span class="reg-addr">{{ (readStartAddr + idx).toString(16).padStart(4, '0').toUpperCase() }}H</span>
              <span class="reg-val">{{ val }}</span>
            </div>
          </div>
        </div>
      </div>

      <el-divider />

      <!-- 写寄存器 -->
      <div class="command-section">
        <h4>写寄存器</h4>
        <el-radio-group v-model="writeMode" size="small" style="margin-bottom: 8px">
          <el-radio-button value="single">单寄存器 (0x06)</el-radio-button>
          <el-radio-button value="multiple">多寄存器 (0x10)</el-radio-button>
        </el-radio-group>

        <div class="form-row">
          <div class="form-group" style="flex: 1">
            <label>从站地址</label>
            <el-input-number
              v-model="writeSlaveId"
              :min="1"
              :max="247"
              :disabled="!connected"
              size="small"
              controls-position="right"
              style="width: 100%"
            />
          </div>
          <div class="form-group" style="flex: 1">
            <label>起始地址 (DEC)</label>
            <el-input-number
              v-model="writeStartAddr"
              :min="0"
              :max="65535"
              :disabled="!connected"
              size="small"
              controls-position="right"
              style="width: 100%"
            />
          </div>
        </div>

        <!-- 单寄存器 -->
        <div v-if="writeMode === 'single'" class="form-group" style="margin-top: 8px">
          <label>写入值 (DEC)</label>
          <el-input-number
            v-model="singleWriteValue"
            :min="0"
            :max="65535"
            :disabled="!connected"
            size="small"
            controls-position="right"
            style="width: 100%"
          />
        </div>

        <!-- 多寄存器 -->
        <div v-if="writeMode === 'multiple'" class="form-group" style="margin-top: 8px">
          <label>写入值 (逗号分隔, 如 100,200,300)</label>
          <el-input
            v-model="multiWriteValue"
            :disabled="!connected"
            size="small"
            placeholder="100,200,300"
          />
        </div>

        <div class="form-group" style="margin-top: 8px">
          <el-button
            type="warning"
            :disabled="!connected || writing"
            :loading="writing"
            @click="doWriteRegister"
            size="small"
            style="width: 100%"
          >
            {{ writeMode === 'single' ? '写单寄存器 (0x06)' : '写多寄存器 (0x10)' }}
          </el-button>
        </div>
      </div>

      <el-divider />

      <!-- 自定义指令 -->
      <div class="command-section">
        <h4>自定义指令 (HEX)</h4>
        <div class="form-group">
          <el-input
            v-model="customCommand"
            :disabled="!connected"
            placeholder="例如: 01 03 00 00 00 0A"
            size="small"
            class="mono-font"
          />
        </div>
        <div class="form-group" style="margin-top: 8px">
          <el-button
            :disabled="!connected || !customCommand.trim()"
            @click="doSendCustom"
            size="small"
            style="width: 100%"
          >
            发送自定义指令
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { DataBoard } from '@element-plus/icons-vue'
import {
  readHoldingRegisters,
  writeSingleRegister,
  writeMultipleRegisters,
  parseResponse,
  convertRegisterValues,
  frameToHex,
  EXCEPTION_CODES
} from '../modbus/modbus'

const props = defineProps<{ connected: boolean }>()
const emit = defineEmits<{ send: [data: number[]] }>()

// ===== 读寄存器参数 =====
const readSlaveId = ref(1)
const readStartAddr = ref(0)
const readQuantity = ref(10)
const readFormat = ref<'uint16' | 'int16' | 'uint32' | 'float32'>('uint16')
const reading = ref(false)
const readResult = ref<number[]>([])

// ===== 写寄存器参数 =====
const writeMode = ref<'single' | 'multiple'>('single')
const writeSlaveId = ref(1)
const writeStartAddr = ref(0)
const singleWriteValue = ref(0)
const multiWriteValue = ref('')
const writing = ref(false)

// ===== 自定义指令 =====
const customCommand = ref('')

// 读寄存器
async function doReadRegisters() {
  reading.value = true
  try {
    const req = readHoldingRegisters(readSlaveId.value, readStartAddr.value, readQuantity.value)
    emit('send', Array.from(req.raw))
    ElMessage.success(`已发送读寄存器指令: ${frameToHex(req.raw)}`)
  } finally {
    reading.value = false
  }
}

// 写寄存器
async function doWriteRegister() {
  writing.value = true
  try {
    let req
    if (writeMode.value === 'single') {
      req = writeSingleRegister(writeSlaveId.value, writeStartAddr.value, singleWriteValue.value)
    } else {
      const values = multiWriteValue.value.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v))
      if (values.length === 0) {
        ElMessage.warning('请输入有效的寄存器值')
        return
      }
      if (values.length > 123) {
        ElMessage.warning('最多写入123个寄存器')
        return
      }
      req = writeMultipleRegisters(writeSlaveId.value, writeStartAddr.value, values)
    }
    emit('send', Array.from(req.raw))
    ElMessage.success(`已发送写寄存器指令: ${frameToHex(req.raw)}`)
  } finally {
    writing.value = false
  }
}

// 发送自定义指令
function doSendCustom() {
  const hex = customCommand.value.trim().replace(/\s+/g, ' ')
  const bytes = hex.split(' ').map(h => parseInt(h, 16)).filter(b => !isNaN(b))
  if (bytes.length === 0) {
    ElMessage.warning('请输入有效的HEX指令')
    return
  }
  emit('send', bytes)
  ElMessage.success(`已发送自定义指令: ${hex}`)
}

// 暴露方法供父组件解析响应
defineExpose({
  parseReadResponse(rawData: number[]) {
    try {
      const buf = Buffer.from(rawData)
      const resp = parseResponse(buf)

      if (resp.valid && resp.functionCode === 0x03) {
        const registers: number[] = []
        for (let i = 0; i < resp.data.length; i += 2) {
          registers.push(resp.data.readUInt16BE(i))
        }
        readResult.value = convertRegisterValues(registers, readFormat.value)
      }
    } catch (err) {
      console.error('解析响应失败:', err)
    }
  }
})
</script>

<style scoped>
.modbus-panel {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #f0f1f2;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #2a2e34;
}

.panel-title .el-icon {
  color: #00BFA5;
}

.modbus-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.command-section h4 {
  font-size: 13px;
  font-weight: 500;
  color: #b0b4ba;
  margin-bottom: 8px;
}

.form-group {
  margin-bottom: 4px;
}

.form-group > label {
  display: block;
  font-size: 12px;
  color: #6a6e74;
  margin-bottom: 2px;
}

.form-row {
  display: flex;
  gap: 8px;
}

.result-box {
  margin-top: 12px;
  background: #0c0e10;
  border: 1px solid #2a2e34;
  border-radius: 6px;
  padding: 10px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: #8a8e94;
}

.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  background: #1a1e24;
  border-radius: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.reg-addr {
  color: #00BFA5;
}

.reg-val {
  color: #f0f1f2;
  font-weight: 500;
}
</style>
