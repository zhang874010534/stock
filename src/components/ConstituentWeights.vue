<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { compareWeights, weightedIndustries, weightSummary } from '../utils/constituentWeights.js'
import { downloadBlob } from '../utils/chartExport.js'

const props = defineProps({ classification: { type: Object, default: null } })
const dashboard = useDashboardData()
const indexState = dashboard.states.constituentWeights, etfState = dashboard.states.etfHoldings
const inputs = reactive({ index: null, etf: null })
const loading = computed(() => indexState.loading || etfState.loading)
const error = computed(() => [indexState.error, etfState.error].filter(Boolean).join('；'))
watch(() => [indexState.data, etfState.data, loading.value, error.value], () => {
  if (loading.value || (error.value && (inputs.index || inputs.etf))) return
  inputs.index = indexState.data; inputs.etf = etfState.data
}, { immediate: true })
const indexSummary = computed(() => weightSummary(inputs.index)), etfSummary = computed(() => weightSummary(inputs.etf))
const source = ref('index'), query = ref(''), filter = ref('all'), industry = ref('all'), message = ref('')
const selectedData = computed(() => source.value === 'index' ? inputs.index : inputs.etf)
const selectedSummary = computed(() => source.value === 'index' ? indexSummary.value : etfSummary.value)
const distribution = computed(() => weightedIndustries(selectedData.value, props.classification))
const referenceDates = computed(() => [...new Set((props.classification?.members ?? []).filter(row => row.industry).map(row => row.industryDate))].sort())
const comparison = computed(() => compareWeights(inputs.index, inputs.etf))
const classificationMap = computed(() => new Map((props.classification?.members ?? []).map(row => [`${row.exchange}:${row.code}`, row.industry ?? '未分类'])))
const labelOf = row => classificationMap.value.get(`${row.exchange}:${row.code}`) ?? '未分类'
const rows = computed(() => (comparison.value?.rows ?? []).filter(row => (filter.value === 'all' || row.presence === filter.value) && (industry.value === 'all' || labelOf(row) === industry.value) && `${row.code} ${row.name}`.toLowerCase().includes(query.value.trim().toLowerCase())))
watch(source, () => { industry.value = 'all' })
watch(distribution, value => { if (industry.value !== 'all' && !value.groups.some(row => row.label === industry.value)) industry.value = 'all' })
const pct = value => value === null ? '—' : `${(value * 100).toFixed(2)}%`
const precisePct = value => value > 0 && value < .0001 ? '<0.01%' : pct(value)
const difference = value => value !== 0 && Math.abs(value * 100) < .0005 ? `${value > 0 ? '+' : '−'}<0.001 pp` : `${value > 0 ? '+' : ''}${(value * 100).toFixed(3)} pp`
const presence = value => ({ both: '两边均有', index: '仅指数名单', etf: '仅 ETF 披露' })[value]
const hasWarning = computed(() => Boolean(error.value || [inputs.index, inputs.etf].some(data => !data || data.status !== 'ok')))
function exportCsv() {
  try {
    const csv = [
      ['指数权重日期', inputs.index.date, 'ETF 持仓日期', inputs.etf.date, 'ETF 披露日', inputs.etf.publishedDate],
      ['口径', '指数占指数组合；ETF占基金净资产；跨日差异不代表跟踪偏离', '行业参考来源日期', referenceDates.value.join(' / ')],
      ['指数采集状态', inputs.index.status, 'ETF采集状态', inputs.etf.status, '读取错误', error.value],
      ['指数来源', inputs.index.source, 'ETF来源', inputs.etf.source],
      ['代码', '名称', '行业参考', '指数权重(%)', 'ETF净资产占比(%)', '差异(百分点)', '名单关系', 'ETF持仓类别', 'ETF股数', 'ETF市值(元)'],
      ...rows.value.map(row => [row.code, row.name, labelOf(row), row.indexWeight * 100, row.etfWeight * 100, row.difference * 100, presence(row.presence), row.kind ?? '', row.shares ?? '', row.marketValue ?? '']),
    ].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `H30269_512890_权重对照_${inputs.index.date}_${inputs.etf.date}.csv`)
    message.value = '当前筛选的对照 CSV 已生成，已请求浏览器下载。'
  } catch { message.value = '导出失败，请重试。' }
}
defineExpose({ loading, hasWarning })
for (const key of ['constituentWeights', 'etfHoldings']) dashboard.ensure(key)
</script>

<template>
  <section id="constituent-weights" class="weights-analysis" aria-label="成分权重与实际持仓分析">
    <div class="weights-heading"><div><h3>成分权重与实际持仓分析</h3><p>H30269 指数组合 × 512890 ETF 完整股票披露</p></div><button type="button" :disabled="loading" @click="dashboard.refresh(['constituentWeights', 'etfHoldings'])">{{ loading ? '读取中…' : '重新读取权重与持仓' }}</button></div>
    <p v-if="error" class="weight-warning" role="status">读取失败{{ inputs.index || inputs.etf ? '，保留上次整组权重对照及原日期。' : '，暂无可用权重对照。' }}{{ error }}</p>
    <p v-for="data in [inputs.index, inputs.etf].filter(data => data && data.status !== 'ok')" :key="data.code" class="weight-warning">{{ data.code }}：{{ data.reason }}</p>
    <p v-if="!indexSummary.rows.length && !etfSummary.rows.length" class="weight-note">{{ loading ? '正在读取官方权重与完整披露持仓…' : '暂无权重数据，不用等权或股票数量代替。' }}</p>
    <div class="weight-cards">
      <article><h4>指数前十大集中度</h4><strong>{{ pct(indexSummary.topTen) }}</strong><p>权重日期 {{ inputs.index?.date ?? '暂无' }}<br/>完整成分 {{ indexSummary.rows.length }} 只 · 合计 {{ indexSummary.rows.length ? pct(indexSummary.total) : '—' }}</p><a v-if="indexSummary.rows.length" :href="inputs.index.source" target="_blank" rel="noopener noreferrer">中证官方权重 XLS</a></article>
      <article><h4>ETF 前十大股票 / 净资产</h4><strong>{{ pct(etfSummary.topTen) }}</strong><p>持仓日期 {{ inputs.etf?.date ?? '暂无' }}<br/>披露日期 {{ inputs.etf?.publishedDate ?? '暂无' }} · 完整股票 {{ etfSummary.rows.length }} 只</p><a v-if="etfSummary.rows.length" :href="inputs.etf.source" target="_blank" rel="noopener noreferrer">ETF 定期报告 · 全部股票</a></article>
      <article><h4>ETF 股票资产 / 净资产</h4><strong>{{ etfSummary.rows.length ? pct(etfSummary.total) : '—' }}</strong><p>按报告股票市值 ÷ 净资产计算<br/>{{ etfSummary.rows.length ? `非股票净额 ${pct(1 - etfSummary.total)}（其他资产减负债）` : '等待完整披露' }}</p></article>
    </div>
    <p class="weight-note">指数权重以指数组合为分母，ETF 以基金净资产为分母；ETF 股票占比不强行归一到 100%。采用最新已找到的完整中期／年度报告，包含指数投资与积极投资股票，非实时持仓；季度前十名不冒充完整名单。指数 XLS 舍入可能使合计略偏离 100%。</p>
    <p v-if="comparison && !comparison.sameDate" class="weight-warning">日期不同：指数 {{ inputs.index.date }}，ETF {{ inputs.etf.date }}。下方差异包含期间价格、调样和仓位变化，不能据此判断跟踪偏离。</p>
    <div class="weight-toolbar"><label>查看组合<select v-model="source" aria-label="权重分析组合"><option value="index">指数权重 · H30269</option><option value="etf">ETF 披露 · 512890</option></select></label><span>{{ selectedData?.date ?? '暂无日期' }}</span></div>
    <div v-if="selectedSummary.rows.length" class="weight-grid">
      <section aria-label="按权重计算的行业分布"><h4>行业权重分布</h4><p class="weight-note">{{ source === 'index' ? '占指数组合' : '占基金净资产' }} · 中证一级行业参考<br/>行业来源日期 {{ referenceDates.length ? referenceDates.join(' / ') : '暂无' }}。采用最近已保存分类参考，并非权重日的历史分类；未匹配权重单列，不混用报告的其他行业标准。</p>
        <p class="weight-note">已分类 {{ pct(distribution.classifiedWeight) }} · 未分类 {{ precisePct(distribution.unknownWeight) }}{{ distribution.staleWeight ? ` · 保留分类 ${pct(distribution.staleWeight)}` : '' }}</p>
        <ul class="weight-bars"><li v-for="group in distribution.groups" :key="group.label"><button type="button" :aria-pressed="industry === group.label" :aria-label="`筛选权重行业${group.label}`" @click="industry = industry === group.label ? 'all' : group.label"><span>{{ group.label }}</span><b>{{ precisePct(group.weight) }} <small>{{ group.count }} 只</small></b><span class="weight-track" aria-hidden="true"><span :style="{ width: `${Math.min(100, group.weight * 100)}%` }" :class="{ unknown: !group.industry }" /></span></button></li></ul>
      </section>
      <section aria-label="前十大权重股票"><h4>{{ source === 'index' ? '指数' : 'ETF' }} 前十大股票</h4><ol class="top-weights"><li v-for="row in selectedSummary.topTenRows" :key="row.code"><span>{{ row.name }}<small>{{ row.code }} · {{ labelOf(row) }}</small></span><b>{{ pct(row.weight) }}</b></li></ol></section>
    </div>
    <section id="holdings-comparison" class="holdings-comparison" aria-label="指数与ETF披露持仓对照">
      <div class="weights-heading"><h4>指数与 ETF 披露持仓对照</h4><button type="button" :disabled="!comparison || loading" @click="exportCsv">导出筛选对照 CSV</button></div>
      <p v-if="!comparison" class="weight-note">两份完整数据均可用后展示逐股对照；缺失的来源不视为零持仓。</p>
      <template v-else>
        <p class="weight-note">两边均有 {{ comparison.matched }} 只 · 仅指数 {{ comparison.indexOnly }} 只 · 仅 ETF {{ comparison.etfOnly }} 只。差异 = ETF 净资产占比 − 指数权重，pp 表示百分点。仅在已核验的完整名单内，未出现的股票按 0 计；极小持仓保留市值，不将报告舍入的 0.00% 当作没有持仓。</p>
        <div class="comparison-filters"><input v-model="query" type="search" aria-label="搜索权重对照股票" placeholder="股票代码 / 名称" /><select v-model="filter" aria-label="筛选持仓名单关系"><option value="all">全部名单关系</option><option value="both">两边均有</option><option value="index">仅指数名单</option><option value="etf">仅 ETF 披露</option></select><button type="button" @click="industry = 'all'; filter = 'all'; query = ''">清除筛选</button><span>{{ rows.length }} / {{ comparison.rows.length }} 只{{ industry === 'all' ? '' : ` · ${industry}` }}</span></div>
        <div class="weight-table-scroll" tabindex="0" role="region" aria-label="权重与持仓对照表，可横向滚动"><table><thead><tr><th scope="col">股票 / 行业参考</th><th scope="col">指数权重</th><th scope="col">ETF / 净资产</th><th scope="col">差异</th><th scope="col">名单关系</th><th scope="col">ETF 股数 / 市值</th></tr></thead><tbody><tr v-for="row in rows" :key="`${row.exchange}:${row.code}`"><td>{{ row.name }}<small>{{ row.code }} · {{ labelOf(row) }}</small></td><td>{{ pct(row.indexWeight) }}</td><td>{{ precisePct(row.etfWeight) }}</td><td>{{ difference(row.difference) }}</td><td>{{ presence(row.presence) }}<small v-if="row.kind">{{ row.kind === 'active' ? '积极投资股票' : '指数投资股票' }}</small></td><td>{{ row.shares?.toLocaleString('zh-CN') ?? '—' }}<small>{{ row.marketValue ? `${row.marketValue.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元` : '—' }}</small></td></tr></tbody></table><p v-if="!rows.length" class="weight-note">没有匹配股票。</p></div>
      </template>
      <p v-if="message" role="status" class="weight-note">{{ message }}</p>
    </section>
  </section>
</template>

<style scoped>
.weights-analysis { margin-top: 22px; padding-top: 18px; border-top: 1px solid #26374e; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.weights-heading, .weight-toolbar, .comparison-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; } h3 { font-size: 14px; color: #cfdef4; } h4 { font-size: 12px; font-weight: 500; color: #b9cbe4; }
.weight-note, .weight-warning, .weights-heading p, .weight-toolbar, .comparison-filters { font-size: 11px; color: #93a4bf; line-height: 1.85; margin-top: 10px; overflow-wrap: anywhere; }.weight-warning { color: #e4bd84; }
button, select, input { background: #111d30; color: #c7d8f2; border: 1px solid #33435b; border-radius: 6px; padding: 8px 10px; font: inherit; font-size: 11px; min-width: 0; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, select:focus-visible, input:focus-visible, .weight-table-scroll:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; } select { margin-left: 8px; } a { color: #8fb9f3; font-size: 11px; }
.weight-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }.weight-cards article { border: 1px solid #27394f; border-radius: 8px; background: #0a1423; padding: 15px; min-width: 0; }.weight-cards strong { display: block; color: #89dce4; font-size: 26px; font-family: var(--font-mono); margin-top: 12px; }.weight-cards p { color: #93a4bf; font-size: 11px; line-height: 1.85; margin: 9px 0; }
.weight-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; margin-top: 18px; }.weight-grid section { min-width: 0; }.weight-bars { list-style: none; padding: 0; margin-top: 12px; display: grid; gap: 7px; }.weight-bars button { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; text-align: left; }.weight-bars button[aria-pressed="true"] { background: #183253; border-color: #408cff; }.weight-bars b { font-weight: 500; }.weight-bars small { display: inline; margin-left: 6px; }.weight-track { grid-column: 1 / -1; height: 5px; background: #0a1220; border-radius: 3px; overflow: hidden; }.weight-track span { display: block; height: 100%; background: #63bfc5; }.weight-track .unknown { background: #a48f72; }
.top-weights { list-style: decimal; margin: 12px 0 0 23px; padding: 0; font-size: 11px; color: #7890b0; }.top-weights li { padding: 8px 0; border-bottom: 1px solid #223049; }.top-weights li span { display: inline-block; color: #c7d8f2; }.top-weights b { float: right; color: #a4dfe4; font-family: var(--font-mono); font-weight: 500; } small { display: block; font-size: 10px; color: #93a4bf; margin-top: 4px; }
.holdings-comparison { margin-top: 22px; padding-top: 16px; border-top: 1px solid #26374e; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }.comparison-filters { justify-content: flex-start; }.comparison-filters select { margin-left: 0; }.weight-table-scroll { overflow: auto; max-height: 420px; margin-top: 14px; } table { width: 100%; min-width: 690px; border-collapse: collapse; font-size: 11px; color: #c7d8f2; } th, td { padding: 10px; text-align: left; border-bottom: 1px solid #223049; } th { position: sticky; top: 0; background: #111d30; color: #93a4bf; font-weight: 400; } td:not(:first-child) { white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (max-width: 760px) { .weight-cards, .weight-grid { grid-template-columns: minmax(0, 1fr); }.weights-heading { align-items: flex-start; }.comparison-filters input { width: 100%; }.weight-toolbar label { width: 100%; }.weight-toolbar select { max-width: calc(100% - 70px); } }
</style>
