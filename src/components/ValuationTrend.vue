<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initValuationTrend } from '../charts/valuationTrendRuntime.js'
import { valuationTrendOption } from '../charts/valuationTrend.js'

const props = defineProps({ stats: { type: Object, required: true }, metric: { type: String, default: 'pe' }, expanded: Boolean })
const canvas = ref(null)
let chart, observer
let dirty = true
let disposed = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initValuationTrend(canvas.value)
  if (dirty) {
    chart.setOption(valuationTrendOption(props.stats, props.metric, props.expanded), { notMerge: true })
    dirty = false
  }
  chart.resize()
}
onMounted(() => {
  observer = new ResizeObserver(render)
  observer.observe(canvas.value)
  render()
})
watch(() => [props.stats, props.metric, props.expanded], () => {
  dirty = true
  render()
}, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div ref="canvas" class="valuation-canvas" :class="{ large: expanded }" role="img" :aria-label="`${metric.toUpperCase()}估值走势，${stats.count}个样本，最新${stats.latest?.value.toFixed(2) ?? '暂无'}倍`" />
</template>

<style scoped>
.valuation-canvas { width: 100%; height: 220px; min-width: 0; }
.valuation-canvas.large { height: clamp(260px, 53vh, 650px); }
</style>
