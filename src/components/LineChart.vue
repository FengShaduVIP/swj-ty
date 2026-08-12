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

const PAD = { l: 46, r: 10, t: 10, b: 18 }

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
  ctx.fillStyle = '#0c0e10'
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

  // 网格 + Y 刻度
  ctx.strokeStyle = '#2a2e34'
  ctx.fillStyle = '#6a6e74'
  ctx.font = '10px monospace'
  ctx.lineWidth = 1
  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const val = min + ((max - min) * i) / ticks
    const y = yAt(val)
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke()
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(val.toFixed(2), PAD.l - 4, y)
  }

  // 折线
  for (const s of props.series) {
    if (s.data.length < 1) continue
    if (props.fill && s.data.length > 1) {
      ctx.beginPath()
      ctx.moveTo(xAt(0), yAt(s.data[0]))
      for (let i = 1; i < s.data.length; i++) ctx.lineTo(xAt(i), yAt(s.data[i]))
      ctx.lineTo(xAt(s.data.length - 1), h - PAD.b)
      ctx.lineTo(xAt(0), h - PAD.b)
      ctx.closePath()
      ctx.fillStyle = s.color + '22'
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(xAt(0), yAt(s.data[0]))
    for (let i = 1; i < s.data.length; i++) ctx.lineTo(xAt(i), yAt(s.data[i]))
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.5
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
  background: #0c0e10;
  border: 1px solid #2a2e34;
  border-radius: 6px;
}
.lc-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6a6e74;
  font-size: 13px;
}
</style>
