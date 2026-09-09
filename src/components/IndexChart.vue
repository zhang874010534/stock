<script setup>
import { computed, ref } from 'vue'
import { Info, Maximize2, Minimize2 } from 'lucide-vue-next'
import { formatIndexValue, getWindowSummary } from '../utils/indexHistory.js'
import { aggregateKlines, formatVolume, getKlineQuote, KLINE_PERIODS } from '../utils/kline.js'
import { calculateMA } from '../utils/indicators.js'
import { BOLL_PARAMETERS, getKlineLayout, KDJ_PARAMETERS, MACD_PARAMETERS, MA_OPTIONS, RSI_PARAMETERS } from '../charts/kline/config.js'
import { buildMainIndicator } from '../charts/kline/mainIndicators.js'
import { WAVE_PARAMETERS } from '../charts/kline/waveIndicator.js'
import { buildSubIndicator } from '../charts/kline/subIndicators.js'
import KLineToolbar from './kline/KLineToolbar.vue'
import KLineQuote from './kline/KLineQuote.vue'
import KLineRangeSelection from './kline/KLineRangeSelection.vue'
import YieldMetricCard from './YieldMetricCard.vue'
import { useKlineChart } from './kline/useKlineChart.js'
import { useKlineFullscreen } from './kline/useKlineFullscreen.js'

const props = defineProps({
  instrument: { type: String, default: 'H30269' },
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
const bollEnabled = ref(false)
const subIndicatorKey = ref('kdj')
const indicatorSettings = ref({
  wave: { ...WAVE_PARAMETERS },
  boll: { ...BOLL_PARAMETERS },
  kdj: { ...KDJ_PARAMETERS },
  macd: { ...MACD_PARAMETERS },
  rsi: { ...RSI_PARAMETERS },
})

const history = computed(() => aggregateKlines(props.history, period.value))
const maData = computed(() => Object.fromEntries(MA_OPTIONS.map(({ period }) => [period, calculateMA(history.value, period)])))
const movingAverages = computed(() => maOptions.value.map((item) => ({ ...item, data: maData.value[item.period] })))
const mainIndicators = computed(() => bollEnabled.value ? [buildMainIndicator(history.value, 'boll', indicatorSettings.value.boll)] : [])
const subIndicator = computed(() => buildSubIndicator(history.value, subIndicatorKey.value, indicatorSettings.value[subIndicatorKey.value]))
const { loading: chartLoading, error: chartError, range, activeIndex, isHovering, visibleWindow, height, quoteSide, selectRange, resetHover, resize, load, indexAtPixel, zoomToWindow } = useKlineChart({
  element: chartElement,
  history,
  period,
  movingAverages,
  mainIndicators,
  subIndicator,
})
const { expanded, inlineHeight, toggle } = useKlineFullscreen(panelElement, resize)
const isBusy = computed(() => chartLoading.value || props.loading)
const displayError = computed(() => props.error || chartError.value)
const showChart = computed(() => !isBusy.value && !displayError.value && history.value.length > 0)
const quote = computed(() => showChart.value ? getKlineQuote(history.value, activeIndex.value) : null)
const latestQuote = computed(() => showChart.value ? getKlineQuote(history.value, history.value.length - 1) : null)
const summary = computed(() => getWindowSummary(history.value, visibleWindow.value))
const layout = computed(() => getKlineLayout(height.value, subIndicatorKey.value))
const periodLabel = computed(() => KLINE_PERIODS.find((item) => item.key === period.value)?.label)

function setMA(period, enabled) {
  const item = maOptions.value.find((item) => item.period === period)
  if (item) item.enabled = enabled
}

function setIndicatorSettings(key, settings) {
  if (!(key in indicatorSettings.value)) return
  indicatorSettings.value[key] = { ...settings }
}
</script>

<template>
  <div class="index-chart-slot" :style="expanded ? { minHeight: `${inlineHeight}px` } : undefined">
    <Teleport to="body" :disabled="!expanded">
      <section ref="panelElement" class="index-chart" :class="{ 'is-expanded': expanded, 'has-wave': subIndicatorKey === 'wave' }" :role="expanded ? 'dialog' : undefined" :aria-modal="expanded ? true : undefined" :aria-label="`${instrument} K 线`" tabindex="-1">
        <div class="chart-main">
        <div class="chart-controls">
        <div v-if="!expanded" class="chart-heading">
          <h2>{{ instrument === '512890' ? 'ETF K 线' : '指数 K 线' }} <button type="button" class="info-button" aria-label="指数 K 线说明" title="日线在本地按自然周、月、季度聚合；MA、BOLL、KDJ、MACD、RSI 均按当前周期的完整已加载历史计算。滚轮缩放，拖动查看历史。"><Info :size="14" /></button></h2>
          <div class="heading-actions"><span class="instrument">{{ instrument }} · {{ periodLabel }}</span><button type="button" class="expand-button" :aria-label="expanded ? '退出全屏' : '放大全屏'" :title="expanded ? '退出全屏（ESC）' : '放大全屏'" @click="toggle"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /><span>{{ expanded ? '退出 · ESC' : '放大' }}</span></button></div>
        </div>

        <KLineToolbar
          :period="period"
          :range="range"
          :ma-options="maOptions"
          :boll-enabled="bollEnabled"
          :sub-indicator="subIndicatorKey"
          :wave-available="instrument === '512890'"
          :indicator-settings="indicatorSettings"
          :disabled="isBusy"
          @period-change="period = $event"
          @range-change="selectRange"
          @ma-change="setMA"
          @boll-change="bollEnabled = $event"
          @indicator-change="subIndicatorKey = $event"
          @settings-change="setIndicatorSettings"
        />
        </div>
        <KLineQuote hide-details :decimals="instrument === '512890' ? 3 : 2" :quote="quote" :moving-averages="movingAverages" :main-indicators="mainIndicators" :active-index="showChart ? activeIndex : -1" :is-latest="activeIndex === history.length - 1" />

        <KLineRangeSelection class="chart-body" :aria-busy="isBusy" :history="history" :layout="layout" :visible-window="visibleWindow" :index-at-pixel="indexAtPixel" :enabled="showChart" :instrument="instrument" :period-label="periodLabel" @zoom="zoomToWindow" @mouseleave="resetHover">
          <div ref="chartElement" class="chart-canvas" :style="{ visibility: showChart ? 'visible' : 'hidden' }" />
          <template v-if="showChart">
            <KLineQuote v-if="isHovering" floating hide-ma :side="quoteSide" :overlay-offset="layout.priceTop + 6" :decimals="instrument === '512890' ? 3 : 2" :quote="quote" :moving-averages="movingAverages" :active-index="activeIndex" :is-latest="activeIndex === history.length - 1" />
            <div class="sub-readout" :style="{ top: `${layout.volumeLabel}px` }" aria-label="当前成交量"><span>成交量</span><b :class="quote && quote.close >= quote.open ? 'up' : 'down'">{{ formatVolume(quote?.volume) }}</b></div>
            <div class="sub-readout" :style="{ top: `${layout.indicatorLabel}px` }" aria-label="当前副图指标数值"><span>{{ subIndicator.title }}</span><b v-for="line in subIndicator.lines" :key="line.id" :style="{ color: line.type === 'bar' ? (line.data[activeIndex] >= 0 ? '#ff454f' : '#00bec7') : line.color }">{{ line.name }}: {{ formatIndexValue(line.data[activeIndex], subIndicatorKey === 'wave' ? 3 : 2) }}</b></div>
          </template>
          <div v-else class="chart-state" role="status">
            <span>{{ displayError || (isBusy ? '正在读取行情…' : '暂无行情数据') }}</span>
            <button v-if="displayError" type="button" @click="error ? emit('retry') : load()">重试</button>
          </div>
        </KLineRangeSelection>

        </div>
        <aside v-if="expanded" class="chart-sidebar" aria-label="证券行情与指标信息">
          <div class="sidebar-heading"><h2>{{ instrument }} · {{ instrument === '512890' ? 'ETF' : '指数' }}</h2><button class="expand-button" aria-label="退出全屏" title="退出全屏（ESC）" @click="toggle"><Minimize2 :size="14" />退出</button></div>
          <p class="sidebar-name">{{ instrument === '512890' ? '华泰柏瑞红利低波ETF' : '中证红利低波动指数' }}</p>
          <p class="sidebar-price" :class="{ up: latestQuote?.change > 0, down: latestQuote?.change < 0 }">{{ formatIndexValue(latestQuote?.close, instrument === '512890' ? 3 : 2) }}</p>
          <p class="sidebar-caption">{{ latestQuote?.date ?? '—' }} · {{ periodLabel }}最新已同步行情</p>
          <section v-if="subIndicatorKey === 'wave'" class="sidebar-section" aria-label="波段信号详情">
            <h3>波段信号</h3>
            <div v-if="showChart" class="wave-readout">
              <span>{{ history[activeIndex]?.date }} · {{ subIndicator.values.bullish[activeIndex] ? '偏多' : '偏空／未就绪' }}</span>
              <span>量能饱和度：{{ formatIndexValue(subIndicator.values.saturation[activeIndex]) }}%</span>
              <span v-for="event in subIndicator.values.events[activeIndex]" :key="event.name" :style="{ color: event.color }">{{ event.name }}</span>
              <span v-if="!subIndicator.values.events[activeIndex]?.length">当前K线无信号</span>
            </div>
            <p class="wave-note">含未来函数，历史信号可能重绘；使用未复权行情。{{ subIndicator.values.missingTurnover ? '部分K线缺少换手率，短买点不计算。' : '' }}当前已加载 {{ history.length }} 根K线，历史回补会影响计算结果。</p>
          </section>
          <div v-if="summary && showChart" class="range-summary sidebar-section">
            <span>{{ summary.startDate }} — {{ summary.endDate }} · {{ visibleWindow.endIndex - visibleWindow.startIndex + 1 }} 根</span>
            <span :class="summary.changePercent >= 0 ? 'up' : 'down'">区间 {{ summary.changePercent > 0 ? '+' : '' }}{{ summary.changePercent.toFixed(2) }}%</span>
          </div>
          <YieldMetricCard :instrument="instrument" />
          <p class="sidebar-note">股息率和国债收益率为各自最新发布值。未提供的字段显示 —。</p>
        </aside>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.wave-note { color: #b8a77b; font-size: 11px; line-height: 1.6; padding: 5px 0; }
.wave-readout { display: flex; flex-wrap: wrap; gap: 5px 14px; color: #bfc3d1; font-size: 11px; padding: 8px 0; min-height: 30px; }
.index-chart-slot { display: flex; min-width: 0; min-height: 580px; }
.index-chart { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 14px 15px 11px; border: 1px solid #30333e; border-radius: 10px; background: #101116; color: #bcc1cf; }
.index-chart.is-expanded { position: fixed; inset: 0; z-index: 1000; width: 100%; height: 100dvh; min-height: 0; padding: 6px 10px; border: 0; border-radius: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }
.chart-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.chart-main > :not(.chart-body) { flex-shrink: 0; }
.index-chart.is-expanded { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 10px; }
.chart-sidebar { min-height: 0; overflow-y: auto; border-left: 1px solid #30333e; padding: 4px 10px; }
.sidebar-heading { position: sticky; top: -4px; z-index: 6; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-block: 4px; background: #101116; }
.sidebar-heading h2 { color: #dfe5f1; font-size: 14px; }
.sidebar-name, .sidebar-caption, .sidebar-note { color: #959baa; font-size: 11px; line-height: 1.6; margin-top: 5px; }
.sidebar-price { font-size: 30px; line-height: 1.4; font-variant-numeric: tabular-nums; }
.sidebar-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid #30333e; }
.sidebar-section h3 { font-size: 12px; color: #dfe5f1; font-weight: 500; }
.sidebar-section .wave-readout { flex-direction: column; align-items: flex-start; }
.chart-sidebar :deep(.quote-values) { display: grid; grid-template-columns: 1fr; gap: 6px; }
.chart-sidebar :deep(.quote-values > span) { display: flex; justify-content: space-between; }
.chart-sidebar :deep(.quote-date) { justify-content: space-between; }
.chart-sidebar :deep(.yield-card) { margin-top: 12px; padding: 12px 0 0; border: 0; border-top: 1px solid #30333e; border-radius: 0; background: transparent; box-shadow: none; }
.is-expanded .chart-main > :deep(.kline-quote) { padding: 2px 0; }
.is-expanded .chart-controls { display: flex; align-items: flex-start; gap: 8px; position: sticky; top: -6px; z-index: 5; background: #101116; border-bottom: 1px solid #272a33; }
.is-expanded .chart-heading { order: 2; flex-shrink: 0; padding-top: 4px; gap: 8px; }
.is-expanded .chart-heading h2 { font-size: 12px; white-space: nowrap; }
.is-expanded .heading-actions .instrument { display: none; }
.chart-heading, .heading-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.chart-heading h2 { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: #e4e6ec; }
.instrument { color: #959baa; font-size: 10px; white-space: nowrap; }
.info-button { display: inline-flex; padding: 0; border: 0; background: none; color: #797f8c; }
.expand-button, .chart-state button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: 1px solid #383d49; border-radius: 4px; background: #20232c; color: #c8cdd9; font-size: 10px; }
.expand-button:hover, .chart-state button:hover { background: #303643; color: #fff; }
.chart-body { position: relative; flex: 1 0 680px; min-height: 680px; }
.has-wave .chart-body { flex-basis: 740px; min-height: 740px; }
.chart-canvas { position: absolute; inset: 0; }
.is-expanded .chart-body { flex: 1 0 0px; min-height: 480px; }
.is-expanded.has-wave .chart-body { flex-basis: 0px; min-height: 520px; }
.is-expanded :deep(.kline-toolbar) { flex: 1; min-width: 0; padding-block: 4px; gap: 4px 12px; border-bottom: 0; }
.is-expanded :deep(.toolbar-main) { gap: 5px; }
.is-expanded .wave-note { padding-block: 2px; }
.is-expanded .wave-readout { min-height: 22px; padding-block: 3px; }
.sub-readout { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 12px; height: 20px; border-top: 1px solid #272a33; background: #17191f; color: #b0b6c6; font-size: 11px; font-variant-numeric: tabular-nums; pointer-events: none; }
.sub-readout b { font-weight: 400; white-space: nowrap; }
.chart-state { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 12px; color: #979dab; }
.range-summary { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; padding-top: 8px; color: #a0a6b6; font-size: 10px; font-variant-numeric: tabular-nums; }
.up { color: #ff454f; }
.down { color: #00bec7; }
.is-expanded :deep(.kline-quote), .is-expanded .sub-readout { font-size: 13px; }
@media (max-width: 500px) {
  .instrument { display: none; }
  .index-chart.is-expanded { padding-inline: 10px; }
  .sub-readout { gap: 8px; font-size: 10px; }
}
@media (max-width: 900px) {
  .index-chart.is-expanded { display: flex; }
  .is-expanded .chart-main { flex: 1 0 auto; }
  .chart-sidebar { overflow: visible; border-left: 0; border-top: 1px solid #30333e; }
  .chart-sidebar :deep(.quote-values) { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; }
}
</style>
