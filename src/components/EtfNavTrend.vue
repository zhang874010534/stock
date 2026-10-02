<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initEtfReturn as initTrend } from '../charts/etfReturnRuntime.js'
import { etfNavOption } from '../charts/etfNav.js'

const props = defineProps({ stats: { type: Object, required: true }, kind: { type: String, required: true }, selection: String })
const canvas = ref(null)
let chart, observer, dirty = true, disposed = false, reset = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initTrend(canvas.value)
  if (dirty) {
    const option = etfNavOption(props.stats, props.kind), zoom = reset ? null : chart.getOption()?.dataZoom?.[0]
    if (zoom) Object.assign(option.dataZoom[0], { start: zoom.start, end: zoom.end })
    chart.setOption(option, { notMerge: true }); dirty = false; reset = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.kind, props.selection], ([, kind, selection], [, oldKind, oldSelection]) => { reset ||= kind !== oldKind || selection !== oldSelection; dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="nav-trend" role="img" :aria-label="`${{ price: 'ETF收盘价与单位净值', premium: 'ETF同日折溢价历史', tracking: '净值相对H30269价格指数的累计偏离' }[kind]}，${stats.startDate}至${stats.endDate}`" /></template>
<style scoped>.nav-trend { width: 100%; height: 300px; min-width: 0; }</style>
