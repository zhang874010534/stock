<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { valuationTrendOption } from '../charts/valuationTrend.js'

const props = defineProps({ stats: { type: Object, required: true }, metric: { type: String, default: 'pe' }, expanded: Boolean })
const canvas = ref(null)
let chart, observer
function render() {
  if (!canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = echarts.init(canvas.value)
  chart.setOption(valuationTrendOption(props.stats, props.metric, props.expanded), { notMerge: true })
  chart.resize()
}
onMounted(() => {
  observer = new ResizeObserver(() => { if (chart) chart.resize(); else render() })
  observer.observe(canvas.value)
  render()
})
watch(() => [props.stats, props.metric, props.expanded], render, { flush: 'post' })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div ref="canvas" class="valuation-canvas" :class="{ large: expanded }" role="img" :aria-label="`${metric.toUpperCase()}估值走势，${stats.count}个样本，最新${stats.latest?.value.toFixed(2) ?? '暂无'}倍`" />
</template>

<style scoped>
.valuation-canvas { width: 100%; height: 220px; min-width: 0; }
.valuation-canvas.large { height: clamp(260px, 53vh, 650px); }
</style>
