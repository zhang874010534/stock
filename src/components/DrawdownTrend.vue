<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initDrawdown } from '../charts/drawdownRuntime.js'
import { drawdownTrendOption, drawdownWindow } from '../charts/drawdownTrend.js'
import { formatDrawdown } from '../utils/drawdown.js'

const props = defineProps({ stats: { type: Object, required: true }, instrument: { type: String, required: true } })
const canvas = ref(null)
let chart, observer, previous = [], dirty = true, disposed = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initDrawdown(canvas.value)
  if (dirty) {
    const window = drawdownWindow(previous, props.stats.points, chart.getOption()?.dataZoom?.[0])
    chart.setOption(drawdownTrendOption(props.stats, props.instrument, window), { notMerge: true })
    previous = props.stats.points
    dirty = false
  }
  chart.resize()
}
onMounted(() => {
  observer = new ResizeObserver(render)
  observer.observe(canvas.value)
  render()
})
watch(() => [props.stats, props.instrument], () => { dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div ref="canvas" class="drawdown-canvas" role="img" :aria-label="`${instrument}收盘回撤曲线，${stats.startDate}至${stats.endDate}，当前回撤${formatDrawdown(stats.current?.value)}，最大回撤${formatDrawdown(stats.maximum?.value ?? 0)}`" />
</template>

<style scoped>
.drawdown-canvas { width: 100%; height: 300px; min-width: 0; }
</style>
