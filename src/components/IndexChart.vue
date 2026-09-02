<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Info } from 'lucide-vue-next'
import { NButton, NTooltip } from 'naive-ui'
import { INDEX_RANGES, normalizeHistory, getRangeWindow, getZoomWindow, getWindowSummary } from '../utils/indexHistory.js'

const props = defineProps({
  history: { type: Array, default: () => [] },
  isDemo: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['retry'])

const chartElement = ref(null)
const history = computed(() => normalizeHistory(props.history))
const selectedRange = ref('1y')
const visibleWindow = ref(getRangeWindow(history.value, selectedRange.value))
const summary = computed(() => getWindowSummary(history.value, visibleWindow.value))
const isLoading = ref(true)
const chartError = ref('')
const isBusy = computed(() => isLoading.value || props.loading)
const displayError = computed(() => props.error || chartError.value)
const changeLabel = computed(() => {
  if (!summary.value) return '—'
  const change = summary.value.changePercent
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
})

let runtime
let chart
let observer
let resizeFrame
let disposed = false

function handleZoom() {
  const zoom = chart.getOption().dataZoom[0]
  visibleWindow.value = getZoomWindow(history.value.length, zoom.start, zoom.end)
  selectedRange.value = 'custom'
}

function renderChart() {
  if (!runtime || !chartElement.value?.clientWidth || disposed) return
  if (!history.value.length) {
    chart?.clear()
    return
  }
  if (!chart) {
    chart = runtime.initIndexTrend(chartElement.value)
    chart.on('datazoom', handleZoom)
  }
  if (selectedRange.value === 'custom') selectedRange.value = '1y'
  visibleWindow.value = getRangeWindow(history.value, selectedRange.value)
  chart.setOption(runtime.createIndexTrendOption(history.value, visibleWindow.value, props.isDemo), { notMerge: true })
}

function selectRange(key) {
  if (!chart || !history.value.length) return
  const window = getRangeWindow(history.value, key)
  chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: window.startIndex, endValue: window.endIndex })
  // dispatchAction 也会触发 datazoom；按钮操作之后恢复相应的预设选中态。
  selectedRange.value = key
  visibleWindow.value = window
}

async function loadChart() {
  isLoading.value = true
  chartError.value = ''
  try {
    runtime = await import('../charts/indexTrend.js')
    if (disposed) return
    renderChart()
  } catch {
    if (!disposed) chartError.value = '图表加载失败，请重试'
  } finally {
    if (!disposed) isLoading.value = false
  }
}

watch([history, () => props.isDemo], renderChart, { flush: 'post' })

onMounted(() => {
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return
      if (chart) chart.resize()
      else if (!isLoading.value && !chartError.value) renderChart()
    })
  })
  observer.observe(chartElement.value)
  loadChart()
})

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  chart?.dispose()
})
</script>

<template>
  <section class="index-chart panel" aria-label="H30269 指数走势">
    <div class="chart-heading">
      <h2 class="panel-heading">指数走势
        <NTooltip trigger="hover">
          <template #trigger><button class="info-button" aria-label="指数走势说明"><Info :size="14" /></button></template>
          按观测日期展示指数点位，可切换时间范围或拖动底部时间轴。
        </NTooltip>
      </h2>
      <span v-if="isDemo" class="demo-badge">模拟数据</span>
    </div>

    <div class="chart-ranges" role="group" aria-label="指数走势时间范围">
      <NButton v-for="range in INDEX_RANGES" :key="range.key" size="tiny" :type="selectedRange === range.key ? 'primary' : 'default'" :ghost="selectedRange === range.key" :aria-pressed="selectedRange === range.key" :disabled="isBusy || !history.length || !!displayError" @click="selectRange(range.key)">
        {{ range.label }}
      </NButton>
    </div>

    <div class="chart-body" :aria-busy="isBusy">
      <div ref="chartElement" class="chart-canvas" :style="{ visibility: isBusy || displayError || !history.length ? 'hidden' : 'visible' }" />
      <div v-if="isBusy || displayError || !history.length" class="chart-state" role="status">
        <span>{{ displayError || (isBusy ? '正在加载行情…' : '等待首次行情同步') }}</span>
        <NButton v-if="displayError" size="tiny" secondary @click="error ? emit('retry') : loadChart()">重试</NButton>
      </div>
    </div>

    <div v-if="summary && !displayError" class="range-summary" aria-live="polite" aria-atomic="true">
      <span class="range-dates">{{ summary.startDate }} — {{ summary.endDate }}</span>
      <span class="range-change" :class="{ 'is-negative': summary.changePercent < 0 }">区间 {{ changeLabel }}</span>
    </div>
    <p class="chart-footnote">{{ isDemo ? '模拟数据仅供交互验收，不代表真实行情。' : '区间变化按首尾观测点位计算。' }}<span v-if="selectedRange === 'custom'">自定义区间</span></p>
  </section>
</template>

<style scoped>
.index-chart { display: flex; flex-direction: column; min-width: 0; min-height: 316px; padding: 14px 15px 11px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.info-button { display: inline-flex; padding: 0; border: 0; background: none; color: var(--color-text-muted); }
.demo-badge { padding: 2px 6px; border: 1px solid #53472e; border-radius: 4px; background: #3d321521; color: #c4a56c; font-size: 10px; }
.chart-ranges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.chart-ranges :deep(.n-button) { height: 23px; padding-inline: 6px; font-size: 10px; }
.chart-body { position: relative; flex: 1; min-height: 213px; margin-top: 4px; }
.chart-canvas { position: absolute; inset: 0; min-height: 213px; }
.chart-state { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 12px; color: #7d8fae; }
.range-summary { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 3px 8px; margin-top: 5px; font-size: 10px; font-variant-numeric: tabular-nums; }
.range-dates { color: #8596b1; font-family: var(--font-mono); }
.range-change { color: #6da9ff; }
.range-change.is-negative { color: #38d6ac; }
.chart-footnote { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; margin-top: 6px; font-size: 9px; color: #62738d; line-height: 1.5; }
.chart-footnote span { color: #89a4cc; }
</style>
