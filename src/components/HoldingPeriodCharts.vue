<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initHoldingPeriod } from '../charts/holdingPeriodRuntime.js'
import { holdingPeriodOption } from '../charts/holdingPeriods.js'

const props = defineProps({ series: { type: Object, required: true }, code: String, basis: String })
const canvas = ref(null)
let chart, observer, dirty = true, disposed = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initHoldingPeriod(canvas.value)
  if (dirty) { chart.setOption(holdingPeriodOption(props.series), { notMerge: true }); dirty = false }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.series, props.code, props.basis], () => { dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="holding-period-charts" role="img" :aria-label="`${code}持有${series.years}年的买入日期收益曲线与收益分布，${series.count}个完整样本，${basis === 'cash' ? '含现金分红不再投' : '价格收益'}`" /></template>
<style scoped>.holding-period-charts { width: 100%; height: 570px; min-width: 0; }</style>
