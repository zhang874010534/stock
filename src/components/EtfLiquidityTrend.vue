<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initEtfReturn as initTrend } from '../charts/etfReturnRuntime.js'
import { etfLiquidityOption } from '../charts/etfLiquidity.js'
const props = defineProps({ stats: { type: Object, required: true }, kind: { type: String, default: 'liquidity' }, selection: String })
const canvas = ref(null)
let chart, observer, dirty = true, disposed = false, reset = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initTrend(canvas.value)
  if (dirty) {
    const option = etfLiquidityOption(props.stats, props.kind), zoom = reset ? null : chart.getOption()?.dataZoom?.[0]
    if (zoom) for (const item of option.dataZoom) Object.assign(item, { start: zoom.start, end: zoom.end })
    chart.setOption(option, { notMerge: true }); dirty = false; reset = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.kind, props.selection], ([, kind, selection], [, oldKind, oldSelection]) => { reset ||= kind !== oldKind || selection !== oldSelection; dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="liquidity-trend" :class="{ 'size-trend': kind === 'size' }" role="img" :aria-label="kind === 'size' ? `512890报告期规模趋势，${stats.history[0].date}至${stats.date}` : `512890成交额与场内换手率趋势，${stats.startDate}至${stats.endDate}`" /></template>
<style scoped>.liquidity-trend { width: 100%; height: 450px; min-width: 0; } .size-trend { height: 280px; }</style>
