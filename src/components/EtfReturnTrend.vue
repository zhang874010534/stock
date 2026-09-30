<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initEtfReturn } from '../charts/etfReturnRuntime.js'
import { etfReturnOption, etfReturnWindow } from '../charts/etfReturn.js'

const props = defineProps({ stats: { type: Object, required: true }, range: String })
const canvas = ref(null)
let chart, observer, previous = [], dirty = true, disposed = false, resetWindow = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initEtfReturn(canvas.value)
  if (dirty) {
    const window = etfReturnWindow(resetWindow ? [] : previous, props.stats.points, chart.getOption()?.dataZoom?.[0])
    chart.setOption(etfReturnOption(props.stats, window), { notMerge: true })
    previous = props.stats.points; dirty = false; resetWindow = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.range], ([, range], [, oldRange]) => { resetWindow ||= range !== oldRange; dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="etf-return-canvas" role="img" :aria-label="`512890价格、现金分红贡献及含分红收益对比，${stats.startDate}至${stats.endDate}`" /></template>
<style scoped>.etf-return-canvas { width: 100%; height: 310px; min-width: 0; }</style>
