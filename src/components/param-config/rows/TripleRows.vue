<!--
  TripleRows — 基本参数三段行（保护 / 释放 / 延时）
  从 JbdParamConfig 抽出（2026-11-19 组件化）：逻辑直连 useDispatch 单例，样式随迁。
  数字输入带编辑态（numDisplay/onNumEdit）：输入中显示原文，防格式化回显吞小数点。
-->
<template>
  <div
    v-for="(row, ri) in rows"
    :key="ri"
    class="triple"
    :class="{ dirty: row.some((f) => f.dirty), okline: row.every((f) => f.status === 'ok'), errline: row.some((f) => f.status === 'fail') }"
  >
    <span class="lead">{{ row[0].label }}</span>
    <input
      type="number"
      :value="numDisplay(row[0])"
      :step="row[0].step ?? 1"
      :disabled="busy"
      @input="onNumEdit(row[0], ($event.target as HTMLInputElement).value)"
      @focus="onNumFocus(row[0])"
      @blur="onNumBlur(row[0])"
    ><span class="u">{{ row[0].unit }}</span>
    <span class="sub">释放</span>
    <input
      type="number"
      :value="numDisplay(row[1])"
      :step="row[1].step ?? 1"
      :disabled="busy"
      @input="onNumEdit(row[1], ($event.target as HTMLInputElement).value)"
      @focus="onNumFocus(row[1])"
      @blur="onNumBlur(row[1])"
    ><span class="u">{{ row[1].unit }}</span>
    <span class="sub">延时</span>
    <input
      type="number"
      :value="numDisplay(row[2])"
      :step="row[2].step ?? 1"
      :disabled="busy"
      @input="onNumEdit(row[2], ($event.target as HTMLInputElement).value)"
      @focus="onNumFocus(row[2])"
      @blur="onNumBlur(row[2])"
    ><span class="u">{{ row[2].unit }}</span>
  </div>
</template>

<script setup lang="ts">
import { useDispatch } from '../useDispatch'
import type { FieldState } from '../types'

defineProps<{ rows: FieldState[][] }>()

const { busy, numDisplay, onNumEdit, onNumFocus, onNumBlur } = useDispatch()
</script>

<style scoped>
.triple {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 24px 40px minmax(0, 1fr) 24px 40px minmax(0, 1fr) 24px;
  gap: 4px;
  align-items: center;
  padding: 3px 0;
}
.triple .lead { font-size: 13px; color: var(--t1); text-align: right; padding-right: 2px; white-space: nowrap; }
.triple .sub { font-size: 12px; color: var(--t3); text-align: right; padding-right: 2px; }
.triple input {
  width: 100%;
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 5px;
  font-size: 13px;
  font-family: var(--mono);
  outline: none;
  text-align: right;
}
.triple input:focus { border-color: var(--brand); background: var(--surface); }
.triple .u { color: var(--t3); font-size: 12px; }
.triple.dirty { box-shadow: inset 3px 0 0 var(--warn); }
.triple.dirty .lead { color: var(--warn); }
.triple.okline { box-shadow: inset 3px 0 0 var(--ok); }
.triple.errline { box-shadow: inset 3px 0 0 var(--err); }
</style>
