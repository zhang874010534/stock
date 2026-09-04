<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Info } from 'lucide-vue-next'
import { NButton, NTooltip } from 'naive-ui'
import { INDEX_RANGES, getZoomWindow, getWindowSummary } from '../utils/indexHistory.js'
import { KLINE_PERIODS } from '../utils/kline.js'

const props = defineProps({
  history: { type: Array, default: () => [] },
  range: { type: String, default: '1y' },
  period: { type: String, default: 'day' },
  backfillCompleted: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['retry', 'range-change', 'period-change'])

const chartElement = ref(null)
const history = computed(() => props.history)
const selectedRange = ref(props.range)
const selectedPeriod = ref(props.period)
const fullWindow = () => ({ startIndex: 0, endIndex: Math.max(0, history.value.length - 1) })
const visibleWindow = ref(fullWindow())
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
  selectedRange.value = props.range
  selectedPeriod.value = props.period
  visibleWindow.value = fullWindow()
  chart.setOption(runtime.createIndexTrendOption(history.value, visibleWindow.value), { notMerge: true })
}

function selectRange(key) {
  if (key !== props.range) {
    emit('range-change', key)
    return
  }
  if (!chart || !history.value.length) return
  const window = fullWindow()
  chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: window.startIndex, endValue: window.endIndex })
  selectedRange.value = key
  visibleWindow.value = window
}

function selectPeriod(key) {
  if (key !== props.period) emit('period-change', key)
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

watch([history, () => props.range, () => props.period], () => {
  selectedRange.value = props.range
  selectedPeriod.value = props.period
  renderChart()
}, { flush: 'post' })

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
  <section class="index-chart panel" aria-label="H30269 指数 K 线">
    <div class="chart-heading">
      <h2 class="panel-heading">指数 K 线
        <NTooltip trigger="hover">
          <template #trigger><button class="info-button" aria-label="指数 K 线说明"><Info :size="14" /></button></template>
          日 K 在本地聚合为周 K 或月 K，可拖动底部时间轴查看区间。
        </NTooltip>
      </h2>
      <span class="period-label">{{ KLINE_PERIODS.find((item) => item.key === selectedPeriod)?.label }}</span>
    </div>

    <div class="chart-controls">
      <div class="chart-periods" role="group" aria-label="K 线周期">
        <NButton v-for="item in KLINE_PERIODS" :key="item.key" size="tiny" :type="selectedPeriod === item.key ? 'primary' : 'default'" :ghost="selectedPeriod === item.key" :aria-pressed="selectedPeriod === item.key" :disabled="isBusy" @click="selectPeriod(item.key)">
          {{ item.label }}
        </NButton>
      </div>
      <div class="chart-ranges" role="group" aria-label="指数 K 线时间范围">
        <NButton v-for="item in INDEX_RANGES" :key="item.key" size="tiny" :type="selectedRange === item.key ? 'primary' : 'default'" :ghost="selectedRange === item.key" :aria-pressed="selectedRange === item.key" :disabled="isBusy" @click="selectRange(item.key)">
          {{ item.label }}
        </NButton>
      </div>
    </div>

    <div class="chart-body" :aria-busy="isBusy">
      <div ref="chartElement" class="chart-canvas" :style="{ visibility: isBusy || displayError || !history.length ? 'hidden' : 'visible' }" />
      <div v-if="isBusy || displayError || !history.length" class="chart-state" role="status">
        <span>{{ displayError || (isBusy ? '正在读取行情…' : '暂无行情数据') }}</span>
        <NButton v-if="displayError" size="tiny" secondary @click="error ? emit('retry') : loadChart()">重试</NButton>
      </div>
    </div>

    <div v-if="summary && !isBusy && !displayError" class="range-summary" aria-live="polite" aria-atomic="true">
      <span class="range-dates">{{ summary.startDate }} — {{ summary.endDate }}</span>
      <span class="range-change" :class="{ 'is-negative': summary.changePercent < 0 }">区间 {{ changeLabel }}</span>
    </div>
    <p v-if="history.length && !displayError" class="chart-footnote"><span>{{ backfillCompleted ? '历史数据已完成同步。' : '历史数据正在逐步补充，当前展示已同步的数据范围。' }}</span><span v-if="selectedRange === 'custom'">自定义区间</span></p>
  </section>
</template>

<style scoped>
.index-chart { display: flex; flex-direction: column; min-width: 0; min-height: 430px; padding: 14px 15px 11px; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.info-button { display: inline-flex; padding: 0; border: 0; background: none; color: var(--color-text-muted); }
.period-label { padding: 2px 6px; border: 1px solid #294569; border-radius: 4px; background: #172d4c; color: #94b9ee; font-size: 10px; }
.chart-controls { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; }
.chart-periods, .chart-ranges { display: flex; flex-wrap: wrap; gap: 4px; }
.chart-controls :deep(.n-button) { height: 23px; padding-inline: 6px; font-size: 10px; }
.chart-body { position: relative; flex: 1; min-height: 300px; margin-top: 4px; }
.chart-canvas { position: absolute; inset: 0; min-height: 300px; }
.chart-state { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 12px; color: #7d8fae; }
.range-summary { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 3px 8px; margin-top: 5px; font-size: 10px; font-variant-numeric: tabular-nums; }
.range-dates { color: #8596b1; font-family: var(--font-mono); }
.range-change { color: #6da9ff; }
.range-change.is-negative { color: #38d6ac; }
.chart-footnote { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; margin-top: 6px; font-size: 9px; color: #62738d; line-height: 1.5; }
.chart-footnote span:last-child { color: #89a4cc; }
</style>
