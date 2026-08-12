<template>
  <div ref="wrap" class="line-chart">
    <canvas ref="cv" />
    <div v-if="!hasData" class="lc-empty">暂无数据</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

interface Series {
  name: string
  color: string
  data: number[]
}

const props = defineProps<{
  series: Series[]
  height?: number
  yUnit?: string
  /** 折线下方是否填充 */
  fill?: boolean
}>()

const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)
const hasData = ref(false)
let ro: ResizeObserver | null = null

// VG 图表结构色（DESIGN 2.7）
const PLOT_BG = '#0D1117'
const GRID = '#1E2633'
const GRID_MINOR = 'rgba(255,255,255,0.035)'
const AXIS = '#2A3240'
const AXIS_LABEL = '#828E9F'

const PAD = { l: 46, r: 12, t: 12, b: 22 }

function draw() {
  const canvas = cv.value
  const container = wrap.value
  if (!canvas || !container) return
  const dpr = window.devicePixelRatio || 1
  const w = container.clientWidth
  const h = props.height ?? 200
  canvas.width = Math.max(1, Math.floor(w * dpr))
  canvas.height = Math.max(1, Math.floor(h * dpr))
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = PLOT_BG
  ctx.fillRect(0, 0, w, h)

  const allPts = props.series.flatMap((s) => s.data)
  hasData.value = allPts.length > 0 && props.series.some((s) => s.data.length > 1)
  if (!hasData.value) return

  // Y 轴范围（留 8% 余量）
  let min = Math.min(...allPts)
  let max = Math.max(...allPts)
  if (min === max) { min -= 1; max += 1 }
  const span = max - min
  min -= span * 0.08
  max += span * 0.08

  const plotW = w - PAD.l - PAD.r
  const plotH = h - PAD.t - PAD.b
  const n = Math.max(...props.series.map((s) => s.data.length))
  const xAt = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const yAt = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * plotH

  // 横向主网格 + Y 刻度
  ctx.lineWidth = 1
  ctx.font = '10px "JetBrains Mono", monospace'
  ctx.textBaseline = 'middle'
  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const val = min + ((max - min) * i) / ticks
    const y = yAt(val)
    ctx.strokeStyle = GRID
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke()
    ctx.fillStyle = AXIS_LABEL
    ctx.textAlign = 'right'
    ctx.fillText(val.toFixed(2), PAD.l - 6, y)
  }

  // 纵向时间轴次网格（淡）
  ctx.strokeStyle = GRID_MINOR
  const vLines = Math.min(6, n - 1)
  for (let i = 1; i < vLines; i++) {
    const x = PAD.l + (plotW * i) / vLines
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, h - PAD.b); ctx.stroke()
  }

  // 坐标轴线
  ctx.strokeStyle = AXIS
  ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, h - PAD.b); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(PAD.l, h - PAD.b); ctx.lineTo(w - PAD.r, h - PAD.b); ctx.stroke()

  // 折线（linear，禁平滑插值 · DESIGN 7.1）
  for (const s of props.series) {
    if (s.data.length < 1) continue
    if (props.fill && s.data.length > 1) {
      ctx.beginPath()
      ctx.moveTo(xAt(0), yAt(s.data[0]))
      for (let i = 1; i < s.data.length; i++) ctx.lineTo(xAt(i), yAt(s.data[i]))
      ctx.lineTo(xAt(s.data.length - 1), h - PAD.b)
      ctx.lineTo(xAt(0), h - PAD.b)
      ctx.closePath()
      ctx.fillStyle = s.color + '22' // 面积填充 22% alpha（DESIGN 4.5）
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(xAt(0), yAt(s.data[0]))
    for (let i = 1; i < s.data.length; i++) ctx.lineTo(xAt(i), yAt(s.data[i]))
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.data.length === 1 ? 1.5 : 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

onMounted(() => {
  ro = new ResizeObserver(() => draw())
  if (wrap.value) ro.observe(wrap.value)
  nextTick(draw)
})
onUnmounted(() => { ro?.disconnect(); ro = null })

watch(() => [props.series, props.height], () => nextTick(draw), { deep: true })
</script>

<style scoped>
.line-chart {
  position: relative;
  width: 100%;
  background: var(--chart-plot-bg);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
.lc-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--fs-body-sm);
}
</style>
