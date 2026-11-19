<!--
  JbdParamConfig — 参数配置页（对齐嘉佰达 JBDTools 参数设置页，2026-11-19 真机核验）
  布局：顶部操作行（读取|写入|导入|导出）+ 三列分组（46/27/27：基本参数+高级保护 | NTC/均衡/功能/其他 | 容量配置），窗口缩窄自动降列。
  指令：读取=芯片+九段读；写入=进工厂+九段写+退工厂（整包 11 帧）；
  导入/导出=.fig 参数文件（JBDTools 同款 Alf-*.fig）；检流电阻唯一例外（口令单独下发）。
-->
<template>
  <div class="page-config">
    <!-- ===== 顶部操作行（读取 | 写入 | 导入 | 导出 + 状态/进度） ===== -->
    <div class="actionbar">
      <button class="opbtn" :disabled="!connected || busy" @click="readAll">读取参数</button>
      <button class="opbtn primary" :disabled="!dispatchAllowedNow || busy" @click="writeAll">写入参数</button>
      <button class="opbtn" :disabled="busy" @click="triggerImportFile">导入参数</button>
      <button class="opbtn" :disabled="busy" @click="exportParams">导出参数</button>
      <button class="opbtn danger" :disabled="!dispatchAllowedNow || busy" title="发送复位 MCU 指令，设备将重新启动" @click="confirmResetMcu">复位MCU</button>
      <input ref="fileInput" type="file" accept=".fig,.json" style="display:none" @change="onNativeFileChange">
      <span v-if="importedSourceName" class="ab-note num" :title="importedSourceName">{{ importedSourceName }}</span>
      <div v-if="busy" class="op-progress">
        <div class="pbar"><i :style="{ width: progress + '%' }" /></div>
        <span class="num">{{ segNote }}</span>
      </div>
      <span v-else-if="dirtyCount" class="ab-note warn-note">待写入 {{ dirtyCount }} 项改动</span>
    </div>

    <!-- ===== 主体：三列分组（46/27/27），窗口缩窄自动降列 ===== -->
    <div class="cfg-main">
      <div class="cfg-cols">
        <div v-for="(colArr, ci) in columns" :key="ci" class="cfg-col">
          <div v-for="g in colArr" :key="g.title" class="gbox">
            <div class="hd">
              <span class="t">{{ g.title }}</span>
            </div>

            <!-- triple：基本参数（保护 / 释放 / 延时） -->
            <div v-if="g.layout === 'triple'" class="bd">
              <TripleRows :rows="tripleRows(g.fields)" :busy="busy" />
            </div>

            <!-- bits：功能配置 / NTC 配置 -->
            <div v-else-if="g.layout === 'bits'" class="bd">
              <BitsGrid :group="g" :busy="busy" :connected="connected" />
            </div>

            <!-- rows：单字段行（ASCII/检流电阻带下发按钮；数值随整包写入） -->
            <div v-else class="bd" :class="{ pair: g.pair }">
              <RowsBody :fields="g.fields" :busy="busy" :connected="connected" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { canDispatchParameters } from '@/auth/auth'
import { useDispatch, dispatchAuthSession } from './param-config/useDispatch'
import TripleRows from './param-config/rows/TripleRows.vue'
import BitsGrid from './param-config/rows/BitsGrid.vue'
import RowsBody from './param-config/rows/RowsBody.vue'

const d = useDispatch()
const {
  j, busy, progress, segNote, dirtyCount, columns, tripleRows, importedSourceName,
  readAll, writeAll, confirmResetMcu,
  onFileChange, confirmThenExportConfig,
} = d

const connected = computed(() => j.connected.value)
const dispatchAllowedNow = computed(() => canDispatchParameters(connected.value, dispatchAuthSession.value))

// ===== 导入参数（.fig / .json）与导出参数（.fig，JBDTools 同款）=====
const fileInput = ref<HTMLInputElement | null>(null)
function triggerImportFile() { fileInput.value?.click() }
function onNativeFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) onFileChange({ raw: file })
  input.value = ''
}
/** 导出参数：先密码校验（tyln@1688，与检流阻值下发同源），通过后写 .fig 文件 */
function exportParams() { confirmThenExportConfig() }
</script>

<style scoped>
.page-config {
  letter-spacing: 1px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== 顶部操作行 + 三列主体 ===== */
.cfg-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 4px;
}
/* 三列固定分组（对齐 JBDTools 46/27/27），窗口缩窄自动降列 */
.cfg-cols {
  display: grid;
  grid-template-columns: 46fr 27fr 27fr;
  gap: 8px;
  align-items: start;
}
/* 列内 flex-wrap：整宽卡片 basis 100% */
.cfg-col {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  align-items: flex-start;
}
.cfg-col .gbox { flex: 1 1 100%; min-width: 0; }
.cfg-col .gbox.half { flex: 1 1 calc(50% - 6px); }

.gbox {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.gbox > .hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--inset);
}
.gbox > .hd .t { font-weight: 700; font-size: 14px; color: var(--t1); }
.bd { padding: 3px 14px 5px; }
/* pair：组内字段两两一行（高级保护/均衡/容量）。宽屏两两一行；窄窗口退回单列（pair 格在 27% 窄列里会挤爆输入框） */
.bd.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14px;
}
@media (max-width: 1500px) {
  .bd.pair { display: block; }
}

/* 三列布局相关行样式已随组件化迁至 param-config/rows/ 子组件 */
/* rows 组内部两列（容量配置 SOC 表）：普通行整行，SOC 百分比行半宽两列 */
.gbox.twocol .bd {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14px;
}


/* ===== chips ===== */
.chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.chip.ok { background: var(--ok-weak); color: var(--ok); }
.chip.gray { background: var(--inset); color: var(--t2); }

/* ===== 顶部操作行（横排大按钮，白底 / 写入品牌蓝） ===== */
.actionbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 6px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 6px;
}
.ab-note { color: var(--t3); font-size: 12.5px; white-space: nowrap; }
.warn-note { color: var(--warn); }
.opbtn {
  height: 34px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--t1);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow);
  transition: border-color 0.12s, filter 0.12s;
}
.opbtn:hover:not(:disabled) { border-color: var(--brand); }
.opbtn.primary { background: var(--brand); border-color: var(--brand); color: var(--text-on-brand); }
.opbtn.danger { background: var(--err); border-color: var(--err); color: var(--text-on-brand); }
.opbtn.danger:hover:not(:disabled) { border-color: var(--err); filter: brightness(1.06); }
.opbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.op-progress { display: flex; flex-direction: column; gap: 4px; flex: 1; max-width: 320px; color: var(--t3); font-size: 10.5px; line-height: 1.4; }
.op-progress .pbar { flex: 0 0 auto; }
.pbar {
  height: 6px;
  border-radius: 4px;
  background: var(--inset);
  overflow: hidden;
}
.pbar > i {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: 4px;
  transition: width 0.3s;
}

.page-config :deep(.btn.sm) { padding: 4px 9px; white-space: nowrap; }

/* 窗口缩窄自动降列；操作行允许换行 */
@media (max-width: 1140px) {
  .cfg-cols { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 880px) {
  .cfg-cols { grid-template-columns: 1fr; }
  .actionbar { flex-wrap: wrap; }
}
</style>
