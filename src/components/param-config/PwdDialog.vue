<!--
  PwdDialog — 下发口令弹窗（引擎驱动：useDispatch 单例状态，参数配置/产线下发/模板共用）
  从 App.vue 抽出（2026-11-19 组件化）：无 props，直接读引擎弹窗状态。
-->
<template>
  <div v-if="pwdVisible" class="pd-mask" @click.self="onPwdCancel()">
    <div class="pd-dlg">
      <h3>{{ pwdTitle }}</h3>
      <div class="pd-tip">{{ pwdHint }}</div>
      <input
        v-model="pwdInput"
        type="password"
        placeholder="请输入下发密码"
        @keyup.enter="onPwdConfirm()"
      >
      <div v-if="pwdError" class="pd-err">{{ pwdError }}</div>
      <div class="pd-ft">
        <button class="btn" @click="onPwdCancel()">取消</button>
        <button class="btn primary" @click="onPwdConfirm()">{{ pwdConfirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  pwdVisible, pwdInput, pwdError, pwdTitle, pwdHint, pwdConfirmText,
  onPwdConfirm, onPwdCancel,
} from './useDispatch'
</script>

<style scoped>
.pd-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pd-dlg {
  width: 340px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pd-dlg h3 { font-size: 14.5px; color: var(--t1); }
.pd-tip { color: var(--t2); font-size: 12px; line-height: 1.6; }
.pd-dlg input {
  background: var(--inset);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  font-size: 12.5px;
  outline: none;
  font-family: var(--mono);
}
.pd-dlg input:focus { border-color: var(--brand); background: var(--surface); }
.pd-err { color: var(--err); font-size: 12px; }
.pd-ft { display: flex; justify-content: flex-end; gap: 8px; }
</style>
