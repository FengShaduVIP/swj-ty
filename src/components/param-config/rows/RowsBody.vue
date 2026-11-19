<!--
  RowsBody — 单字段行（ASCII / 日期 / scd 下拉 / 数值 / 只读展示）+ 行内下发按钮
  从 JbdParamConfig 抽出（2026-11-19 组件化）：逻辑直连 useDispatch 单例，样式随迁。
  数字输入带编辑态（numDisplay/onNumEdit）：输入中显示原文，防格式化回显吞小数点。
-->
<template>
  <div
    v-for="f in fields"
    :key="f.key ?? f.label"
    class="frow"
    :class="{ dirty: f.dirty, okline: f.status === 'ok', errline: f.status === 'fail' }"
  >
    <!-- 位开关（如 过流及短路保护值翻倍） -->
    <label v-if="f.bitIndex !== undefined" class="chk" :class="{ 'chk-dirty': f.dirty }">
      <input type="checkbox" :checked="!!f.value" :disabled="busy" @change="onChkChange(f, $event)">
      <span class="bx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></span>
      {{ f.label }}
    </label>
    <template v-else>
        <span class="lb" :title="f.label">{{ f.label }}<template v-if="f.needPassword"> 🔒</template></span>

    <!-- ASCII 字段（制造商 / BMS编码 / 条形码） -->
    <input
      v-if="f.ascii && !isReadOnly(f)"
      type="text"
      class="finput"
      :value="f.value ?? ''"
      :maxlength="(f.ascii_len ?? 8) * 2 - 1"
      :disabled="busy"
      placeholder="—"
      @input="onAsciiInput(f, ($event.target as HTMLInputElement).value)"
    >
    <span v-else-if="f.ascii" class="ro">{{ f.value != null && f.value !== '' ? f.value : '—' }}</span>

    <!-- 生产日期 -->
    <input
      v-else-if="f.customDisplay === 'date'"
      type="date"
      class="finput"
      :value="dateInputText(f)"
      min="2000-01-01"
      max="2127-12-31"
      :disabled="!connected || busy"
      @change="onDateInput(f, ($event.target as HTMLInputElement).value)"
    >

    <!-- 自定义展示 / 只读 -->
    <span v-else-if="f.customDisplay" class="ro">{{ customDisplayValue(f) }}</span>
    <span v-else-if="f.readOnly" class="ro">{{ f.index !== undefined && f.value != null ? formatFieldValue(f) + (f.unit ? ' ' + f.unit : '') : '—' }}</span>

    <!-- 下拉（scd 复合档位） -->
    <select
      v-else-if="f.kind === 'scd'"
      class="select"
      :value="f.value ?? ''"
      :disabled="!isChipScdKnown(j.chipType.value) || !connected || busy || f.status === 'reading'"
      @change="onSelectChange(f, ($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="opt in scdOptions(f)"
        :key="opt.value"
        :value="opt.value"
      >{{ opt.label }}</option>
    </select>

    <!-- 普通数值（含检流电阻） -->
    <input
      v-else
      type="number"
      class="finput"
      :value="numDisplay(f)"
      :step="f.step ?? 1"
      :min="f.min"
      :max="f.max"
      :disabled="busy"
      @input="onNumEdit(f, ($event.target as HTMLInputElement).value)"
      @focus="onNumFocus(f)"
      @blur="onNumBlur(f)"
    >

    <span v-if="shouldShowUnit(f)" class="unit">{{ f.unit }}</span>

    <!-- 行内下发：仅 ASCII 块与检流电阻（口令）；数值字段随「写入参数」整包下发 -->
    <button
      v-if="needsWriteBtn(f)"
      class="btn sm primary"
      :disabled="!canWrite(f) || f.status === 'writing'"
      @click="writeField(f)"
    >{{ f.status === 'writing' ? '…' : '下发' }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { isChipScdKnown } from '@/jbd/jbd-params'
import { useDispatch } from '../useDispatch'
import type { FieldState } from '../types'

defineProps<{ fields: FieldState[]; busy: boolean; connected: boolean }>()

const d = useDispatch()
const {
  j, numDisplay, onNumEdit, onNumFocus, onNumBlur, onBitChange,
  formatFieldValue, onAsciiInput, onDateInput, dateInputText,
  customDisplayValue, onSelectChange, scdOptions,
  isReadOnly, shouldShowUnit, canWrite, writeField,
} = d

/** 行内下发按钮：ASCII 块（Set 语义）与检流电阻（口令例外）；数值字段走整包写入 */
/** 位开关复选框：先写 f.value 再同步镜像寄存器对应位 */
function onChkChange(f: FieldState, e: Event) {
  f.value = (e.target as HTMLInputElement).checked
  onBitChange(f)
}

function needsWriteBtn(f: FieldState): boolean {
  if (isReadOnly(f)) return false
  return !!(f.ascii || f.needPassword)
}
</script>

<style scoped>
/* ===== frow 单字段行 ===== */
.frow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px;
  position: relative;
  min-width: 0;
}
.frow .lb {
  flex: 0 0 84px;
  color: var(--t2);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.frow .finput {
  flex: 1;
  min-width: 0;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px 7px;
  font-size: 12.5px;
  outline: none;
  font-family: var(--mono);
}
.frow input:focus { border-color: var(--brand); background: var(--surface); }
.frow .unit { flex: 0 0 28px; color: var(--t3); font-size: 12px; }
.frow .ro {
  flex: 1;
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12.5px;
  text-align: right;
  color: var(--t2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frow.dirty { box-shadow: inset 3px 0 0 var(--warn); }
.frow.dirty .lb { color: var(--warn); }
.frow.okline { box-shadow: inset 3px 0 0 var(--ok); }
.frow.errline { box-shadow: inset 3px 0 0 var(--err); }

/* ===== 复选框（位开关） ===== */
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--t2);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.chk input { display: none; }
.chk .bx {
  width: 15px;
  height: 15px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: 0.12s;
  background: var(--surface);
  flex: 0 0 15px;
}
.chk input:checked + .bx { background: var(--brand); border-color: var(--brand); }
.chk .bx svg { width: 10px; height: 10px; stroke: #fff; stroke-width: 3; fill: none; opacity: 0; }
.chk input:checked + .bx svg { opacity: 1; }
.chk-dirty { color: var(--warn); }

.select {
  appearance: none;
  -webkit-appearance: none;
  flex: 1;
  min-width: 0;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px 24px 2px 7px;
  font-size: 12.5px;
  color: var(--t1);
  outline: none;
  cursor: pointer;
  font-family: var(--mono);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2398a0ac' stroke-width='2.4'><path d='m6 9 6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 7px center;
}
</style>
