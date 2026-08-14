<template>
  <div class="jbd-panel">
    <!-- ============ MOS 控制 ============ -->
    <section class="panel sec">
      <header class="sec-h"><span class="panel-title"><el-icon><Switch /></el-icon> MOS 控制</span></header>
      <div class="sec-b">
        <div class="mos-row">
          <div class="mos-item">
            <span>充电 MOS</span>
            <el-switch :model-value="basicInfo?.fet.charge ?? false" :disabled="!connected"
              active-text="开" inactive-text="关" @change="(v: any) => setMos(MOS_TYPE.CHARGE, v)" />
          </div>
          <div class="mos-item">
            <span>放电 MOS</span>
            <el-switch :model-value="basicInfo?.fet.discharge ?? false" :disabled="!connected"
              active-text="开" inactive-text="关" @change="(v: any) => setMos(MOS_TYPE.DISCHARGE, v)" />
          </div>
          <div class="mos-item btn-group">
            <el-button size="small" :disabled="!connected" @click="setMosBoth(false)">全部关闭</el-button>
            <el-button size="small" type="primary" :disabled="!connected" @click="setMosBoth(true)">全部打开</el-button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 控制指令 ============ -->
    <section class="panel sec">
      <header class="sec-h"><span class="panel-title"><el-icon><MagicStick /></el-icon> 控制指令 (0x0A)</span></header>
      <div class="sec-b">
        <div class="btn-grid">
          <el-button v-for="c in controlButtons" :key="c.label" size="small" :disabled="!connected" @click="runControl(c.fn)">{{ c.label }}</el-button>
        </div>
      </div>
    </section>

    <!-- ============ 参数读写 ============ -->
    <section class="panel sec">
      <header class="sec-h">
        <span class="panel-title"><el-icon><Setting /></el-icon> 参数读写 (0xFA)</span>
        <StatusBadge :status="inFactory ? 'brand' : 'neutral'" :label="inFactory ? '工厂模式' : '普通模式'" />
      </header>
      <div class="sec-b">
        <div class="param-row">
          <el-button size="small" :type="inFactory ? 'success' : 'primary'" :disabled="!connected" @click="enterFactory">进入工厂模式</el-button>
          <el-button size="small" :disabled="!connected || !inFactory" @click="exitFactory">退出工厂模式</el-button>
        </div>

        <el-divider content-position="left">读取</el-divider>
        <div class="param-row">
          <el-select v-model="paramReg" size="small" filterable placeholder="选择参数" style="flex: 1" :disabled="!connected">
            <el-option v-for="p in PARAM_TABLE" :key="p.index" :label="`[${p.index}] ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`" :value="p.index" />
          </el-select>
          <el-input-number v-model="paramCount" :min="1" :max="95" size="small" controls-position="right" style="width: 110px" />
          <el-button size="small" type="primary" :disabled="!connected" @click="readParam">读取</el-button>
        </div>
        <div v-if="paramResult" class="param-result">
          <div>寄存器 [{{ paramRegText }}] {{ paramNameText }}：</div>
          <div class="mono">原始: {{ paramRawHex }}</div>
          <div class="mono" v-if="paramDisplayText">数值: {{ paramDisplayText }} {{ paramUnitText }}</div>
          <div class="mono" v-if="paramAsciiText">ASCII: {{ paramAsciiText }}</div>
        </div>

        <el-divider content-position="left">写入（需工厂模式）</el-divider>
        <div class="param-row">
          <el-select v-model="paramWriteReg" size="small" filterable placeholder="选择参数" style="flex: 1" :disabled="!connected">
            <el-option v-for="p in writableParams" :key="p.index" :label="`[${p.index}] ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}`" :value="p.index" />
          </el-select>
          <el-input-number v-model="paramWriteVal" :min="0" :max="65535" size="small" controls-position="right" style="width: 140px" />
          <el-button size="small" type="warning" :disabled="!connected" @click="writeParam">写入</el-button>
        </div>
        <div class="tip">写入会自动进入→写→退出工厂模式；ASCII 类参数请通过读取查看。</div>
      </div>
    </section>

    <!-- ============ 密码 ============ -->
    <section class="panel sec">
      <header class="sec-h"><span class="panel-title"><el-icon><Lock /></el-icon> 密码</span></header>
      <div class="sec-b">
        <div class="pwd-block">
          <div class="pwd-title">工厂密码 (0x0B)</div>
          <div class="param-row">
            <el-input-number v-model="oldPwd" :min="0" :max="65535" size="small" controls-position="right" style="width: 150px" />
            <span class="tip">原密码(默认0x5678)</span>
            <el-input-number v-model="newPwd" :min="0" :max="65535" size="small" controls-position="right" style="width: 150px" />
            <span class="tip">新密码</span>
            <el-button size="small" :disabled="!connected" @click="modifyFactoryPwd">修改</el-button>
          </div>
          <div class="param-row">
            <el-button size="small" :disabled="!connected" @click="clearFactoryPwd">清除(恢复默认0x5678)</el-button>
          </div>
        </div>
        <el-divider />
        <div class="pwd-block">
          <div class="pwd-title">蓝牙密码</div>
          <div class="param-row">
            <el-input v-model="btOld" size="small" type="password" show-password placeholder="原密码6位" style="width: 140px" />
            <el-input v-model="btNew" size="small" type="password" show-password placeholder="新密码6位" style="width: 140px" />
          </div>
          <div class="param-row">
            <el-button size="small" :disabled="!connected || !btNew" @click="btPair">配对(设密码)</el-button>
            <el-button size="small" :disabled="!connected || !btOld || !btNew" @click="btModify">修改密码</el-button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 加热控制 ============ -->
    <section class="panel sec">
      <header class="sec-h"><span class="panel-title"><el-icon><Sunny /></el-icon> 加热控制 (0xFC)</span></header>
      <div class="sec-b">
        <div class="param-row">
          <span class="tip">启动温度</span>
          <el-input-number v-model="heatStartTemp" :min="-127" :max="127" size="small" controls-position="right" style="width: 120px" />
          <span class="tip">停止温度</span>
          <el-input-number v-model="heatStopTemp" :min="-127" :max="127" size="small" controls-position="right" style="width: 120px" />
          <el-button size="small" type="warning" :disabled="!connected" @click="heatStart">启动加热</el-button>
          <el-button size="small" :disabled="!connected" @click="heatStop">停止加热</el-button>
        </div>
      </div>
    </section>

    <!-- ============ 指令响应 ============ -->
    <section class="panel sec">
      <header class="sec-h"><span class="panel-title">最近指令响应</span></header>
      <div class="sec-b">
        <div v-if="!ackHistory.length" class="tip">暂无</div>
        <div v-for="(a, i) in ackHistory" :key="i" class="ack-line mono">{{ a }}</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  Switch, MagicStick, Setting, Lock, Sunny,
} from '@element-plus/icons-vue'
import StatusBadge from './StatusBadge.vue'
import { useJbd } from '@/jbd/useJbd'
import { MOS_TYPE } from '@/jbd/jbd-protocol'
import { PARAM_TABLE } from '@/jbd/jbd-params'

const {
  connected, basicInfo,
  inFactory, paramReg, paramCount, paramWriteReg, paramWriteVal,
  oldPwd, newPwd, btOld, btNew,
  heatStartTemp, heatStopTemp,
  paramResult, paramRegText, paramNameText, paramRawHex, paramDisplayText, paramAsciiText, paramUnitText,
  writableParams, ackHistory,
  setMos, setMosBoth, controlButtons, runControl,
  enterFactory, exitFactory, readParam, writeParam,
  modifyFactoryPwd, clearFactoryPwd, btPair, btModify,
  heatStart, heatStop,
} = useJbd()
</script>

<style scoped>
.jbd-panel {
  height: 100%;
  min-height: 0;
  padding: var(--space-6);
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.jbd-panel > * { min-width: 0; }

.sec { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.sec-h {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-default);
}
.sec-b { padding: var(--space-5); }

.btn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.tip { font-size: var(--fs-caption); color: var(--text-tertiary); }

.mos-row { display: flex; gap: var(--space-8); align-items: center; flex-wrap: wrap; }
.mos-item { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--fs-body-sm); color: var(--text-secondary); }
.btn-group { flex-direction: row; gap: var(--space-3); }

.param-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-3); }
.param-result { background: var(--bg-inset); border: 1px solid var(--border-default); border-radius: var(--radius-sm); padding: var(--space-3) var(--space-4); font-size: var(--fs-body-sm); color: var(--text-secondary); }
.param-result .mono { word-break: break-all; margin-top: var(--space-1); }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; }

.pwd-block { margin-bottom: var(--space-4); }
.pwd-title { font-size: var(--fs-body-sm); color: var(--text-secondary); margin-bottom: var(--space-3); }

.ack-line { font-size: var(--fs-caption); color: var(--text-secondary); padding: var(--space-1) 0; border-bottom: 1px solid var(--border-subtle); word-break: break-all; }
</style>
