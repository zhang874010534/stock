<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initIndexComparison } from '../charts/indexComparisonRuntime.js'
import { indexComparisonOption, comparisonWindow } from '../charts/indexComparison.js'

const props = defineProps({ stats: { type: Object, required: true }, selection: String })
const canvas = ref(null)
let chart, observer, previous = [], dirty = true, disposed = false, resetWindow = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initIndexComparison(canvas.value)
  if (dirty) {
    const points = props.stats.series[0].points
    const window = comparisonWindow(resetWindow ? [] : previous, points, chart.getOption()?.dataZoom?.[0])
    chart.setOption(indexComparisonOption(props.stats, window), { notMerge: true })
    previous = points; dirty = false; resetWindow = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.selection], ([, selection], [, oldSelection]) => {
  resetWindow ||= selection !== oldSelection; dirty = true; render()
}, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="comparison-canvas" role="img" :aria-label="`红利低波与沪深300累计收益、回撤和滚动波动率对比，${stats.startDate}至${stats.endDate}`" /></template>
<style scoped>.comparison-canvas { width: 100%; height: 700px; min-width: 0; }</style>
