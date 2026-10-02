<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ArrowRight, RefreshCw, Database } from 'lucide-vue-next'
import MetricCard from '../components/MetricCard.vue'
import IndexChart from '../components/IndexChart.vue'
import ValuationAnalysis from '../components/ValuationAnalysis.vue'
import LatestIndexMetrics from '../components/LatestIndexMetrics.vue'
import DrawdownAnalysis from '../components/DrawdownAnalysis.vue'
import EtfIncomeAnalysis from '../components/EtfIncomeAnalysis.vue'
import EtfNavAnalysis from '../components/EtfNavAnalysis.vue'
import IndexComparisonAnalysis from '../components/IndexComparisonAnalysis.vue'
import LowVolatilityAnalysis from '../components/LowVolatilityAnalysis.vue'
import ConstituentStructure from '../components/ConstituentStructure.vue'
import DividendQualityAnalysis from '../components/DividendQualityAnalysis.vue'
import ObservationAlerts from '../components/ObservationAlerts.vue'
import InvestmentSimulator from '../components/InvestmentSimulator.vue'
import HoldingPeriodAnalysis from '../components/HoldingPeriodAnalysis.vue'
import YieldSpreadAnalysis from '../components/YieldSpreadAnalysis.vue'
import PortfolioLedger from '../components/PortfolioLedger.vue'
import ReviewSummary from '../components/ReviewSummary.vue'
import { provideDashboardData } from '../composables/useDashboardData.js'
import { VALUATION_SOURCE } from '../api/valuations.js'
import { formatIndexValue } from '../utils/indexHistory.js'
import { collectionNotice, dataFreshness } from '../utils/sourceStatus.js'
import { marketSummary, signedValue } from '../utils/marketSummary.js'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const isEtf = computed(() => props.instrument === '512890')
const instrumentName = computed(() => isEtf.value ? '华泰柏瑞红利低波ETF' : '中证红利低波动指数')
const prefix = computed(() => isEtf.value ? '标的指数' : '指数')
const dashboard = provideDashboardData()
const state = reactive({
  get market() { return dashboard.states[props.instrument] },
  dividend: dashboard.states.dividend, valuation: dashboard.states.valuation, treasury: dashboard.states.treasury,
  benchmark: dashboard.states['000300'],
})
const sources = {
  dividend: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls',
  treasury: 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc',
}
const valuationAnalysis = ref(null)
const performanceMetrics = ref(null)
const indexChart = ref(null)
const etfIncome = ref(null)
const etfNav = ref(null)
const indexComparison = ref(null)
const constituentStructure = ref(null)
const dividendQuality = ref(null)
const observationAlerts = ref(null)
const yieldSpread = ref(null)
const collection = dashboard.states.collection
const checkedAt = dashboard.checkedAt
const loading = computed(() => collection.loading || Object.values(state).some(item => item.loading) || valuationAnalysis.value?.loading || performanceMetrics.value?.loading || etfIncome.value?.loading || etfNav.value?.loading || indexComparison.value?.loading || constituentStructure.value?.loading || dividendQuality.value?.loading || yieldSpread.value?.loading)
const dailyHistory = computed(() => state.market.data?.history ?? [])
const latest = computed(() => state.market.data?.latest)
const priceSummary = computed(() => marketSummary(dailyHistory.value))
const priceTone = value => value > 0 ? 'price-up' : value < 0 ? 'price-down' : ''
const dateOf = kind => kind === 'market' ? latest.value?.date : kind === 'benchmark' ? state.benchmark.data?.latest.date : state[kind].data?.date
const datesDiffer = computed(() => new Set(Object.keys(state).map(dateOf).filter(Boolean)).size > 1)
const sourceKey = kind => ({ market: props.instrument, benchmark: '000300', dividend: 'dividend', valuation: 'valuation', treasury: 'bond', performance: 'H30269' })[kind]
const entryOf = kind => collection.data?.sources[sourceKey(kind)]
const noticeOf = kind => collectionNotice(entryOf(kind), { unavailable: Boolean(collection.error), hasData: kind === 'performance' ? Boolean(performanceMetrics.value?.asOf) : Boolean(state[kind].data) })
const freshnessOf = kind => dataFreshness(kind === 'performance' ? performanceMetrics.value?.asOf : dateOf(kind), { now: checkedAt.value, kind: ['market', 'performance', 'benchmark'].includes(kind) ? 'market' : 'indicator' })
const sourceRows = computed(() => [
  { kind: 'market', name: `${props.instrument} 行情` }, { kind: 'valuation', name: 'H30269 PE / PB 与估值历史' },
  { kind: 'dividend', name: 'H30269 股息率' }, { kind: 'treasury', name: '十年期国债收益率' },
  { kind: 'performance', name: 'H30269 收益风险的行情来源' },
  { kind: 'benchmark', name: '沪深300 对比行情' },
].map(row => ({ ...row, entry: entryOf(row.kind), notice: noticeOf(row.kind), freshness: freshnessOf(row.kind) })))
const collectionFailed = computed(() => sourceRows.value.some(row => row.notice.warning))
const oldData = computed(() => sourceRows.value.some(row => row.freshness.level === 'old'))
const collectionUnknown = computed(() => Boolean(collection.error) || sourceRows.value.some(row => !row.entry))
const formatTime = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '暂无记录'
const statusLabel = computed(() => {
  if (loading.value) return '正在读取数据…'
  const messages = []
  if (Object.values(state).some(item => item.error) || performanceMetrics.value?.error || valuationAnalysis.value?.error) messages.push('部分文件读取失败，可重新读取')
  if (collectionFailed.value) messages.push('部分后台更新失败')
  if (performanceMetrics.value?.hasWarning) messages.push('收益风险指标含保留值或不可用项')
  if (etfIncome.value?.hasWarning) messages.push('ETF 分红记录或收益范围待核验')
  if (etfNav.value?.hasWarning) messages.push('ETF 净值、折溢价或跟踪输入待核验')
  if (constituentStructure.value?.hasWarning) messages.push('成分股或行业分类覆盖待核验')
  if (dividendQuality.value?.hasWarning) messages.push('分红基本面数据或年度覆盖待核验')
  if (yieldSpread.value?.hasWarning) messages.push('收益率差值输入或更新状态待核验')
  if (oldData.value) messages.push('部分数据较旧')
  if (collectionUnknown.value) messages.push('部分后台采集状态未知')
  if (messages.length) return messages.join(' · ')
  if (!dailyHistory.value.length) return '暂无行情数据'
  return datesDiffer.value ? '各来源分别发布，数据日期可能不同' : '已读取保存的数据 · 非实时行情'
})
const hasWarning = computed(() => collectionFailed.value || oldData.value || Object.values(state).some(item => item.error) || performanceMetrics.value?.error || performanceMetrics.value?.hasWarning || valuationAnalysis.value?.error || etfIncome.value?.hasWarning || etfNav.value?.hasWarning || constituentStructure.value?.hasWarning || dividendQuality.value?.hasWarning || yieldSpread.value?.hasWarning)
const period = kind => state[kind].loading ? '正在读取…' : dateOf(kind) ? `数据日期：${dateOf(kind)}` : '暂无数据'
const formatYield = (kind, digits) => state[kind].data ? `${state[kind].data.value.toFixed(digits)}%` : '—'
const metrics = computed(() => [
  { key: 'market', title: isEtf.value ? 'ETF 价格' : '指数点位', value: formatIndexValue(latest.value?.close, isEtf.value ? 3 : 2), description: isEtf.value ? '日线收盘价 · 元' : '日线收盘点位', source: '东方财富', detail: `${props.instrument} · 最新已同步交易日行情。`, accent: 'blue' },
  { key: 'dividend', title: `${prefix.value}股息率`, value: formatYield('dividend', 2), description: 'H30269 · 总股本口径', source: '中证指数', sourceUrl: sources.dividend, detail: isEtf.value ? '展示跟踪指数的股息率，不代表 ETF 实际分红收益率。' : '采用中证指数发布的总股本口径股息率。', accent: 'cyan' },
  ...['pe', 'pb'].map(kind => ({ key: kind, kind: 'valuation', title: `${prefix.value} ${kind.toUpperCase()}`, value: state.valuation.data ? `${state.valuation.data[kind].toFixed(2)} 倍` : '—', description: `${kind === 'pe' ? '市盈率' : '市净率'} · 东方财富口径`, source: '东方财富 / 天天基金', sourceUrl: VALUATION_SOURCE, detail: `H30269 · ${kind === 'pe' ? 'TTM' : '加权'}口径待确认。`, accent: kind === 'pe' ? 'blue' : 'purple' })),
])
function load(kind) { return dashboard.refresh([kind === 'market' ? props.instrument : kind]) }
function loadCollection() { return dashboard.refresh(['collection']) }
function refresh() {
  const keys = Object.keys(dashboard.states).filter(key => dashboard.states[key].attempted &&
    (!['H30269', '512890'].includes(key) || key === props.instrument))
  return dashboard.refresh(keys)
}
watch(() => props.instrument, () => {
  document.title = `红利低波数据看板 · ${props.instrument}`
  dashboard.ensure(props.instrument)
}, { immediate: true })
for (const kind of ['dividend', 'valuation', 'treasury', 'collection']) dashboard.ensure(kind)
</script>

<template>
  <div class="dashboard">
    <section class="page-heading" aria-labelledby="index-title">
      <div><p class="eyebrow">首页 / 红利低波观察</p><h1 id="index-title">{{ instrumentName }} <span class="mono">{{ instrument }}</span></h1><p class="intro">以长期视角，观察红利与低波动的价值。</p></div>
      <div class="page-actions">
        <button class="refresh-button constituents-button" @click="indexChart?.openConstituents()">{{ isEtf ? '标的指数成分股' : '查看成分股' }} <ArrowRight :size="14" /></button>
        <button class="refresh-button" :disabled="loading" @click="refresh"><RefreshCw :size="14" />{{ loading ? '读取中' : '重新读取' }}</button>
      </div>
    </section>
    <div class="data-status" :class="{ warning: hasWarning }" role="status"><Database :size="14" /><span>{{ statusLabel }}</span><span class="status-caption">各项日期见卡片</span></div>
    <a v-if="observationAlerts?.activeCount" class="observation-notice" href="#observation-alerts" role="status">{{ instrument }} · {{ observationAlerts.activeCount }} 条观察条件满足 · 查看观察提醒 →</a>
    <details class="collection-details panel">
      <summary>查看后台采集状态与时间</summary>
      <p>重新读取只获取站点已保存的文件，不触发后台采集。来源日期不同本身不表示更新失败。</p>
      <p v-if="collection.error" role="status">采集状态文件暂不可用；已有记录仅供参考，不能确认当前状态。<button :disabled="collection.loading" @click="loadCollection">重试读取状态</button></p>
      <div v-for="row in sourceRows" :key="row.kind" class="source-row">
        <strong>{{ row.name }}</strong>
        <span :class="{ 'load-error': row.notice.warning }">{{ row.notice.text }}</span>
        <span v-if="row.entry?.error">原因：{{ row.entry.error }}</span>
        <span>最近尝试：{{ formatTime(row.entry?.lastAttemptAt) }} · 最近成功：{{ formatTime(row.entry?.lastSuccessAt) }}（北京时间）</span>
      </div>
      <p>成功时间是采集时间，不是数据日期。数据较旧按已覆盖的 A 股交易日历作时效参考：行情在 17:30、指标在 19:15 后计入当日，落后至少 2 个交易日才提示；国债也仅使用此参考，不代表其官方发布日历。</p>
    </details>
    <section id="key-metrics" class="metrics-grid" aria-label="关键指标">
      <MetricCard v-for="metric in metrics" :key="metric.key" v-bind="metric" :period="period(metric.kind || metric.key)" :aria-busy="state[metric.kind || metric.key].loading">
        <template #value-detail>
          <div v-if="metric.key === 'market'" class="price-summary" aria-label="行情涨跌摘要">
            <p :class="priceTone(priceSummary.change)"><span>日涨跌</span> <strong>{{ signedValue(priceSummary.change, isEtf ? 3 : 2) }}{{ priceSummary.change == null ? '' : isEtf ? ' 元' : ' 点' }}</strong> <strong>{{ signedValue(priceSummary.changePercent, 2, '%') }}</strong></p>
            <p v-if="priceSummary.dailyReason" class="price-note">{{ priceSummary.dailyReason }}</p>
            <p :class="priceTone(priceSummary.ytdPercent)"><span>{{ priceSummary.year ? `${priceSummary.year} 年初至今` : '年初至今' }}</span> <strong>{{ signedValue(priceSummary.ytdPercent, 2, '%') }}</strong></p>
            <p v-if="priceSummary.ytdReason" class="price-note">{{ priceSummary.ytdReason }}</p>
            <p v-else class="price-note">基准：{{ priceSummary.baseDate }} 收盘；截至 {{ priceSummary.date }}</p>
            <p class="price-note">{{ isEtf ? 'ETF 未复权价格涨跌，不含现金分红。' : '价格指数涨跌，不含分红再投资。' }}</p>
          </div>
        </template>
        <p v-if="!collection.loading" class="source-notice" :class="{ 'load-error': noticeOf(metric.kind || metric.key).warning }">{{ noticeOf(metric.kind || metric.key).text }}</p>
        <p v-if="!state[metric.kind || metric.key].loading && freshnessOf(metric.kind || metric.key).text" class="source-notice" :class="{ 'load-error': freshnessOf(metric.kind || metric.key).level === 'old' }">{{ freshnessOf(metric.kind || metric.key).text }}</p>
        <p v-if="state[metric.kind || metric.key].error" class="load-error" role="status">读取失败{{ state[metric.kind || metric.key].data ? '，保留上次数据' : '' }} <button :disabled="state[metric.kind || metric.key].loading" @click="load(metric.kind || metric.key)">重试</button></p>
      </MetricCard>
    </section>
    <section id="market-chart" class="chart-section" aria-label="行情走势">
      <IndexChart :key="instrument" ref="indexChart" :instrument="instrument" :history="dailyHistory" :backfill-completed="state.market.data?.backfill?.completed === true" :loading="state.market.loading" :error="state.market.error" :source-notice="noticeOf('market').warning ? noticeOf('market').text : ''" @retry="load('market')" />
      <p class="chart-hint">放大图表可查看指数详情和成分股 <ArrowRight :size="13" /></p>
    </section>
    <DrawdownAnalysis id="drawdown-analysis" :instrument="instrument" :history="dailyHistory" :loading="state.market.loading" :error="state.market.error" :backfill-completed="state.market.data?.backfill?.completed === true" :collection-notice="noticeOf('market').text" :collection-warning="noticeOf('market').warning" @retry="load('market')" />
    <ObservationAlerts id="observation-alerts" ref="observationAlerts" :instrument="instrument" />
    <LatestIndexMetrics id="performance-metrics" ref="performanceMetrics" :instrument="instrument" :collection-entry="entryOf('performance')" :collection-unavailable="Boolean(collection.error)" :checked-at="checkedAt" performance-only />
    <IndexComparisonAnalysis id="index-comparison" ref="indexComparison" :instrument="instrument" />
    <LowVolatilityAnalysis id="low-volatility" :instrument="instrument" :market="state.market.data" :loading="state.market.loading" :error="state.market.error" :collection-notice="noticeOf('market').text" :collection-warning="noticeOf('market').warning" @retry="load('market')" />
    <EtfIncomeAnalysis v-if="isEtf" id="etf-income" ref="etfIncome" :history="dailyHistory" :loading="state.market.loading" :error="state.market.error" :source-notice="noticeOf('market').warning ? noticeOf('market').text : ''" :backfill-completed="state.market.data?.backfill?.completed === true" @retry-market="load('market')" />
    <EtfNavAnalysis v-if="isEtf" id="etf-nav-analysis" ref="etfNav" />
    <PortfolioLedger v-if="isEtf" id="portfolio-ledger" :market="state.market.data" :loading="state.market.loading" :error="state.market.error" :source-notice="[noticeOf('market').warning ? noticeOf('market').text : '', freshnessOf('market').level === 'old' ? freshnessOf('market').text : ''].filter(Boolean).join('；')" />
    <InvestmentSimulator id="investment-simulator" :instrument="instrument" />
    <HoldingPeriodAnalysis id="holding-periods" :instrument="instrument" />
    <ValuationAnalysis id="valuation-analysis" ref="valuationAnalysis" :instrument="instrument" :collection-notice="noticeOf('valuation').text" :collection-warning="noticeOf('valuation').warning" summary />
    <YieldSpreadAnalysis id="yield-spread" ref="yieldSpread" :instrument="instrument" />
    <ConstituentStructure id="constituent-structure" ref="constituentStructure" :instrument="instrument" />
    <DividendQualityAnalysis id="dividend-quality" ref="dividendQuality" :instrument="instrument" />
    <ReviewSummary id="review-summary" :instrument="instrument" />
    <section id="data-notes" class="bottom-grid" aria-label="收益率参考与数据说明">
      <MetricCard title="中国十年期国债收益率" :value="formatYield('treasury', 4)" description="中债国债到期收益率曲线 · 10年" :period="period('treasury')" source="中债" :source-url="sources.treasury" detail="国债到期收益率与指数股息率口径不同，不能直接等同。" :aria-busy="state.treasury.loading">
        <p v-if="!collection.loading" class="source-notice" :class="{ 'load-error': noticeOf('treasury').warning }">{{ noticeOf('treasury').text }}</p>
        <p v-if="!state.treasury.loading && freshnessOf('treasury').text" class="source-notice" :class="{ 'load-error': freshnessOf('treasury').level === 'old' }">{{ freshnessOf('treasury').text }}</p>
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
.page-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.price-summary { display: grid; gap: 5px; margin-top: 10px; font-size: 11px; color: #a0b0c9; }
.price-summary p { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; line-height: 1.6; }
.price-summary strong { font-family: var(--font-mono); font-weight: 600; }
.price-summary .price-note { color: #879ab7; font-size: 10px; }
.price-up strong { color: #ff727c; }
.price-down strong { color: #55c99b; }
.eyebrow { color: #8194b2; font-size: 11px; margin-bottom: 7px; }
h1 { font-size: clamp(19px, 1.8vw, 27px); font-weight: 650; line-height: 1.4; }
h1 .mono { display: inline-block; margin-left: 8px; color: #7899ca; font-size: .7em; font-weight: 500; }
.intro { margin-top: 5px; color: #899bb6; font-size: 12px; }
.refresh-button { display: flex; align-items: center; gap: 7px; flex-shrink: 0; padding: 8px 12px; border: 1px solid #2b3d58; border-radius: 8px; color: #b8ceec; background: #111d30; font-size: 12px; }
.refresh-button:disabled { opacity: .6; }
.data-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: #98abc7; font-size: 11px; }
.data-status.warning { color: #d5b57f; }
.observation-notice { padding: 10px 14px; border: 1px solid #477874; border-radius: 8px; background: #0c242b; color: #89e3e9; font-size: 12px; }
.observation-notice:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.status-caption { color: #8495ae; margin-left: auto; }
.metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.chart-section { min-width: 0; }
.chart-hint { display: flex; align-items: center; gap: 6px; margin-top: 9px; color: #889bb7; font-size: 11px; }
.bottom-grid { display: grid; grid-template-columns: minmax(250px, 1fr) minmax(0, 2fr); gap: 14px; }
.data-notes { padding: 18px 20px; }
.data-notes p { color: #93a4bf; margin-top: 9px; font-size: 12px; line-height: 1.7; }
.load-error { color: #d5b57f; font-size: 11px; margin-top: 7px; }
.source-notice { color: #93a4bf; font-size: 11px; margin-top: 7px; line-height: 1.6; }
.source-notice.load-error { color: #d5b57f; }
.collection-details { padding: 12px 16px; color: #93a4bf; font-size: 11px; line-height: 1.8; }
.collection-details summary { cursor: pointer; color: #b8ceec; }
.collection-details p { margin-top: 8px; }
.collection-details button { background: none; border: 0; color: #9bc5ff; text-decoration: underline; }
.source-row { display: grid; gap: 2px; padding: 10px 0; border-bottom: 1px solid #24334b; overflow-wrap: anywhere; }
.load-error button { padding: 0; background: none; border: 0; color: #9bc5ff; text-decoration: underline; }
#key-metrics, #performance-metrics, #index-comparison, #market-chart, #drawdown-analysis, #low-volatility, #constituent-structure, #valuation-analysis, #data-notes { scroll-margin-top: calc(var(--header-height) + 18px); }
@media (max-width: 1100px) and (min-width: 901px), (max-width: 700px) { .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .dashboard { gap: 14px; }
  .page-heading { align-items: flex-start; gap: 8px; }
  .page-actions { flex-direction: column; align-items: flex-end; flex-shrink: 0; }
  h1 .mono { display: block; margin: 4px 0 0; }
  .intro { font-size: 11px; }
  .refresh-button { padding: 7px 9px; }
  .metrics-grid { gap: 10px; }
  .bottom-grid { grid-template-columns: minmax(0, 1fr); }
  .status-caption { display: none; }
}
</style>
