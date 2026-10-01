<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initYieldSpread } from '../charts/yieldSpreadRuntime.js'
import { yieldSpreadOption } from '../charts/yieldSpread.js'
const props = defineProps({ analysis: { type: Object, required: true } })
const canvas = ref(null)
let chart, observer, dirty = true, disposed = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initYieldSpread(canvas.value)
  if (dirty) { chart.setOption(yieldSpreadOption(props.analysis), { notMerge: true }); dirty = false }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => props.analysis, () => { dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="yield-spread-charts" role="img" :aria-label="`H30269 股息率与十年期国债收益率及差值历史，${analysis.count} 个同日样本`" /></template>
<style scoped>.yield-spread-charts { width: 100%; height: 490px; min-width: 0; }</style>
