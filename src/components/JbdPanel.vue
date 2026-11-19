<!--
  JbdPanel — 实时监测（只读）（基准：design/preview.html 页面 1）
  左列：电池概览（SOC 条 + 6 项读数 + 开关/均衡/保护状态）+ 设备信息 + 保护事件次数
  右列：单体电压栅格（最高/最低/均衡中标记）+ 温度（MOS 圆盘 + 温度条）
  数据全部来自 useJbd 单例（0x03/0x04/0x00 每 2s 轮询 + 保护事件每 5s）。
  页面激活（点开）即全量拉取一次并持续自动更新，无手动按钮。
-->
<template>
  <div class="jbd-panel monitor">
    <!-- ===== 双列主内容 ===== -->
    <div class="mon-grid">
      <!-- ============== 左列 ============== -->
      <div class="colstack">
        <!-- 电池概览 -->
        <div class="card">
          <div class="hd">
            <span class="t">电池概览</span>
            <span class="aux">
              <span class="chip" :class="allNormal ? 'ok' : 'err'">
                {{ allNormal ? '系统正常' : `${activeProtects.length + activeAlarms.length} 条触发` }}
              </span>
            </span>
          </div>
          <div class="bd">
            <div class="soc-wrap">
              <div class="soc-bar"><i :style="{ width: socBarPct + '%' }" :class="socBarCls" /></div>
              <div class="soc-num">{{ rsoc }}<small>%</small></div>
              <div class="soc-tag">{{ socLabel }}</div>
            </div>
            <div class="kv-grid">
              <div class="kv"><div class="k">总电压</div><div class="v">{{ fmt(totalV, 2) }}<small>V</small></div></div>
              <div class="kv"><div class="k">电流</div><div class="v" :class="{ neg: currentA < 0 }">{{ fmt(currentA, 2) }}<small>A</small></div></div>
              <div class="kv"><div class="k">循环次数</div><div class="v">{{ cycleCount }}<small>次</small></div></div>
              <div class="kv"><div class="k">剩余容量</div><div class="v">{{ fmt(remainAh, 2) }}<small>AH</small></div></div>
              <div class="kv"><div class="k">负载功率</div><div class="v" :class="{ neg: powerW < 0 }">{{ fmt(powerW, 2) }}<small>W</small></div></div>
              <div class="kv"><div class="k">满充容量</div><div class="v">{{ fmt(fullChargeAh, 2) }}<small>AH</small></div></div>
            </div>
            <div class="ov-foot">
              <span class="switch-line">充电开关
                <span class="switch"><input type="checkbox" :checked="chargeSwitch" disabled><span class="tk" /></span>
              </span>
              <span class="switch-line">放电开关
                <span class="switch"><input type="checkbox" :checked="dischargeSwitch" disabled><span class="tk" /></span>
              </span>
              <span class="switch-line">均衡状态 <span class="chip" :class="balanceClass">{{ balanceText }}</span></span>
              <span v-if="!allNormal" class="chip-row">
                <span v-for="p in activeProtects" :key="`p-${p}`" class="chip err">{{ p }}</span>
                <span v-for="a in activeAlarms" :key="`a-${a}`" class="chip warn">{{ a }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 设备信息 -->
        <div class="card">
          <div class="hd"><span class="t">设备信息</span></div>
          <div class="bd">
            <div class="kv-grid dev-grid">
              <div class="kv"><div class="k">芯片类型</div><div class="v v-sm">{{ chipTypeName }}</div></div>
              <div class="kv"><div class="k">硬件版本</div><div class="v v-sm">{{ hwVersion || '—' }}</div></div>
              <div class="kv"><div class="k">电池串数</div><div class="v v-sm">{{ cellCount }} <small>串</small></div></div>
              <div class="kv"><div class="k">温度探头</div><div class="v v-sm">{{ temperatures.length }} <small>个</small></div></div>
            </div>
          </div>
        </div>

        <!-- 保护事件次数 -->
        <div class="card">
          <div class="hd">
            <span class="t">保护事件次数</span>
            <span class="aux">
              累计
              <button class="refresh-mini" title="拉取保护事件" @click="readProtect">
                <svg viewBox="0 0 12 12"><path d="M2 6a4 4 0 1 1 1.2 2.83M3 9 2 6 5 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </span>
          </div>
          <div class="bd">
            <div class="evt-grid">
              <div v-for="e in protectList" :key="e.key" class="evt-kv">
                <span class="evt-name">{{ e.label }}</span>
                <span class="evt-count"><span class="num">{{ e.count ?? '-' }}</span> <small>次</small></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============== 右列 ============== -->
      <div class="colstack">
        <!-- 单体电压 -->
        <div class="card">
          <div class="hd">
            <span class="t">单体电压</span>
            <span class="aux">
              <span class="legend">
                <span><i class="lg-info" />最高</span>
                <span><i class="lg-ok" />最低</span>
                <span><i class="lg-eq" />均衡中</span>
              </span>
              <span class="delta-txt num">压差 <b>{{ pressureDiff }}</b> mV</span>
            </span>
          </div>
          <div class="bd">
            <div class="cell-grid">
              <div
                v-for="(v, i) in cellVoltages"
                :key="i"
                class="cell"
                :class="cellClass(v, i)"
              >
                <span class="n">{{ pad(i + 1) }}</span>
                <span class="cv">{{ fmt(v / 1000, 3) }} V</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 温度 -->
        <div class="card">
          <div class="hd"><span class="t">温度</span></div>
          <div class="bd temp-body">
              <div class="mos-dial" :style="dialStyle">
              <div>
                <div class="a">{{ basicInfo && mosTemp != null && Number.isFinite(mosTemp) ? mosTemp.toFixed(1) + '℃' : '--' }}</div>
                <div class="b">MOS 温度</div>
              </div>
            </div>
            <div class="temp-rows">
              <div v-for="(t, i) in temperatures" :key="i" class="temp-row" :class="{ hot: t > 45 }">
                <span class="nm">温度{{ i + 1 }}</span>
                <div class="tr"><i :style="{ width: tempPct(t) + '%' }" /></div>
                <span class="tv">{{ Number.isFinite(t) ? t.toFixed(1) : '--' }} ℃</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useJbd } from '@/jbd/useJbd'
import { PROT_QUERY_INTERVAL_MS } from '../constants'

const j = useJbd()
const {
  connected, basicInfo, cellVoltages, protectList, cellMax, cellMin,
  maxTemp, socStatus, socLabel, cellClass, fmt, pad,
  chipTypeName, hwVersion, batchBusy,
  activeProtects, activeAlarms,
  readBasic, readCells, readProtect, readChip, readHw,
} = j

// ===== 派生读数 =====
const totalV   = computed(() => basicInfo.value ? basicInfo.value.totalVoltage_mV / 1000 : NaN)
const currentA = computed(() => basicInfo.value ? basicInfo.value.current_mA / 1000 : NaN)
const remainAh = computed(() => basicInfo.value ? basicInfo.value.remainingCapacity_mAh / 1000 : NaN)
const fullChargeAh = computed(() => basicInfo.value?.fullChargeCapacity_mAh != null ? basicInfo.value.fullChargeCapacity_mAh / 1000 : NaN)
const cycleCount = computed(() => basicInfo.value?.cycleCount ?? 0)
const powerW   = computed(() => (Number.isFinite(totalV.value) && Number.isFinite(currentA.value)) ? totalV.value * currentA.value : NaN)
const rsoc     = computed(() => basicInfo.value?.rsoc ?? 0)
const chargeSwitch    = computed(() => basicInfo.value?.fet.charge ?? false)
const dischargeSwitch = computed(() => basicInfo.value?.fet.discharge ?? false)
const temperatures    = computed(() => basicInfo.value?.temperatures_C ?? [])
// MOS 默认取第一个 NTC（典型布局）；若没有 NTC 则回退到 maxTemp
const mosTemp = computed(() => {
  const t = temperatures.value
  if (!t.length) return maxTemp.value
  return t[0]
})
const pressureDiff    = computed(() => cellMax.value && cellMin.value ? cellMax.value - cellMin.value : 0)
const cellCount       = computed(() => cellVoltages.value.length || 0)

// 保护 / 告警 / 均衡整体状态：全空 → 正常；任一存在 → 异常
const allNormal = computed(() => !activeProtects.value.length && !activeAlarms.value.length)
const balanceText = computed(() => {
  const b = basicInfo.value
  if (!b) return '未启动'
  return (b.balanceLow || b.balanceHigh) ? '启动中' : '未启动'
})
const balanceClass = computed(() => {
  const b = basicInfo.value
  return (b && (b.balanceLow || b.balanceHigh)) ? 'ok' : 'gray'
})

// ===== SOC 条 =====
const socBarPct = computed(() => Math.max(0, Math.min(100, rsoc.value)))
const socBarCls = computed(() => (socStatus.value === 'critical' ? 'soc-crit' : socStatus.value === 'warning' ? 'soc-warn' : ''))

// ===== MOS 圆盘（conic 比例同温度条口径：-10℃ ~ 80℃）=====
const dialStyle = computed(() => {
  const pct = tempPct(mosTemp.value as number)
  return { background: `conic-gradient(var(--info) 0 ${pct}%, var(--inset) ${pct}% 100%)` }
})

// ===== 温度条 =====
const TEMP_MIN = -10
const TEMP_MAX = 80
function tempPct(t: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.min(100, ((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100))
}

// ===== 自动更新：页面激活（点开）即全量拉取并持续刷新 =====
// 基础帧 0x03/0x04/0x00：useJbd pollTimer 每 2s（连接期间常开）；
// 保护事件 0xAA：本页激活且已连接时每 5s 同步；芯片/硬件信息连接时由 initAfterConnect 读取。
// 页面用 v-show 常驻，激活状态由 App 传入 active 控制。
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })

j.onPollChange(true)

let protTimer: number | null = null
function startProtTimer() {
  if (protTimer) return
  protTimer = window.setInterval(() => {
    // 参数批量读写下发中跳过，避免 0xAA 帧插进工厂模式帧序列
    if (!connected.value || batchBusy.value) return
    readProtect()
  }, PROT_QUERY_INTERVAL_MS)
}
function stopProtTimer() {
  if (protTimer) { clearInterval(protTimer); protTimer = null }
}

// ===== 全量读取（页面激活时立即拉一次，静态项 readChip/readHw 代价仅 2 帧） =====
function refreshAll() {
  if (!connected.value) return
  readBasic(); readCells(); readProtect()
  readChip(); readHw()
}

function syncMonitorLoop() {
  if (props.active && connected.value) {
    j.onPollChange(true)
    j.restartPoll()
    startProtTimer()
  } else {
    // 切走页面即停止全部自动读取（2s/1s 基础轮询 + 5s 保护事件），让出串口总线
    j.onPollChange(false)
    stopProtTimer()
  }
}

// 点开页面：立即全量拉取 + 恢复自动读取（轮询被链路熔断等状态停掉也能复活）；切走即停
watch(() => props.active, (on) => {
  if (on) refreshAll()
  syncMonitorLoop()
})

// 连接状态变化时：
//  - 恢复连接：交由 useJbd 的 pollTimer 接管后续 2s 轮询（初始全量读取已由
//    useJbd.initAfterConnect 统一串行执行，不再各自抢发导致队列拥挤）；
//  - 断开：停止轮询（restartPoll 在断开态下会自动清空定时器）。
watch(connected, (v) => {
  j.restartPoll()
  if (v && props.active) refreshAll()
  syncMonitorLoop()
})

onMounted(() => {
  if (props.active) refreshAll()
  j.restartPoll()
  syncMonitorLoop()
})
onUnmounted(() => {
  j.onPollChange(false)
  stopProtTimer()
})
</script>

<style scoped>
.jbd-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.jbd-panel :deep(.chip) { display: inline-flex; }

/* ===== 双列布局 ===== */
.mon-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
  padding-bottom: 4px;
}
.colstack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

/* ===== 卡片 ===== */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.card > .hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
}
.card > .hd .t { font-weight: 700; font-size: 13.5px; color: var(--t1); }
.card > .hd .aux {
  margin-left: auto;
  color: var(--t3);
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.card > .bd { padding: 12px 14px; }

/* ===== chips ===== */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
}
.chip.err { background: var(--err-weak); color: var(--err); }
.chip.warn { background: var(--warn-weak); color: var(--warn); }
.chip.ok { background: var(--ok-weak); color: var(--ok); }
.chip.gray { background: var(--inset); color: var(--t2); }

/* ===== SOC 条 ===== */
.soc-wrap { display: flex; align-items: center; gap: 16px; padding: 4px 0 10px; }
.soc-bar {
  flex: 1;
  height: 26px;
  border-radius: 8px;
  background: var(--inset);
  overflow: hidden;
  position: relative;
}
.soc-bar > i {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #2fbf6b, #23a55a);
  border-radius: 8px;
  transition: width 0.3s;
}
.soc-bar > i.soc-warn { background: linear-gradient(90deg, #f0b04d, #e8a23d); }
.soc-bar > i.soc-crit { background: linear-gradient(90deg, #f26d70, #e5484d); }
.soc-num {
  font-family: var(--mono);
  font-weight: 800;
  font-size: 30px;
  min-width: 96px;
  text-align: right;
  color: var(--t1);
}
.soc-num small { font-size: 16px; color: var(--t3); font-weight: 600; }
.soc-tag { font-size: 12px; color: var(--t3); min-width: 64px; }

/* ===== kv 读数 ===== */
.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 26px; }
.kv .k { color: var(--t2); font-size: 12px; margin-bottom: 3px; }
.kv .v {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 19px;
  letter-spacing: 0.2px;
  color: var(--t1);
  font-variant-numeric: tabular-nums;
}
.kv .v.v-sm { font-size: 14px; }
.kv .v small { font-size: 12px; color: var(--t3); font-weight: 400; margin-left: 3px; }
.kv .v.neg { color: var(--warn); }

/* 概览底部：开关 / 均衡 / 保护 chips */
.ov-foot {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.switch-line { display: flex; align-items: center; gap: 9px; color: var(--t2); font-size: 12.5px; }
.chip-row { display: inline-flex; flex-wrap: wrap; gap: 6px; }

/* CSS 开关（preview .switch）*/
.switch { position: relative; width: 38px; height: 21px; flex: 0 0 38px; cursor: pointer; display: inline-block; }
.switch input { display: none; }
.switch .tk {
  position: absolute;
  inset: 0;
  background: var(--border-strong);
  border-radius: 12px;
  transition: 0.18s;
}
.switch .tk::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: 0.18s;
}
.switch input:checked + .tk { background: var(--brand); }
.switch input:checked + .tk::after { left: 19px; }
.switch input:disabled + .tk { opacity: 0.55; }

/* ===== 设备信息 ===== */
.dev-grid { grid-template-columns: 1fr 1fr; gap: 8px 20px; }

/* ===== 保护事件次数 ===== */
.refresh-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  color: var(--t2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.refresh-mini:hover { background: var(--hover); color: var(--brand); border-color: var(--brand); }
.refresh-mini svg { width: 12px; height: 12px; }
.evt-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px 20px;
}
.evt-kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: var(--inset);
  border-radius: 7px;
}
.evt-name { color: var(--t2); font-size: 12px; }
.evt-count { font-family: var(--mono); font-weight: 700; font-size: 12.5px; color: var(--t1); }
.evt-count small { color: var(--t3); font-weight: 400; }

/* ===== 单体电压 ===== */
.legend { display: flex; gap: 14px; color: var(--t3); font-size: 11.5px; align-items: center; }
.legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
.lg-info { background: var(--info); }
.lg-ok { background: var(--ok); }
.lg-eq { background: transparent; border: 1.5px solid var(--ok); }
.delta-txt { color: var(--err); }
.delta-txt b { font-weight: 800; }
.cell-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.cell {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 6px 9px;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--inset);
  min-width: 0;
}
.cell .n { color: var(--t3); font-size: 11px; font-family: var(--mono); flex: 0 0 18px; }
.cell .cv {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12.5px;
  margin-left: auto;
  color: var(--t1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cell.cell--max { border-color: var(--info); background: var(--info-weak); }
.cell.cell--min { border-color: var(--ok); background: var(--ok-weak); }
.cell.cell--eq { box-shadow: inset 0 0 0 1.5px var(--ok); }
.cell.cell--crit { border-color: var(--err); background: var(--err-weak); }
.cell.cell--crit .cv { color: var(--err); }
.cell.cell--warn { border-color: var(--warn); background: var(--warn-weak); }
.cell.cell--warn .cv { color: var(--warn); }

/* ===== 温度 ===== */
.temp-body { display: flex; align-items: center; }
.mos-dial {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  flex: 0 0 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 14px;
}
.mos-dial > div {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.mos-dial .a { font-family: var(--mono); font-weight: 800; font-size: 15px; color: var(--t1); }
.mos-dial .b { font-size: 10.5px; color: var(--t3); }
.temp-rows { flex: 1; min-width: 0; }
.temp-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
.temp-row .nm { flex: 0 0 62px; color: var(--t2); font-size: 12.5px; }
.temp-row .tr {
  flex: 1;
  height: 9px;
  border-radius: 5px;
  background: var(--inset);
  overflow: hidden;
}
.temp-row .tr > i {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--info), #39c6f5);
  transition: width 0.3s;
}
.temp-row .tv {
  flex: 0 0 66px;
  text-align: right;
  font-family: var(--mono);
  font-weight: 700;
  font-size: 12.5px;
  color: var(--t1);
}
.temp-row.hot .tr > i { background: linear-gradient(90deg, var(--warn), var(--err)); }
.temp-row.hot .tv { color: var(--err); }

@media (max-width: 1100px) {
  .mon-grid { grid-template-columns: 1fr; }
}
</style>
