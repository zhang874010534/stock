<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { initPortfolioHistory } from '../charts/portfolioHistoryRuntime.js'
import { portfolioHistoryOption, portfolioHistoryWindow } from '../charts/portfolioHistory.js'

const props = defineProps({ stats: { type: Object, required: true }, range: String })
const canvas = ref(null)
let chart, observer, previous = [], dirty = true, disposed = false, resetWindow = false
function render() {
  if (disposed || !canvas.value?.clientWidth || !canvas.value?.clientHeight) return
  if (!chart) chart = initPortfolioHistory(canvas.value)
  if (dirty) {
    const option = chart.getOption()
    const window = portfolioHistoryWindow(resetWindow ? [] : previous, props.stats.points, option?.dataZoom?.[0])
    const selected = Object.assign({}, ...(option?.legend ?? []).map(legend => legend.selected))
    chart.setOption(portfolioHistoryOption(props.stats, window, selected), { notMerge: true })
    previous = props.stats.points; dirty = false; resetWindow = false
  }
  chart.resize()
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(canvas.value); render() })
watch(() => [props.stats, props.range], ([, range], [, oldRange]) => { resetWindow ||= range !== oldRange; dirty = true; render() }, { flush: 'post' })
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); chart?.dispose() })
</script>
<template><div ref="canvas" class="portfolio-history-canvas" role="img" :aria-label="`512890 个人持仓市值、累计买入支出、累计盈亏、到账分红与费用历史，${stats.startDate}至${stats.endDate}；缺少收盘价保留断点，逐日数值见下方每日明细`" /></template>
<style scoped>.portfolio-history-canvas { width: 100%; height: 470px; min-width: 0; }</style>
