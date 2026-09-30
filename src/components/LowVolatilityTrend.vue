<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initLowVolatility } from '../charts/lowVolatilityRuntime.js'
import { lowVolatilityOption, lowVolatilityWindow } from '../charts/lowVolatility.js'

const props = defineProps({ stats: { type: Object, required: true }, selection: String })
const canvas = ref(null)
let chart, observer, previous = [], dirty = true, disposed = false, resetWindow = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initLowVolatility(canvas.value)
  if (dirty) {
    const window = lowVolatilityWindow(resetWindow ? [] : previous, props.stats.points, chart.getOption()?.dataZoom?.[0])
    chart.setOption(lowVolatilityOption(props.stats, window), { notMerge: true })
    previous = props.stats.points; dirty = false; resetWindow = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.selection], ([, selection], [, oldSelection]) => {
  resetWindow ||= selection !== oldSelection; dirty = true; render()
}, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="low-volatility-canvas" role="img" :aria-label="`${stats.code}近${stats.rollingSessions}个交易日日收益的年化总波动率与下行波动率，${stats.startDate}至${stats.endDate}`" /></template>
<style scoped>.low-volatility-canvas { width: 100%; height: 320px; min-width: 0; }</style>
