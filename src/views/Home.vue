<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ArrowRight, RefreshCw, Database } from 'lucide-vue-next'
import MetricCard from '../components/MetricCard.vue'
import IndexChart from '../components/IndexChart.vue'
import ValuationAnalysis from '../components/ValuationAnalysis.vue'
import LatestIndexMetrics from '../components/LatestIndexMetrics.vue'
import { getMarketData } from '../api/h30269.js'
import { getYield } from '../api/yields.js'
import { getValuation, VALUATION_SOURCE } from '../api/valuations.js'
import { formatIndexValue } from '../utils/indexHistory.js'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const isEtf = computed(() => props.instrument === '512890')
const instrumentName = computed(() => isEtf.value ? '华泰柏瑞红利低波ETF' : '中证红利低波动指数')
const prefix = computed(() => isEtf.value ? '标的指数' : '指数')
const state = reactive(Object.fromEntries(['market', 'dividend', 'valuation', 'treasury'].map(key => [key, { data: null, loading: false, error: '' }])))
const requestIds = { market: 0, dividend: 0, valuation: 0, treasury: 0 }
const sources = {
  dividend: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls',
  treasury: 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc',
}
const valuationAnalysis = ref(null)
const performanceMetrics = ref(null)
const loading = computed(() => Object.values(state).some(item => item.loading) || valuationAnalysis.value?.loading || performanceMetrics.value?.loading)
const dailyHistory = computed(() => state.market.data?.history ?? [])
const latest = computed(() => state.market.data?.latest)
const dateOf = kind => kind === 'market' ? latest.value?.date : state[kind].data?.date
const datesDiffer = computed(() => new Set(Object.keys(state).map(dateOf).filter(Boolean)).size > 1)
const statusLabel = computed(() => {
  if (loading.value) return '正在读取数据…'
  if (Object.values(state).some(item => item.error) || performanceMetrics.value?.error) return '部分数据读取失败，可重试'
  if (!dailyHistory.value.length) return '暂无行情数据'
  return datesDiffer.value ? '数据日期不一致，请分别查看' : '数据已读取 · 日线数据'
})
const hasWarning = computed(() => datesDiffer.value || Object.values(state).some(item => item.error) || performanceMetrics.value?.error)
const period = kind => state[kind].loading ? '正在读取…' : dateOf(kind) ? `数据日期：${dateOf(kind)}` : '暂无数据'
const formatYield = (kind, digits) => state[kind].data ? `${state[kind].data.value.toFixed(digits)}%` : '—'
const metrics = computed(() => [
  { key: 'market', title: isEtf.value ? 'ETF 价格' : '指数点位', value: formatIndexValue(latest.value?.close, isEtf.value ? 3 : 2), description: isEtf.value ? '日线收盘价 · 元' : '日线收盘点位', source: '东方财富', detail: `${props.instrument} · 最新已同步交易日行情。`, accent: 'blue' },
  { key: 'dividend', title: `${prefix.value}股息率`, value: formatYield('dividend', 2), description: 'H30269 · 总股本口径', source: '中证指数', sourceUrl: sources.dividend, detail: isEtf.value ? '展示跟踪指数的股息率，不代表 ETF 实际分红收益率。' : '采用中证指数发布的总股本口径股息率。', accent: 'cyan' },
  ...['pe', 'pb'].map(kind => ({ key: kind, kind: 'valuation', title: `${prefix.value} ${kind.toUpperCase()}`, value: state.valuation.data ? `${state.valuation.data[kind].toFixed(2)} 倍` : '—', description: `${kind === 'pe' ? '市盈率' : '市净率'} · 东方财富口径`, source: '东方财富 / 天天基金', sourceUrl: VALUATION_SOURCE, detail: `H30269 · ${kind === 'pe' ? 'TTM' : '加权'}口径待确认。`, accent: kind === 'pe' ? 'blue' : 'purple' })),
])
async function load(kind) {
  const requestId = ++requestIds[kind]
  const item = state[kind]
  item.loading = true
  item.error = ''
  try {
    const result = await (kind === 'market' ? getMarketData(props.instrument) : kind === 'valuation' ? getValuation() : getYield(kind))
    if (requestId === requestIds[kind]) item.data = result
  } catch (cause) {
    if (requestId === requestIds[kind]) item.error = cause?.message || '数据读取失败'
  } finally {
    if (requestId === requestIds[kind]) item.loading = false
  }
}
function refresh() { return Promise.all([...Object.keys(state).map(load), valuationAnalysis.value?.refresh(), performanceMetrics.value?.refresh()]) }
watch(() => props.instrument, () => {
  document.title = `红利低波数据看板 · ${props.instrument}`
  state.market.data = null
  load('market')
}, { immediate: true })
for (const kind of ['dividend', 'valuation', 'treasury']) load(kind)
</script>

<template>
  <div class="dashboard">
    <section class="page-heading" aria-labelledby="index-title">
      <div><p class="eyebrow">首页 / 红利低波观察</p><h1 id="index-title">{{ instrumentName }} <span class="mono">{{ instrument }}</span></h1><p class="intro">以长期视角，观察红利与低波动的价值。</p></div>
      <button class="refresh-button" :disabled="loading" @click="refresh"><RefreshCw :size="14" />{{ loading ? '读取中' : '刷新数据' }}</button>
    </section>
    <div class="data-status" :class="{ warning: hasWarning }" role="status"><Database :size="14" /><span>{{ statusLabel }}</span><span class="status-caption">各项日期见卡片</span></div>
    <section id="key-metrics" class="metrics-grid" aria-label="关键指标">
      <MetricCard v-for="metric in metrics" :key="metric.key" v-bind="metric" :period="period(metric.kind || metric.key)" :aria-busy="state[metric.kind || metric.key].loading">
        <p v-if="state[metric.kind || metric.key].error" class="load-error" role="status">读取失败{{ state[metric.kind || metric.key].data ? '，保留上次数据' : '' }} <button :disabled="state[metric.kind || metric.key].loading" @click="load(metric.kind || metric.key)">重试</button></p>
      </MetricCard>
    </section>
    <LatestIndexMetrics id="performance-metrics" ref="performanceMetrics" :instrument="instrument" performance-only />
    <section id="market-chart" class="chart-section" aria-label="行情走势">
      <IndexChart :key="instrument" :instrument="instrument" :history="dailyHistory" :backfill-completed="state.market.data?.backfill?.completed === true" :loading="state.market.loading" :error="state.market.error" @retry="load('market')" />
      <p class="chart-hint">放大图表可查看指数详情和成分股 <ArrowRight :size="13" /></p>
    </section>
    <ValuationAnalysis id="valuation-analysis" ref="valuationAnalysis" :instrument="instrument" summary />
    <section id="data-notes" class="bottom-grid" aria-label="收益率参考与数据说明">
      <MetricCard title="中国十年期国债收益率" :value="formatYield('treasury', 4)" description="中债国债到期收益率曲线 · 10年" :period="period('treasury')" source="中债" :source-url="sources.treasury" detail="国债到期收益率与指数股息率口径不同，不能直接等同。" :aria-busy="state.treasury.loading">
        <p v-if="state.treasury.error" class="load-error" role="status">读取失败{{ state.treasury.data ? '，保留上次数据' : '' }} <button :disabled="state.treasury.loading" @click="load('treasury')">重试</button></p>
      </MetricCard>
      <article class="data-notes panel">
        <h2 class="panel-heading">数据说明</h2>
        <p v-if="isEtf">价格对应 512890 ETF；股息率、PE 和 PB 对应其跟踪指数 H30269。</p>
        <p>行情与指标分别更新，数据日期可能不同；页面展示最近一次已同步数据，不是实时行情。</p>
        <p v-if="dailyHistory.length">行情范围：<span class="mono">{{ dailyHistory[0].date }} — {{ latest?.date }}</span>，共 {{ dailyHistory.length }} 条日 K。{{ state.market.data?.backfill?.completed ? '历史数据已完成同步。' : '历史数据仍在补充。' }}</p>
        <p>点击指标卡右上角的信息按钮，可查看来源与口径说明。</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.dashboard { display: grid; gap: 16px; max-width: 1800px; margin: 0 auto; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0 0; }
.eyebrow { color: #8194b2; font-size: 11px; margin-bottom: 7px; }
h1 { font-size: clamp(19px, 1.8vw, 27px); font-weight: 650; line-height: 1.4; }
h1 .mono { display: inline-block; margin-left: 8px; color: #7899ca; font-size: .7em; font-weight: 500; }
.intro { margin-top: 5px; color: #899bb6; font-size: 12px; }
.refresh-button { display: flex; align-items: center; gap: 7px; flex-shrink: 0; padding: 8px 12px; border: 1px solid #2b3d58; border-radius: 8px; color: #b8ceec; background: #111d30; font-size: 12px; }
.refresh-button:disabled { opacity: .6; }
.data-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: #98abc7; font-size: 11px; }
.data-status.warning { color: #d5b57f; }
.status-caption { color: #8495ae; margin-left: auto; }
.metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.chart-section { min-width: 0; }
.chart-hint { display: flex; align-items: center; gap: 6px; margin-top: 9px; color: #889bb7; font-size: 11px; }
.bottom-grid { display: grid; grid-template-columns: minmax(250px, 1fr) minmax(0, 2fr); gap: 14px; }
.data-notes { padding: 18px 20px; }
.data-notes p { color: #93a4bf; margin-top: 9px; font-size: 12px; line-height: 1.7; }
.load-error { color: #d5b57f; font-size: 11px; margin-top: 7px; }
.load-error button { padding: 0; background: none; border: 0; color: #9bc5ff; text-decoration: underline; }
#key-metrics, #performance-metrics, #market-chart, #valuation-analysis, #data-notes { scroll-margin-top: calc(var(--header-height) + 18px); }
@media (max-width: 1100px) and (min-width: 901px), (max-width: 700px) { .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .dashboard { gap: 14px; }
  .page-heading { align-items: flex-start; gap: 8px; }
  h1 .mono { display: block; margin: 4px 0 0; }
  .intro { font-size: 11px; }
  .refresh-button { padding: 7px 9px; }
  .metrics-grid { gap: 10px; }
  .bottom-grid { grid-template-columns: minmax(0, 1fr); }
  .status-caption { display: none; }
}
</style>
