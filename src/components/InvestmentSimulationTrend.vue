<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initEtfReturn as initTrend } from '../charts/etfReturnRuntime.js'
import { investmentSimulatorOption } from '../charts/investmentSimulator.js'

const props = defineProps({ stats: { type: Object, required: true } })
const canvas = ref(null)
let chart, observer, dirty = true, disposed = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initTrend(canvas.value)
  if (dirty) { chart.setOption(investmentSimulatorOption(props.stats), { notMerge: true }); dirty = false }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => props.stats, () => { dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="simulation-trend" role="img" :aria-label="`${stats.code}四种投入策略总资产曲线，${stats.startDate}至${stats.endDate}，包含剩余现金`" /></template>
<style scoped>.simulation-trend { width: 100%; height: 340px; min-width: 0; }</style>
