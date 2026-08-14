<template>
  <div class="tpc">
    <div class="tpc-head">
      <div class="tpc-title">天一 BMS 参数下发</div>
      <div class="tpc-actions">
        <span class="tpc-proto">Modbus-RTU · 从机 0x{{ slaveHex }}</span>
        <button class="btn" :disabled="!connected || reading" @click="loadGroup(activeTab)">
          {{ reading ? '读取中…' : '读取当前' }}
        </button>
        <button class="btn btn-primary" :disabled="!connected || writing || dirtyCount(activeTab) === 0" @click="writeAll">
          写入全部已修改 ({{ dirtyCount(activeTab) }})
        </button>
      </div>
    </div>

    <div class="tpc-tabs">
      <button
        v-for="g in GROUP_META"
        :key="g.key"
        class="tpc-tab"
        :class="{ active: activeTab === g.key }"
        :title="g.hint"
        @click="activeTab = g.key"
      >
        {{ g.title }}
      </button>
    </div>

    <div class="tpc-body">
      <div v-if="!connected" class="tpc-empty">请先在「设备连接」建立串口连接，再读取 / 下发参数。</div>

      <template v-else>
        <!-- 控制页（写专用） -->
        <div v-if="activeTab === 'control'" class="ctrl-grid">
          <div v-for="def in paramsOf('control')" :key="def.reg" class="ctrl-card">
            <div class="ctrl-name">{{ def.label }}</div>
            <div class="ctrl-reg num">0x{{ def.reg.toString(16).toUpperCase() }}</div>
            <div class="ctrl-hint">{{ def.hint }}</div>
            <button class="btn btn-danger" @click="writeControl(def)">执行（写 0x0001）</button>
          </div>
        </div>

        <!-- 参数表 -->
        <div v-else class="param-table">
          <div class="pt-head">
            <span class="c-name">参数</span>
            <span class="c-var">变量</span>
            <span class="c-cur">当前值</span>
            <span class="c-edit">修改值</span>
            <span class="c-unit">单位</span>
            <span class="c-range">范围 / 说明</span>
            <span class="c-op">操作</span>
          </div>
          <div
            v-for="def in paramsOf(activeTab)"
            :key="def.reg"
            class="pt-row"
            :class="{ dirty: isDirty(def) }"
          >
            <span class="c-name">{{ def.label }}</span>
            <span class="c-var num">{{ def.name }}</span>
            <span class="c-cur num">{{ curDisplay(def) }}</span>
            <span class="c-edit">
              <el-select
                v-if="def.options"
                v-model="editMap[def.reg]"
                size="small"
                class="cell-select"
              >
                <el-option
                  v-for="o in def.options"
                  :key="o.value"
                  :label="o.label"
                  :value="String(o.value)"
                />
              </el-select>
              <input
                v-else
                class="cell-input num"
                v-model="editMap[def.reg]"
                :placeholder="curDisplay(def)"
              />
            </span>
            <span class="c-unit">{{ def.unit || '' }}</span>
            <span class="c-range">
              {{ rangeText(def) }}<span v-if="def.hint" class="ph"> · {{ def.hint }}</span>
            </span>
            <span class="c-op">
              <button class="btn btn-sm" :disabled="!isDirty(def) || writing" @click="writeOne(def)">写入</button>
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PARAM_DEFS, GROUP_READ, GROUP_META, paramsOf,
  rawToDisplay, displayToRaw, formatDisplay,
  type TianyiParamDef, type TianyiGroup,
} from '../tianyi/tianyi-params'
import { tianyiBus } from '../tianyi/tianyi-bus'
import { buildReadHoldingRegisters, buildWriteSingleRegister, readU16, type ModbusFrame } from '../tianyi/tianyi-protocol'
import { ui } from '../store'

const props = defineProps<{ connected: boolean }>()

const slave = computed(() => ui.slaveAddr)
const slaveHex = computed(() => slave.value.toString(16).padStart(2, '0').toUpperCase())

const activeTab = ref<TianyiGroup>('config')
const rawMap = reactive<Record<number, number>>({})
const editMap = reactive<Record<number, string>>({})
const reading = ref(false)
const writing = ref(false)

function defKey(def: TianyiParamDef): number { return def.reg }

function curDisplay(def: TianyiParamDef): string {
  const raw = rawMap[defKey(def)]
  return raw === undefined ? '--' : formatDisplay(def, raw)
}

function isDirty(def: TianyiParamDef): boolean {
  const raw = rawMap[defKey(def)]
  if (raw === undefined) return false
  return editMap[defKey(def)] !== formatDisplay(def, raw)
}

function dirtyCount(group: TianyiGroup): number {
  return paramsOf(group).filter((d) => isDirty(d)).length
}

function rangeText(def: TianyiParamDef): string {
  if (def.options) return '枚举'
  if (def.min !== undefined && def.max !== undefined) return `${def.min}–${def.max}`
  return '0–65535'
}

// ===== 读取整组 =====
async function loadGroup(group: TianyiGroup) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  if (group === 'control') return // 控制区只读专用，无需读取
  const range = GROUP_READ[group]
  if (!range) return
  reading.value = true
  try {
    const frame = await tianyiBus.sendAck(buildReadHoldingRegisters(slave.value, range.start, range.count))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`读取失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
      return
    }
    const defs = paramsOf(group)
    for (const def of defs) {
      const idx = def.reg - range.start
      if (idx < 0) continue
      const byteOff = idx * 2
      if (byteOff + 1 >= frame.data.length) continue
      const raw = readU16(frame.data, byteOff)
      rawMap[def.reg] = raw
      editMap[def.reg] = formatDisplay(def, raw)
    }
    ElMessage.success(`已读取 ${group} 区 ${defs.length} 项`)
  } catch (e: any) {
    ElMessage.error('读取异常：' + (e?.message || e))
  } finally {
    reading.value = false
  }
}

// ===== 单条写入 =====
async function writeOne(def: TianyiParamDef) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  const key = defKey(def)
  const raw = rawMap[key]
  if (raw === undefined) { ElMessage.warning('请先读取当前值'); return }

  let value: number
  if (def.options) {
    value = parseInt(editMap[key], 10)
    if (!Number.isFinite(value)) { ElMessage.error(`${def.label}：取值无效`); return }
  } else {
    const v = parseFloat(editMap[key])
    if (!Number.isFinite(v)) { ElMessage.error(`${def.label}：请输入有效数字`); return }
    if (def.min !== undefined && v < def.min) { ElMessage.error(`${def.label}：低于最小值 ${def.min}`); return }
    if (def.max !== undefined && v > def.max) { ElMessage.error(`${def.label}：超出最大值 ${def.max}`); return }
    value = displayToRaw(def, v)
  }

  // 保护 / 校准为高风险区，写前二次确认
  if (def.group === 'protect' || def.group === 'calib') {
    try {
      await ElMessageBox.confirm(
        `确认将「${def.label}」(${def.name}) 写入为 ${def.options ? editMap[key] : editMap[key] + (def.unit ? ' ' + def.unit : '')}？`,
        '写参数确认',
        { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消' },
      )
    } catch {
      return // 用户取消
    }
  }

  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`写入失败：${frame.timeout ? '超时无响应' : '设备异常应答 0x' + (frame.exceptionCode ?? 0).toString(16)}`)
      return
    }
    rawMap[key] = value
    editMap[key] = formatDisplay(def, value)
    ElMessage.success(`已写入 ${def.label}`)
  } catch (e: any) {
    ElMessage.error('写入异常：' + (e?.message || e))
  } finally {
    writing.value = false
  }
}

// ===== 批量写入当前页已修改 =====
async function writeAll() {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  const defs = paramsOf(activeTab.value).filter((d) => isDirty(d))
  if (!defs.length) return
  writing.value = true
  let ok = 0
  let fail = 0
  for (const def of defs) {
    const key = defKey(def)
    let value: number
    if (def.options) {
      value = parseInt(editMap[key], 10)
    } else {
      const v = parseFloat(editMap[key])
      if (!Number.isFinite(v) || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) {
        fail++; continue
      }
      value = displayToRaw(def, v)
    }
    try {
      const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, value))
      if (frame.timeout || frame.exception) { fail++; continue }
      rawMap[key] = value
      editMap[key] = formatDisplay(def, value)
      ok++
    } catch {
      fail++
    }
  }
  writing.value = false
  if (fail === 0) ElMessage.success(`已写入全部 ${ok} 项`)
  else ElMessage.warning(`完成：成功 ${ok} / 失败 ${fail}`)
}

// ===== 控制类写专用（RESET / RECOVERY）=====
async function writeControl(def: TianyiParamDef) {
  if (!props.connected) { ElMessage.warning('请先连接串口'); return }
  try {
    await ElMessageBox.confirm(
      `确认执行「${def.label}」？${def.hint || ''}`,
      '控制指令确认',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  writing.value = true
  try {
    const frame = await tianyiBus.sendAck(buildWriteSingleRegister(slave.value, def.reg, 0x0001))
    if (frame.timeout || frame.exception) {
      ElMessage.error(`执行失败：${frame.timeout ? '超时无响应' : '设备异常应答'}`)
      return
    }
    ElMessage.success(`已执行 ${def.label}`)
  } catch (e: any) {
    ElMessage.error('执行异常：' + (e?.message || e))
  } finally {
    writing.value = false
  }
}

// 切换页签 / 连接建立后自动读取当前页
watch(activeTab, (g) => { if (props.connected) loadGroup(g) })
watch(() => props.connected, (c) => { if (c) loadGroup(activeTab.value) })
</script>

<style scoped>
.tpc { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-6); min-height: 0; overflow-y: auto; }
.tpc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.tpc-title { font-size: var(--fs-h3); font-weight: var(--fw-semibold); color: var(--text-primary); }
.tpc-actions { display: flex; align-items: center; gap: var(--space-4); }
.tpc-proto { font-size: var(--fs-caption); color: var(--text-tertiary); font-family: var(--font-mono); }

.tpc-tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--border-default); flex-wrap: wrap; }
.tpc-tab {
  padding: var(--space-3) var(--space-5); background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--text-secondary); cursor: pointer;
  font-size: var(--fs-body-sm); font-weight: var(--fw-medium);
}
.tpc-tab:hover { color: var(--text-primary); }
.tpc-tab.active { color: var(--text-primary); border-bottom-color: var(--brand); font-weight: var(--fw-semibold); }

.tpc-body { flex: 1; min-height: 0; }
.tpc-empty {
  padding: var(--space-8); text-align: center; color: var(--text-tertiary);
  background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-md);
}

/* 参数表 */
.param-table { display: flex; flex-direction: column; border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden; }
.pt-head, .pt-row {
  display: grid;
  grid-template-columns: 1.4fr 1.4fr 1fr 1.3fr 0.7fr 2.2fr 0.9fr;
  align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.pt-head { background: var(--bg-base); border-bottom: 1px solid var(--border-default); font-size: var(--fs-caption); color: var(--text-tertiary); font-weight: var(--fw-semibold); }
.pt-row { border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface); }
.pt-row:last-child { border-bottom: none; }
.pt-row.dirty { background: var(--warning-bg); }
.c-name { font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: var(--fw-medium); }
.c-var { font-size: var(--fs-caption); color: var(--text-tertiary); }
.c-cur { font-size: var(--fs-body-sm); color: var(--text-primary); }
.c-unit { font-size: var(--fs-caption); color: var(--text-tertiary); }
.c-range { font-size: var(--fs-caption); color: var(--text-secondary); }
.c-range .ph { color: var(--warning); }
.cell-input {
  width: 100%; height: 28px; padding: 0 var(--space-3);
  background: var(--bg-canvas); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-body-sm);
}
.cell-input:focus { outline: none; border-color: var(--brand); }
.cell-select { width: 100%; }
.c-op { display: flex; justify-content: flex-end; }

/* 控制页 */
.ctrl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-5); }
.ctrl-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--space-5); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md);
}
.ctrl-name { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ctrl-reg { font-size: var(--fs-caption); color: var(--text-tertiary); }
.ctrl-hint { font-size: var(--fs-caption); color: var(--warning); flex: 1; }

/* 按钮 */
.btn {
  height: 30px; padding: 0 var(--space-4); border-radius: var(--radius-sm);
  background: var(--bg-canvas); border: 1px solid var(--border-default); color: var(--text-secondary);
  font-size: var(--fs-caption); cursor: pointer; white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-strong); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--brand-bg-subtle); border-color: var(--brand); color: var(--brand-text); font-weight: var(--fw-semibold); }
.btn-primary:hover:not(:disabled) { background: var(--brand-bg); }
.btn-sm { height: 26px; padding: 0 var(--space-3); }
.btn-danger { background: var(--critical-bg); border-color: var(--critical-border); color: var(--critical); font-weight: var(--fw-semibold); }
.btn-danger:hover:not(:disabled) { background: var(--critical-bg); filter: brightness(1.15); }
</style>
