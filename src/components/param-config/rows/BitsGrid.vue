<!--
  BitsGrid — 位开关栅格（功能配置 / NTC 配置）+ 组内「应用」整字下发按钮
  从 JbdParamConfig 抽出（2026-11-19 组件化）：逻辑直连 useDispatch 单例，样式随迁。
-->
<template>
  <div class="bits">
    <label
      v-for="f in group.fields.filter(isBitSwitch)"
      :key="f.key ?? f.label"
      class="chk"
      :class="{ 'chk-dirty': f.dirty }"
    >
      <input
        type="checkbox"
        :checked="!!f.value"
        :disabled="!connected || f.status === 'reading'"
        @change="onChkChange(f, $event)"
      >
      <span class="bx"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></span>
      {{ f.label }}
    </label>
    <span
      v-for="f in group.fields.filter((x) => !isBitSwitch(x) && x.readOnly)"
      :key="'ro-' + (f.key ?? f.label)"
      class="ro-note"
    >{{ f.label }}：只读{{ f.note ? `（${f.note}）` : '' }}</span>
  </div>
  <div v-if="group.action" class="gact">
    <button class="btn primary sm" :disabled="!dispatchAllowedNow || busy" @click="writeGroupBitmap(group, group.action.bitIndex)">
      ⟶ {{ group.action.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDispatch, dispatchAuthSession } from '../useDispatch'
import { canDispatchParameters } from '@/auth/auth'
import type { FieldState, GroupObj } from '../types'

defineProps<{ group: GroupObj; busy: boolean; connected: boolean }>()

const d = useDispatch()
const { isBitSwitch, onBitChange, writeGroupBitmap } = d

/** 位开关复选框：先写 f.value 再同步镜像寄存器对应位 */
function onChkChange(f: FieldState, e: Event) {
  f.value = (e.target as HTMLInputElement).checked
  onBitChange(f)
}

const dispatchAllowedNow = computed(() => canDispatchParameters(d.j.connected.value, dispatchAuthSession.value))
</script>

<style scoped>
/* ===== bits 位开关栅格（两列，窄列下防标签换行） ===== */
.bits {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px 8px;
  padding: 4px 0;
}
.bits .chk { white-space: nowrap; }
.gact {
  display: flex;
  justify-content: center;
  padding: 3px 0 2px;
  border-top: 1px dashed var(--border);
  margin-top: 4px;
}

/* ===== 复选框 ===== */
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--t2);
  font-size: 12.5px;
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
.chk .bx svg {
  width: 10px;
  height: 10px;
  stroke: #fff;
  stroke-width: 3;
  fill: none;
  opacity: 0;
}
.chk input:checked + .bx svg { opacity: 1; }
.chk-dirty { color: var(--warn); }
.ro-note { grid-column: 1/-1; color: var(--t3); font-size: 12.5px; }
@media (max-width: 1500px) {
  .bits { grid-template-columns: repeat(3, 1fr); }
}
</style>
