<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Info, Maximize2, Minimize2 } from 'lucide-vue-next'
import { formatIndexValue, getWindowSummary } from '../utils/indexHistory.js'
import { aggregateKlines, formatVolume, getKlineQuote, KLINE_PERIODS } from '../utils/kline.js'
import { calculateMA } from '../utils/indicators.js'
import { getKlineLayout } from '../charts/kline/config.js'
import { buildMainIndicator } from '../charts/kline/mainIndicators.js'
import { buildSubIndicator } from '../charts/kline/subIndicators.js'
import KLineToolbar from './kline/KLineToolbar.vue'
import KLineQuote from './kline/KLineQuote.vue'
import KLineRangeSelection from './kline/KLineRangeSelection.vue'
import KLineDrawingTools from './kline/KLineDrawingTools.vue'
import KLineNotesPanel from './kline/KLineNotesPanel.vue'
import KLineNotesOverlay from './kline/KLineNotesOverlay.vue'
import KLineTradesOverlay from './kline/KLineTradesOverlay.vue'
import YieldMetricCard from './YieldMetricCard.vue'
import LatestIndexMetrics from './LatestIndexMetrics.vue'
import ValuationAnalysis from './ValuationAnalysis.vue'
import IndexDetails from './IndexDetails.vue'
import IndexConstituents from './IndexConstituents.vue'
import { useKlineChart } from './kline/useKlineChart.js'
import { useKlineFullscreen } from './kline/useKlineFullscreen.js'
import { usePreferences } from '../composables/usePreferences.js'
import { useObservationNotes } from '../composables/useObservationNotes.js'
import { usePortfolioLedger } from '../composables/usePortfolioLedger.js'
import { projectLedgerTrades } from '../utils/portfolioLedger.js'
import { projectNotes } from '../utils/observationNotes.js'
import { chartExportMetadata, createChartPng, downloadBlob } from '../utils/chartExport.js'

const props = defineProps({
  instrument: { type: String, default: '512890' },
  history: { type: Array, default: () => [] },
  backfillCompleted: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  sourceNotice: { type: String, default: '' },
})
const emit = defineEmits(['retry'])
const chartElement = ref(null)
const panelElement = ref(null)
const preferences = usePreferences()
const preference = key => computed({
  get: () => preferences.state.charts[props.instrument][key],
  set: value => { preferences.state.charts[props.instrument][key] = value },
})
const period = preference('period')
const chartType = preference('chartType')
const maOptions = preference('maOptions')
const bollEnabled = preference('bollEnabled')
const bbiEnabled = preference('bbiEnabled')
const subIndicatorKey = preference('subIndicatorKey')
const sidebarView = ref('overview')
const overviewView = ref('analysis')
const indicatorSettings = preference('indicatorSettings')
const noteStore = useObservationNotes()
const ledger = usePortfolioLedger()
const tradesOverlay = ref(null), showTrades = ref(true)
const notesPanel = ref(null), notesOverlay = ref(null), drawingTools = ref(null)
const pickingNote = ref(false), exporting = ref(false), exportStatus = ref('')

const history = computed(() => aggregateKlines(props.history, period.value))
const chartTrades = computed(() => props.instrument === '512890' ? projectLedgerTrades(ledger.entries.value, props.history, history.value) : [])
const chartNotes = computed(() => projectNotes(noteStore.notes.value.filter(note => note.instrument === props.instrument)
  .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), props.history, history.value))
const maData = computed(() => Object.fromEntries(maOptions.value.map(({ period }) => [period, calculateMA(history.value, period)])))
const movingAverages = computed(() => maOptions.value.map((item) => ({ ...item, data: maData.value[item.period] })))
const mainIndicators = computed(() => [
  ...(bollEnabled.value ? [buildMainIndicator(history.value, 'boll', indicatorSettings.value.boll)] : []),
  ...(expanded.value && bbiEnabled.value ? [buildMainIndicator(history.value, 'bbi', indicatorSettings.value.bbi, { period: period.value })] : []),
])
const { expanded, inlineHeight, toggle } = useKlineFullscreen(panelElement, () => resize(), () => {
  if (!pickingNote.value) return false
  pickingNote.value = false
  return true
})
watch(expanded, value => { if (!value) pickingNote.value = false })
async function openConstituents() {
  sidebarView.value = 'constituents'
  if (!expanded.value) await toggle()
}
defineExpose({ openConstituents })
const compact = computed(() => !expanded.value)
const subIndicator = computed(() => buildSubIndicator(history.value, subIndicatorKey.value, indicatorSettings.value[subIndicatorKey.value]))
const { loading: chartLoading, error: chartError, range, activeIndex, isHovering, visibleWindow, height, quoteSide, selectRange, resetHover, resize, load, indexAtPixel, zoomToWindow, handleKeydown, chartRevision, pointAtPixel, pointToPixel, priceToPixel, exportImage } = useKlineChart({
  compact,
  pricePrecision: computed(() => props.instrument === '512890' ? 3 : 2),
  element: chartElement,
  history,
  period,
  chartType,
  movingAverages,
  mainIndicators,
  subIndicator,
})
const isBusy = computed(() => chartLoading.value || props.loading)
const displayError = computed(() => props.error || chartError.value)
const showChart = computed(() => !chartLoading.value && !chartError.value && history.value.length > 0)
const quote = computed(() => showChart.value ? getKlineQuote(history.value, activeIndex.value) : null)
const latestQuote = computed(() => showChart.value ? getKlineQuote(history.value, history.value.length - 1) : null)
const dataWindow = computed(() => ({ startIndex: visibleWindow.value.startIndex, endIndex: Math.min(history.value.length - 1, visibleWindow.value.endIndex) }))
const summary = computed(() => getWindowSummary(history.value, dataWindow.value))
const layout = computed(() => getKlineLayout(height.value, subIndicatorKey.value, compact.value))
const periodLabel = computed(() => KLINE_PERIODS.find((item) => item.key === period.value)?.label)
const defaultNotePoint = computed(() => quote.value ? { date: quote.value.date, price: quote.value.close } : null)

async function openNotes(noteId) {
  sidebarView.value = 'notes'
  if (!expanded.value) await toggle()
  await nextTick()
  if (noteId) notesPanel.value?.editNote(noteId)
  else notesPanel.value?.newNote(defaultNotePoint.value)
  notesPanel.value?.focusEditor()
}
function beginNotePick() {
  drawingTools.value?.cancel(); pickingNote.value = true
  chartElement.value?.scrollIntoView({ block: 'nearest' })
}
function acceptNotePoint(point) { pickingNote.value = false; notesPanel.value?.selectPoint(point) }
async function openTransaction(id) {
  if (expanded.value) await toggle()
  // Selecting the same marker again must reopen its editor after cancellation.
  ledger.select(null)
  await nextTick()
  ledger.select(id)
  await nextTick()
  document.getElementById('portfolio-ledger')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function locateNote(note) {
  if (!note.point) return
  const index = history.value.findIndex(row => row.date === note.point.date)
  const span = Math.min(history.value.length - 1, Math.max(20, visibleWindow.value.endIndex - visibleWindow.value.startIndex))
  const start = Math.max(0, Math.min(index - Math.floor(span / 2), history.value.length - 1 - span))
  zoomToWindow(start, start + span)
}
async function exportChart() {
  if (exporting.value || !showChart.value) return
  exporting.value = true; exportStatus.value = ''
  try {
    drawingTools.value?.cancel(); pickingNote.value = false
    await nextTick()
    const metadata = chartExportMetadata({ instrument: props.instrument, period: period.value, chartType: chartType.value,
      history: history.value, dailyHistory: props.history, window: visibleWindow.value,
      indicators: [...maOptions.value.filter(line => line.enabled).map(line => `MA${line.period}`), ...mainIndicators.value.map(item => item.title), ...(!compact.value ? [subIndicator.value.title] : [])],
      warning: [props.error ? '行情重新读取失败，使用原数据' : '', props.sourceNotice,
        !compact.value && subIndicatorKey.value === 'wave' ? '波段信号含未来函数，历史信号可能重绘' : ''].filter(Boolean).join('；') })
    if (showTrades.value && chartTrades.value.length) metadata.lines.push('含本机账本真实买卖标记：买入为红色上三角，卖出为绿色下三角；按所在 K 线低／高点定位，标记高度不代表成交价。')
    const blob = await createChartPng({ image: exportImage(), metadata,
      overlays: [drawingTools.value?.exportOverlay(), notesOverlay.value?.exportOverlay(), showTrades.value ? tradesOverlay.value?.exportOverlay() : null], notes: notesOverlay.value?.visibleNotes() ?? [] })
    downloadBlob(blob, metadata.filename)
    exportStatus.value = 'PNG 已导出，含证券、查看区间、行情日期及可见画线／笔记。'
  } catch (error) { exportStatus.value = `导出失败：${error.message}` }
  finally { exporting.value = false }
}

function setMainSettings(settings) {
  maOptions.value = settings.maOptions
  bollEnabled.value = settings.bollEnabled
  bbiEnabled.value = settings.bbiEnabled
}

function setIndicatorSettings(key, settings) {
  if (!(key in indicatorSettings.value)) return
  indicatorSettings.value[key] = { ...settings }
}
</script>

<template>
  <div class="index-chart-slot" :style="expanded ? { minHeight: `${inlineHeight}px` } : undefined">
    <Teleport to="body" :disabled="!expanded">
      <section ref="panelElement" class="index-chart" :class="{ 'is-expanded': expanded, 'has-wave': expanded && subIndicatorKey === 'wave' }" :role="expanded ? 'dialog' : undefined" :aria-modal="expanded ? true : undefined" :aria-label="`${instrument} K 线`" tabindex="-1">
        <div class="chart-main">
        <div class="chart-controls">
        <div v-if="!expanded" class="chart-heading">
          <h2>{{ instrument === '512890' ? 'ETF K 线' : '指数 K 线' }} <button type="button" class="info-button" aria-label="指数 K 线说明" title="日线在本地按自然周、月、季度聚合；MA、BOLL、KDJ、MACD、RSI 均按当前周期的完整已加载历史计算。滚轮缩放，拖动查看历史。"><Info :size="14" /></button></h2>
          <div class="heading-actions"><span class="instrument">{{ instrument }} · {{ periodLabel }}</span><button type="button" class="expand-button" :aria-label="expanded ? '退出全屏' : '放大全屏'" :title="expanded ? '退出全屏（ESC）' : '放大全屏'" @click="toggle"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /><span>{{ expanded ? '退出 · ESC' : '放大' }}</span></button></div>
        </div>

        <KLineToolbar
          :compact="compact"
          :period="period"
          :chart-type="chartType"
          :range="range"
          :ma-options="maOptions"
          :boll-enabled="bollEnabled"
          :bbi-enabled="bbiEnabled"
          :sub-indicator="subIndicatorKey"
          :wave-available="instrument === '512890'"
          :indicator-settings="indicatorSettings"
          :disabled="isBusy"
          @period-change="period = $event"
          @chart-type-change="chartType = $event"
          @range-change="selectRange"
          @main-settings-change="setMainSettings"
          @indicator-change="subIndicatorKey = $event"
          @settings-change="setIndicatorSettings"
        >
          <template #actions><button v-if="instrument === '512890'" type="button" class="chart-action" :aria-pressed="showTrades" @click="showTrades = !showTrades">{{ showTrades ? '隐藏' : '显示' }}真实交易</button><button type="button" class="chart-action" :disabled="isBusy" @click="openNotes()">观察笔记{{ chartNotes.length ? ` (${chartNotes.length})` : '' }}</button><button type="button" class="chart-action" :disabled="isBusy || !showChart || exporting" @click="exportChart">{{ exporting ? '导出中…' : '导出 PNG' }}</button></template>
        </KLineToolbar>
        <p v-if="exportStatus" class="wave-note" role="status">{{ exportStatus }}</p>
        <p v-if="showTrades && chartTrades.length" class="wave-note">真实交易：红色 ▲ 买入，绿色 ▼ 卖出；悬停查看实际成交价，点击打开账本。标记位于 K 线低／高点，{{ periodLabel }}同侧多笔交易合并显示。</p>
        </div>
        <KLineQuote hide-details :decimals="instrument === '512890' ? 3 : 2" :quote="quote" :moving-averages="movingAverages" :main-indicators="mainIndicators" :active-index="showChart ? activeIndex : -1" :is-latest="activeIndex === history.length - 1" />

        <p v-if="showChart && error" class="wave-note" role="status">行情文件读取失败，保留上次图表与原日期。<button type="button" :disabled="isBusy" @click="emit('retry')">重新读取</button></p>
        <p v-else-if="showChart && loading" class="wave-note" role="status">正在重新读取行情，暂显示上次图表。</p>
        <KLineRangeSelection class="chart-body" :aria-busy="isBusy" :history="history" :layout="layout" :visible-window="visibleWindow" :index-at-pixel="indexAtPixel" :enabled="showChart" :instrument="instrument" :period-label="periodLabel" @zoom="zoomToWindow" @mouseleave="resetHover">
            <div ref="chartElement" class="chart-canvas" tabindex="0" aria-label="K线图，按左右方向键查看上一根或下一根K线" aria-keyshortcuts="ArrowLeft ArrowRight" :style="{ visibility: showChart ? 'visible' : 'hidden' }" @pointerdown="chartElement?.focus({ preventScroll: true })" @keydown="handleKeydown" />
          <template v-if="showChart">
            <KLineDrawingTools v-if="expanded" ref="drawingTools" :instrument="instrument" :period="period" :layout="layout" :revision="chartRevision" :point-at-pixel="pointAtPixel" :point-to-pixel="pointToPixel" :price-to-pixel="priceToPixel" @begin="pickingNote = false" />
            <KLineNotesOverlay ref="notesOverlay" :notes="chartNotes" :layout="layout" :revision="chartRevision" :point-at-pixel="pointAtPixel" :point-to-pixel="pointToPixel" :picking="pickingNote" @select="openNotes" @point="acceptNotePoint" @cancel="pickingNote = false" />
            <KLineTradesOverlay v-if="instrument === '512890' && showTrades" ref="tradesOverlay" :trades="chartTrades" :layout="layout" :revision="chartRevision" :point-to-pixel="pointToPixel" @select="openTransaction" />
            <KLineQuote v-if="isHovering" floating hide-ma :side="quoteSide" :overlay-offset="layout.priceTop + 6" :decimals="instrument === '512890' ? 3 : 2" :quote="quote" :moving-averages="movingAverages" :active-index="activeIndex" :is-latest="activeIndex === history.length - 1" />
            <div v-if="expanded" class="sub-readout" :style="{ top: `${layout.volumeLabel}px` }" aria-label="当前成交量"><span>成交量</span><b :class="quote && quote.close >= quote.open ? 'up' : 'down'">{{ formatVolume(quote?.volume) }}</b></div>
            <div v-if="expanded" class="sub-readout" :style="{ top: `${layout.indicatorLabel}px` }" aria-label="当前副图指标数值"><span>{{ subIndicator.title }}</span><b v-for="line in subIndicator.lines" :key="line.id" :style="{ color: line.type === 'bar' ? (line.data[activeIndex] >= 0 ? '#ff454f' : '#00bec7') : line.color }">{{ line.name }}: {{ formatIndexValue(line.data[activeIndex], subIndicatorKey === 'wave' ? 3 : 2) }}</b></div>
          </template>
          <div v-else class="chart-state" role="status">
            <span>{{ displayError || (isBusy ? '正在读取行情…' : '暂无行情数据') }}</span>
            <button v-if="displayError" type="button" @click="error ? emit('retry') : load()">重试</button>
          </div>
        </KLineRangeSelection>

        </div>
        <aside v-if="expanded" class="chart-sidebar" aria-label="证券行情与指标信息">
          <div class="sidebar-top">
          <div class="sidebar-heading"><h2>{{ instrument }} · {{ instrument === '512890' ? 'ETF' : '指数' }}</h2><button class="expand-button" aria-label="退出全屏" title="退出全屏（ESC）" @click="toggle"><Minimize2 :size="14" />退出</button></div>
          <div class="sidebar-switch" role="group" aria-label="右侧信息切换">
            <button type="button" :aria-pressed="sidebarView === 'overview'" @click="sidebarView = 'overview'; pickingNote = false">简况</button>
            <button type="button" :aria-pressed="sidebarView === 'constituents'" @click="sidebarView = 'constituents'; pickingNote = false">成分股</button>
            <button type="button" :aria-pressed="sidebarView === 'notes'" @click="sidebarView = 'notes'">笔记</button>
          </div>
          <div v-show="sidebarView === 'overview'" class="sidebar-switch sidebar-sub-switch" role="group" aria-label="简况内容切换">
            <button type="button" :aria-pressed="overviewView === 'analysis'" @click="overviewView = 'analysis'">指数分析</button>
            <button type="button" :aria-pressed="overviewView === 'details'" @click="overviewView = 'details'">指数详情</button>
          </div>
          </div>
          <div v-show="sidebarView === 'overview'" aria-label="简况">
          <div v-show="overviewView === 'analysis'" aria-label="指数分析">
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
            <span>{{ summary.startDate }} — {{ summary.endDate }} · {{ dataWindow.endIndex - dataWindow.startIndex + 1 }} 根</span>
            <span :class="summary.changePercent >= 0 ? 'up' : 'down'">区间 {{ summary.changePercent > 0 ? '+' : '' }}{{ summary.changePercent.toFixed(2) }}%</span>
          </div>
          <LatestIndexMetrics :instrument="instrument">
            <template #valuation><ValuationAnalysis :instrument="instrument" /></template>
          </LatestIndexMetrics>
          <YieldMetricCard :instrument="instrument" :show-dividend="false" />
          <p class="sidebar-note">国债收益率独立展示，不参与本版夏普计算。各项保留原始数据日期。</p>
          </div>
          <div v-show="overviewView === 'details'" aria-label="指数详情"><IndexDetails :instrument="instrument" /></div>
          </div>
          <div v-show="sidebarView === 'constituents'" aria-label="成分股"><IndexConstituents :instrument="instrument" /></div>
          <div v-show="sidebarView === 'notes'"><KLineNotesPanel ref="notesPanel" :instrument="instrument" :notes="chartNotes" :default-point="defaultNotePoint" :picking="pickingNote" @pick="beginNotePick" @cancel-pick="pickingNote = false" @locate="locateNote" /></div>
        </aside>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.wave-note { color: #b8a77b; font-size: 11px; line-height: 1.6; padding: 5px 0; }
.chart-action { padding: 3px 8px; border: 1px solid #373b48; border-radius: 3px; background: #1c1f28; color: #bfc3d1; font-size: 11px; white-space: nowrap; }
.chart-action:disabled { opacity: .45; }
.chart-action:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.wave-readout { display: flex; flex-wrap: wrap; gap: 5px 14px; color: #bfc3d1; font-size: 11px; padding: 8px 0; min-height: 30px; }
.index-chart-slot { display: flex; min-width: 0; min-height: 580px; }
.index-chart { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 14px 15px 11px; border: 1px solid #30333e; border-radius: 10px; background: #101116; color: #bcc1cf; }
.index-chart.is-expanded { position: fixed; inset: 0; z-index: 1000; width: 100%; height: 100dvh; min-height: 0; padding: 6px 10px; border: 0; border-radius: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; }
.chart-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.chart-main > :not(.chart-body) { flex-shrink: 0; }
.index-chart.is-expanded { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 10px; }
.chart-sidebar { min-height: 0; overflow-y: auto; border-left: 1px solid #30333e; padding: 4px 10px; }
.sidebar-top { position: sticky; top: -4px; z-index: 6; background: #101116; }
.sidebar-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-block: 4px; }
.sidebar-switch { display: flex; gap: 18px; margin-top: 8px; border-bottom: 1px solid #30333e; }
.sidebar-switch button { padding: 7px 2px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #959baa; font: inherit; font-size: 13px; cursor: pointer; }
.sidebar-switch button[aria-pressed="true"] { border-bottom-color: #67d5df; color: #67d5df; }
.sidebar-switch button:hover { color: #dfe5f1; }
.sidebar-switch button:focus-visible { outline: 1px solid #6382aa; outline-offset: 2px; }
.sidebar-sub-switch { gap: 8px; margin-top: 0; padding-block: 10px; border-bottom: 0; }
.sidebar-sub-switch button { padding: 5px 10px; border: 1px solid #30333e; border-radius: 4px; font-size: 12px; }
.sidebar-sub-switch button[aria-pressed="true"] { border-color: #39606b; background: #19303a; }
.sidebar-empty { padding: 28px 0; color: #959baa; font-size: 12px; text-align: center; }
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
.chart-body { position: relative; flex: 1 0 360px; min-height: 360px; }
.has-wave .chart-body { flex-basis: 740px; min-height: 740px; }
.chart-canvas { position: absolute; inset: 0; }
.chart-canvas:focus-visible { outline: 1px solid #6382aa; outline-offset: -1px; }
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
