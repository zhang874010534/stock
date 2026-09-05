<script setup>
import { computed, ref } from 'vue'
import { Info, Maximize2, Minimize2 } from 'lucide-vue-next'
import { formatIndexValue, getWindowSummary } from '../utils/indexHistory.js'
import { aggregateKlines, formatVolume, getKlineQuote, KLINE_PERIODS } from '../utils/kline.js'
import { calculateMA } from '../utils/indicators.js'
import { getKlineLayout, MA_OPTIONS } from '../charts/kline/config.js'
import { buildSubIndicator } from '../charts/kline/subIndicators.js'
import KLineToolbar from './kline/KLineToolbar.vue'
import KLineQuote from './kline/KLineQuote.vue'
import { useKlineChart } from './kline/useKlineChart.js'
import { useKlineFullscreen } from './kline/useKlineFullscreen.js'

const props = defineProps({
  history: { type: Array, default: () => [] },
  backfillCompleted: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['retry'])
const chartElement = ref(null)
const panelElement = ref(null)
const period = ref('day')
const maOptions = ref(MA_OPTIONS.map((item) => ({ ...item })))
const subIndicatorKey = ref('kdj')
const history = computed(() => aggregateKlines(props.history, period.value))
const maData = computed(() => Object.fromEntries(MA_OPTIONS.map(({ period }) => [period, calculateMA(history.value, period)])))
const movingAverages = computed(() => maOptions.value.map((item) => ({ ...item, data: maData.value[item.period] })))
const subIndicator = computed(() => buildSubIndicator(history.value, subIndicatorKey.value))
const { loading: chartLoading, error: chartError, range, activeIndex, visibleWindow, height, selectRange, resetHover, resize, load } = useKlineChart({
  element: chartElement, history, period, movingAverages, subIndicator,
})
const { expanded, inlineHeight, toggle } = useKlineFullscreen(panelElement, resize)
const isBusy = computed(() => chartLoading.value || props.loading)
const displayError = computed(() => props.error || chartError.value)
const showChart = computed(() => !isBusy.value && !displayError.value && history.value.length > 0)
const quote = computed(() => showChart.value ? getKlineQuote(history.value, activeIndex.value) : null)
const summary = computed(() => getWindowSummary(history.value, visibleWindow.value))
const layout = computed(() => getKlineLayout(height.value))
const periodLabel = computed(() => KLINE_PERIODS.find((item) => item.key === period.value)?.label)

function setMA(period, enabled) {
  const item = maOptions.value.find((item) => item.period === period)
  if (item) item.enabled = enabled
}
</script>

<template>
  <div class="index-chart-slot" :style="expanded ? { minHeight: `${inlineHeight}px` } : undefined">
    <Teleport to="body" :disabled="!expanded">
      <section ref="panelElement" class="index-chart" :class="{ 'is-expanded': expanded }" :role="expanded ? 'dialog' : undefined" :aria-modal="expanded ? true : undefined" aria-label="H30269 指数 K 线" tabindex="-1">
        <div class="chart-heading">
          <h2>指数 K 线 <button type="button" class="info-button" aria-label="指数 K 线说明" title="日线在本地按自然周、月、季度聚合；均线按当前周期计算。滚轮缩放，拖动查看历史。"><Info :size="14" /></button></h2>
          <div class="heading-actions"><span class="instrument">H30269 · {{ periodLabel }}</span><button type="button" class="expand-button" :aria-label="expanded ? '退出全屏' : '放大全屏'" :title="expanded ? '退出全屏（ESC）' : '放大全屏'" @click="toggle"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /><span>{{ expanded ? '退出 · ESC' : '放大' }}</span></button></div>
        </div>

        <KLineToolbar :period="period" :range="range" :ma-options="maOptions" :sub-indicator="subIndicatorKey" :disabled="isBusy" @period-change="period = $event" @range-change="selectRange" @ma-change="setMA" @indicator-change="subIndicatorKey = $event" />
        <KLineQuote :quote="quote" :moving-averages="movingAverages" :active-index="showChart ? activeIndex : -1" :is-latest="activeIndex === history.length - 1" />

        <div class="chart-body" :aria-busy="isBusy" @mouseleave="resetHover">
          <div ref="chartElement" class="chart-canvas" :style="{ visibility: showChart ? 'visible' : 'hidden' }" />
          <template v-if="showChart">
            <div class="sub-readout" :style="{ top: `${layout.volumeLabel}px` }" aria-label="当前成交量"><span>成交量</span><b :class="quote && quote.close >= quote.open ? 'up' : 'down'">{{ formatVolume(quote?.volume) }}</b></div>
            <div class="sub-readout" :style="{ top: `${layout.indicatorLabel}px` }" aria-label="当前副图指标数值"><span>{{ subIndicator.title }}</span><b v-for="line in subIndicator.lines" :key="line.id" :style="{ color: line.color }">{{ line.name }}: {{ formatIndexValue(line.data[activeIndex]) }}</b></div>
          </template>
          <div v-else class="chart-state" role="status">
            <span>{{ displayError || (isBusy ? '正在读取行情…' : '暂无行情数据') }}</span>
            <button v-if="displayError" type="button" @click="error ? emit('retry') : load()">重试</button>
          </div>
        </div>

        <div v-if="summary && showChart" class="range-summary">
          <span>{{ summary.startDate }} — {{ summary.endDate }} · {{ visibleWindow.endIndex - visibleWindow.startIndex + 1 }} 根</span>
          <span :class="summary.changePercent >= 0 ? 'up' : 'down'">区间 {{ summary.changePercent > 0 ? '+' : '' }}{{ summary.changePercent.toFixed(2) }}%</span>
        </div>
        <div class="chart-footnote"><span>{{ backfillCompleted ? '历史数据已完成同步' : '展示已同步历史，数据持续补充中' }}</span><span>{{ range === 'custom' ? '自定义区间 · ' : '' }}滚轮缩放 · 拖动平移</span></div>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.index-chart-slot { display: flex; min-width: 0; min-height: 580px; }
.index-chart { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 14px 15px 11px; border: 1px solid #30333e; border-radius: 10px; background: #101116; color: #bcc1cf; }
.index-chart.is-expanded { position: fixed; inset: 0; z-index: 1000; width: 100vw; height: 100dvh; min-height: 0; padding: 14px 22px 12px; border: 0; border-radius: 0; }
.chart-heading, .heading-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.chart-heading h2 { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: #e4e6ec; }
.instrument { color: #959baa; font-size: 10px; white-space: nowrap; }
.info-button { display: inline-flex; padding: 0; border: 0; background: none; color: #797f8c; }
.expand-button, .chart-state button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: 1px solid #383d49; border-radius: 4px; background: #20232c; color: #c8cdd9; font-size: 10px; }
.expand-button:hover, .chart-state button:hover { background: #303643; color: #fff; }
.chart-body { position: relative; flex: 1; min-height: 360px; }
.chart-canvas { position: absolute; inset: 0; }
.is-expanded .chart-body { min-height: 0; }
.sub-readout { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 12px; height: 20px; border-top: 1px solid #272a33; background: #17191f; color: #b0b6c6; font-size: 11px; font-variant-numeric: tabular-nums; pointer-events: none; }
.sub-readout b { font-weight: 400; white-space: nowrap; }
.chart-state { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 12px; color: #979dab; }
.range-summary { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; padding-top: 8px; color: #a0a6b6; font-size: 10px; font-variant-numeric: tabular-nums; }
.up { color: #ff454f; }
.down { color: #00bec7; }
.chart-footnote { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; padding-top: 6px; color: #7f8594; font-size: 9px; }
.is-expanded :deep(.kline-quote), .is-expanded .sub-readout { font-size: 13px; }
@media (max-width: 500px) {
  .instrument { display: none; }
  .index-chart.is-expanded { padding-inline: 10px; }
  .sub-readout { gap: 8px; font-size: 10px; }
}
</style>
