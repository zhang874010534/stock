<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateHoldingPeriods, holdingAnniversary, HOLDING_YEARS } from '../utils/holdingPeriods.js'
import { HOLDING_CONDITIONS, emptyHoldingFilters, normalizeHoldingFilters, holdingEntryEnvironments, filterHoldingWindows, classifyHoldingEntry } from '../utils/holdingConditions.js'
import { isSession, dateTimestamp, riskPercent } from '../utils/priceRisk.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { collectionNotice } from '../utils/sourceStatus.js'

const HoldingPeriodCharts = defineAsyncComponent(() => import('./HoldingPeriodCharts.vue'))
const props = defineProps({ instrument: { type: String, default: '512890' } })
const dashboard = useDashboardData(), distributions = dashboard.states.etfDistributions
const isEtf = computed(() => props.instrument === '512890')
const market = computed(() => dashboard.states[props.instrument])
const snapshots = reactive({ H30269: null, '512890': null }), snapshot = computed(() => snapshots[props.instrument])
const loading = computed(() => market.value.loading || (isEtf.value && distributions.loading))
const readError = computed(() => [market.value.error, isEtf.value ? distributions.error : ''].filter(Boolean).join('；'))
const years = ref(1), basis = ref(isEtf.value ? 'cash' : 'price'), selectedBuy = ref('')
const filterDraft = ref(emptyHoldingFilters()), filters = ref(normalizeHoldingFilters(emptyHoldingFilters())), filterError = ref('')
const valuations = dashboard.states.eastmoneyHistory
const valuationSnapshot = ref(null)
watch(() => [valuations.data, valuations.loading, valuations.error], () => {
  if (!valuations.loading && !valuations.error && valuations.data) valuationSnapshot.value = valuations.data
}, { immediate: true })
function applyFilters() {
  try { filters.value = normalizeHoldingFilters(filterDraft.value); filterError.value = '' }
  catch (error) { filterError.value = error.message }
}
function clearFilters() { filterDraft.value = emptyHoldingFilters(); filters.value = normalizeHoldingFilters(filterDraft.value); filterError.value = '' }
function preset(kind) {
  filterDraft.value = emptyHoldingFilters()
  if (kind === 'drawdown') filterDraft.value.drawdown.min = '10'
  else filterDraft.value.volatility.max = '15'
  applyFilters()
}
watch(() => [props.instrument, market.value.data, market.value.loading, market.value.error, distributions.data, distributions.loading, distributions.error], () => {
  if (!loading.value && market.value.data && (!isEtf.value || distributions.data) && (!snapshot.value || !readError.value)) snapshots[props.instrument] = { market: market.value.data, distribution: isEtf.value ? distributions.data : null }
}, { immediate: true })
function ensure() { dashboard.ensure(props.instrument); dashboard.ensure('eastmoneyHistory'); if (isEtf.value) dashboard.ensure('etfDistributions') }
watch(() => props.instrument, () => { years.value = 1; basis.value = isEtf.value ? 'cash' : 'price'; selectedBuy.value = ''; clearFilters(); ensure() }, { flush: 'sync' })
ensure(); dashboard.ensure('collection')
const result = computed(() => {
  if (!snapshot.value) return { stats: null, error: '' }
  try { return { stats: calculateHoldingPeriods(snapshot.value.market, { basis: basis.value, distribution: snapshot.value.distribution }), error: '' } }
  catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const environments = computed(() => stats.value ? holdingEntryEnvironments(snapshot.value.market, stats.value, valuationSnapshot.value) : null)
const studies = computed(() => stats.value?.series.map(series => filterHoldingWindows(series, environments.value, filters.value)) ?? [])
const study = computed(() => studies.value.find(item => item.baseline.years === years.value))
const selected = computed(() => study.value?.matched)
const valuationActive = computed(() => ['pe', 'pb'].some(key => filters.value[key].min !== null || filters.value[key].max !== null))
const filterPending = computed(() => HOLDING_CONDITIONS.some(({ key }) => ['min', 'max'].some(bound => {
  const draft = filterDraft.value[key][bound], applied = filters.value[key][bound]
  return (draft === '' || draft === null ? null : Number(draft)) !== applied
})))
const comparisonMetrics = [
  { key: 'count', label: '完整样本数量' }, { key: 'positiveRate', label: '历史正收益占比' },
  { key: 'median', label: '收益中位数' }, { key: 'mean', label: '收益平均值' },
  { key: 'p10', label: '收益 10% 分位' }, { key: 'p90', label: '收益 90% 分位' },
]
watch(selected, series => {
  if (!series?.points.some(point => point.buyDate === selectedBuy.value)) selectedBuy.value = series?.lastBuyDate ?? stats.value?.startDate ?? ''
}, { immediate: true })
const detail = computed(() => {
  if (!stats.value || !selectedBuy.value) return { point: null, reason: '请选择买入日期。' }
  try {
    dateTimestamp(selectedBuy.value)
    if (selectedBuy.value < stats.value.startDate || selectedBuy.value > stats.value.endDate) return { point: null, reason: '买入日期不在当前核验范围内。' }
    if (!isSession(selectedBuy.value, tradingCalendar)) return { point: null, reason: '该日不是交易日，请选择交易日买入。' }
    const point = study.value.baseline.points.find(item => item.buyDate === selectedBuy.value)
    if (point?.status === 'missing') return { point: null, reason: `该窗口 ${point.buyDate} — ${point.exitDate} 内存在缺失行情，未纳入统计。` }
    return point ? { point, reason: '' } : { point: null, reason: `目标周年 ${holdingAnniversary(selectedBuy.value, years.value)}，截至 ${stats.value.endDate} 尚未完成持有 ${years.value} 年（含休市顺延），不显示短期替代收益。` }
  } catch { return { point: null, reason: '请选择有效的买入日期。' } }
})
const notice = computed(() => collectionNotice(dashboard.states.collection.data?.sources[props.instrument], { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(snapshot.value) }))
const basisLabel = computed(() => isEtf.value ? basis.value === 'cash' ? 'ETF 含现金分红，不再投资' : 'ETF 价格收益，仅调整拆分' : '指数价格收益，不含分红')
const value = amount => Number.isFinite(amount) ? `${amount.toFixed(isEtf.value ? 4 : 2)} ${isEtf.value ? '元' : '点'}` : '—'
const cash = amount => `${amount.toFixed(4)} 元／期初 1 份`
const entryDetail = computed(() => environments.value?.observations.get(selectedBuy.value))
const entryClassification = computed(() => entryDetail.value ? classifyHoldingEntry(entryDetail.value, filters.value) : null)
const conditionValue = (key, entry) => Number.isFinite(entry?.[key]) ? `${entry[key].toFixed(2)} ${HOLDING_CONDITIONS.find(item => item.key === key).unit}` : '—'
const valuationNotice = computed(() => collectionNotice(dashboard.states.collection.data?.sources.valuation, { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(valuationSnapshot.value) }))
const refresh = () => dashboard.refresh([props.instrument, 'eastmoneyHistory', 'collection', ...(isEtf.value ? ['etfDistributions'] : [])])
defineExpose({ loading })
</script>

<template>
  <section class="holding-analysis panel" aria-label="滚动持有期分析" :aria-busy="loading">
    <header class="holding-heading"><div><h2>滚动持有期分析</h2><p>{{ instrument }} · 历史上逐个交易日买入，持有一年／三年</p></div><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取持有期数据' }}</button></header>
    <p class="holding-note">按每个买入日收盘价建仓，到对应周年日或之后的首个交易日收盘估值。只统计完整到期且区间行情齐全的窗口；下列收益均为整个持有期的累计收益。</p>
    <div class="holding-controls"><div role="group" aria-label="持有期限"><button v-for="period in HOLDING_YEARS" :key="period" type="button" :aria-pressed="years === period" @click="years = period">持有 {{ period }} 年</button></div><label v-if="isEtf">收益口径<select v-model="basis" aria-label="持有期收益口径"><option value="cash">含现金分红，不再投资</option><option value="price">价格收益，仅调整拆分</option></select></label><span v-else class="holding-note">指数价格收益，不能直接买入，不代表 ETF 持有结果。</span></div>
    <p v-if="readError" class="holding-warning" role="status">文件读取失败：{{ readError }}。{{ snapshot ? '保留上次整组行情与分红输入及原日期。' : '暂无完整分析输入。' }}</p>
    <p v-else-if="loading" class="holding-note" role="status">{{ snapshot ? '正在读取，暂显示上次分析。' : '正在读取持有期分析数据…' }}</p>
    <p v-if="snapshot" class="holding-note">行情截止 {{ snapshot.market.latest.date }} · {{ notice.text }}{{ snapshot.market.backfill.completed ? '' : ' · 历史仍在补充' }}。</p>
    <p v-if="isEtf && snapshot?.distribution?.coverage" class="holding-note">分红／拆分核验截至 {{ snapshot.distribution.coverage.end }}{{ snapshot.distribution.status === 'stale' ? ` · 保留记录：${snapshot.distribution.reason}` : '' }}。价格模式同样需要已核验拆分档案。</p>
    <p v-if="result.error" class="holding-warning" role="alert">暂不能分析：{{ result.error }}</p>
    <template v-if="stats">
      <p class="holding-note">分析范围 {{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个候选交易日 · {{ basisLabel }}。核验范围外 {{ stats.excludedBefore }} 条更早、{{ stats.excludedAfter }} 条更晚收盘样本未纳入。</p>
      <p v-if="stats.missingSessions" class="holding-warning">范围内缺少 {{ stats.missingSessions }} 个交易日行情，所有覆盖缺失日的持有窗口均已排除；曲线留空，不跨缺口连线。</p>
      <div class="holding-table-wrap"><table><caption>一年与三年的完整持有样本</caption><thead><tr><th scope="col">指标</th><th v-for="series in stats.series" :key="series.years" scope="col">持有 {{ series.years }} 年</th></tr></thead><tbody>
        <tr><th scope="row">完整有效样本</th><td v-for="series in stats.series" :key="series.years">{{ series.count }} 个</td></tr>
        <tr><th scope="row">历史正收益样本占比</th><td v-for="series in stats.series" :key="series.years">{{ riskPercent(series.positiveRate) }} <span v-if="series.count">（{{ series.positive }} / {{ series.count }}）</span></td></tr>
        <tr><th scope="row">负收益／持平样本</th><td v-for="series in stats.series" :key="series.years">{{ series.negative }} / {{ series.flat }}</td></tr>
        <tr v-for="metric in [{ key: 'median', label: '收益中位数' }, { key: 'mean', label: '收益平均值' }, { key: 'p10', label: '收益 10% 分位' }, { key: 'p90', label: '收益 90% 分位' }]" :key="metric.key"><th scope="row">{{ metric.label }}</th><td v-for="series in stats.series" :key="series.years">{{ riskPercent(series[metric.key], true) }}</td></tr>
        <tr><th scope="row">最低／最高收益</th><td v-for="series in stats.series" :key="series.years">{{ riskPercent(series.worst?.returnRate, true) }} / {{ riskPercent(series.best?.returnRate, true) }}</td></tr>
        <tr><th scope="row">尚未到期，未纳入</th><td v-for="series in stats.series" :key="series.years">{{ series.immatureCount }} 个</td></tr>
        <tr><th scope="row">窗口缺行情，未纳入</th><td v-for="series in stats.series" :key="series.years">{{ series.missingCount }} 个</td></tr>
      </tbody></table></div>
      <p class="holding-caution">每日买入的窗口彼此重叠，并非独立实验。正收益占比是已完成历史样本的频率，不是未来获利概率；近期未到期样本不进入分母。</p>
      <section class="holding-research" aria-label="条件化持有期研究">
        <h3>条件化持有期研究</h3>
        <p class="holding-note">用买入前一交易日已收盘数据描述环境，再在买入日收盘模拟建仓。多个条件同时满足才入选；留空表示不限制，边界包含等号。</p>
        <div class="holding-controls"><button type="button" @click="preset('drawdown')">回撤至少 10%</button><button type="button" @click="preset('volatility')">波动率不高于 15%</button><button type="button" @click="clearFilters">清除条件</button></div>
        <form class="holding-filter-form" aria-label="持有期买入环境条件" @submit.prevent="applyFilters">
          <fieldset v-for="condition in HOLDING_CONDITIONS" :key="condition.key"><legend>{{ condition.label }}（{{ condition.unit }}）</legend><label>下限<input v-model="filterDraft[condition.key].min" type="number" min="0" :max="condition.limit" step="any" :aria-label="`${condition.label}下限`" placeholder="不限" /></label><label>上限<input v-model="filterDraft[condition.key].max" type="number" min="0" :max="condition.limit" step="any" :aria-label="`${condition.label}上限`" placeholder="不限" /></label></fieldset>
          <div class="holding-filter-actions"><button type="submit">应用条件</button><span v-if="filterPending" class="holding-note" role="status">条件已修改，点击应用后更新结果。</span></div>
          <p v-if="filterError" class="holding-warning" role="alert">条件未应用：{{ filterError }}。保留上次条件和结果。</p>
        </form>
        <p class="holding-condition-label">当前条件：{{ study.label }} · 持有 {{ years }} 年 · {{ basisLabel }}</p>
        <p class="holding-note">回撤高点从 {{ environments.historyStart }} 已同步且连续的历史起算；60 日波动率需 61 个连续收盘。ETF 条件使用未复权场内价格，除息和拆分会影响回撤及波动率；估值为 H30269 {{ isEtf ? '标的指数' : '指数' }}东方财富口径。</p>
        <p v-if="environments.valuation.count" class="holding-note">估值已保存 {{ environments.valuation.count }} 次观察，日期 {{ environments.valuation.firstDate }} — {{ environments.valuation.lastDate }} · {{ valuationNotice.text }}。只匹配买入前一交易日的同日 PE／PB，不沿用旧值，不用后来观察回填。</p>
        <p v-else class="holding-note">尚无可用的同口径估值历史；回撤与波动率条件仍可独立研究。</p>
        <p v-if="valuations.loading" class="holding-note" role="status">正在读取估值历史{{ valuationSnapshot ? '，暂用上次已保存范围' : '，估值条件暂按缺失处理' }}。</p>
        <p v-if="valuations.error" class="holding-warning" role="status">估值读取失败：{{ valuations.error }}。{{ valuationSnapshot ? '保留上次估值输入和原观察日期。' : '估值条件不可核验，不按默认估值计算。' }}</p>
        <p v-if="environments.valuation.reason && valuationActive" class="holding-warning">估值条件不可核验：{{ environments.valuation.reason }}。</p>
        <div class="holding-table-wrap"><table><caption>持有 {{ years }} 年 · 同期限、同收益口径的买入环境对比</caption><thead><tr><th scope="col">指标</th><th scope="col">全部完整样本</th><th scope="col">符合条件</th><th scope="col">条件齐全但不符合</th></tr></thead><tbody>
          <tr v-for="metric in comparisonMetrics" :key="metric.key"><th scope="row">{{ metric.label }}</th><td v-for="group in [study.baseline, study.matched, study.excluded]" :key="metric.key + (group === study.baseline ? 'all' : group === study.matched ? 'matched' : 'excluded')">{{ metric.key === 'count' ? `${group.count} 个` : riskPercent(group[metric.key], metric.key !== 'positiveRate') }}</td></tr>
          <tr><th scope="row">最低／最高收益</th><td v-for="(group, index) in [study.baseline, study.matched, study.excluded]" :key="index">{{ riskPercent(group.worst?.returnRate, true) }} / {{ riskPercent(group.best?.returnRate, true) }}</td></tr>
          <tr><th scope="row">完整买入日覆盖</th><td v-for="(group, index) in [study.baseline, study.matched, study.excluded]" :key="index">{{ group.firstBuyDate ? `${group.firstBuyDate} — ${group.lastBuyDate}` : '—' }}</td></tr>
        </tbody></table></div>
        <p class="holding-note">{{ study.baseline.count }} 个完整收益窗口中，{{ study.matched.count }} 个符合条件，{{ study.excluded.count }} 个条件齐全但不符合，{{ study.unknownCount }} 个因所选条件缺失未参加环境分组。各组按买入日等权；全部样本含条件缺失窗口。</p>
        <p v-if="study.unknownCount" class="holding-warning">缺失条件：{{ HOLDING_CONDITIONS.filter(item => study.unknownByCondition[item.key]).map(item => `${item.label} ${study.unknownByCondition[item.key]} 个`).join('；') }}。同一窗口可缺少多项，分项计数可能重叠。</p>
        <p v-if="study.active && study.matched.count && study.matched.count < 30" class="holding-warning">符合条件的完整样本少于 30 个，覆盖有限；结果对少数重叠窗口较敏感。</p>
        <p class="holding-caution">条件用于历史环境比较，不构成买卖建议。反复调整条件可能挑出偶然较好的历史结果；重叠样本、费用缺失及行情回补限制仍然适用。使用的是按源日期保存的估值，未保存历史发布时刻或修订版本，不能据此证明当时可交易。</p>
      </section>
      <template v-if="selected.count">
        <p class="holding-note">{{ study.active ? '符合当前条件的' : '全部' }}持有 {{ years }} 年样本：完整买入日覆盖 {{ selected.firstBuyDate }} — {{ selected.lastBuyDate }} · 中间 50% 样本收益为 {{ riskPercent(selected.p25, true) }} — {{ riskPercent(selected.p75, true) }}{{ selected.count < 30 ? ' · 完整样本较少，覆盖有限' : '' }}。</p>
        <div class="holding-extremes"><article v-for="item in [{ label: '最低收益窗口', point: selected.worst }, { label: '最高收益窗口', point: selected.best }]" :key="item.label"><h3>{{ item.label }}</h3><strong>{{ riskPercent(item.point.returnRate, true) }}</strong><p>{{ item.point.buyDate }} 买入 → {{ item.point.exitDate }} 到期</p><button type="button" :aria-label="`查看${item.label}`" @click="selectedBuy = item.point.buyDate">查看该窗口</button></article></div>
        <HoldingPeriodCharts :series="selected" :code="instrument" :basis="basis" />
        <p class="holding-note">上图横轴为买入日；{{ study.active ? '只展示符合当前条件的完整收益，不符合或条件缺失处留空' : '展示全部完整窗口' }}。缩放仅改变查看范围，不改变条件统计或分布分母。分布将恰好 0% 单列。</p>
      </template>
      <p v-else-if="study.active && study.baseline.count" class="holding-warning" role="status">没有符合当前条件的 {{ years }} 年完整样本。{{ study.unknownCount ? '部分或全部买入环境缺少所选条件数据，不能把缺失当作不符合或零收益。' : '可调整条件或清除条件查看全部样本。' }}</p>
      <p v-else class="holding-warning" role="status">暂无完整、可核验的 {{ years }} 年持有样本。{{ selected.missingCount ? '已到期窗口因行情缺失被排除。' : '现有范围不足以完成该期限，不用短期收益代替。' }}</p>
      <div class="holding-inspector"><label>查看买入日<input v-model="selectedBuy" type="date" :min="stats.startDate" :max="stats.endDate" aria-label="查看持有期买入日" /></label><p class="holding-note">持有 {{ years }} 年 · {{ basisLabel }}</p>
        <p v-if="detail.reason" class="holding-warning" role="status">{{ detail.reason }}</p>
        <template v-if="entryDetail"><p class="holding-note">买入环境参考日 {{ entryDetail.referenceDate || '日历未覆盖' }} · 回撤 {{ conditionValue('drawdown', entryDetail) }} · 60 日波动率 {{ conditionValue('volatility', entryDetail) }} · 指数 PE {{ conditionValue('pe', entryDetail) }} · 指数 PB {{ conditionValue('pb', entryDetail) }}。</p><p v-if="study.active" class="holding-note">环境判断：{{ entryClassification.status === 'complete' ? '符合当前条件' : entryClassification.status === 'excluded' ? '条件齐全，但不符合当前条件；以下收益仅供查询，不计入符合组' : '所选条件缺失，无法归组；以下收益仅供查询' }}。{{ entryClassification.missing.map(key => entryDetail.reasons[key]).join('；') }}</p></template>
        <template v-if="detail.point"><p class="holding-detail-result">{{ detail.point.buyDate }} → {{ detail.point.exitDate }} · 累计收益 {{ riskPercent(detail.point.returnRate, true) }}</p><p class="holding-note">买入收盘 {{ value(detail.point.buyClose) }} · 到期收盘 {{ value(detail.point.exitClose) }} · 目标周年 {{ detail.point.targetDate }} · 实际持有 {{ detail.point.holdingDays }} 个自然日。</p><p v-if="isEtf" class="holding-note">每期初 1 份到期持有 {{ detail.point.shares }} 份；拆分调整价格收益 {{ riskPercent(detail.point.priceReturn, true) }} · 分红贡献 {{ riskPercent(detail.point.cashReturn, true) }}。已发放 {{ cash(detail.point.received) }} · 应收 {{ cash(detail.point.receivable) }}。</p></template>
      </div>
    </template>
    <details class="holding-method holding-note"><summary>持有期与统计口径</summary><p>一年／三年使用自然周年，不按 252／756 个交易日替代。2 月 29 日买入的非闰年周年取 2 月 28 日；周年日休市时顺延，到期收盘按持仓估值，不卖出。没有到期日行情或尚未到期的窗口不会截短到最新日期。</p><p>指数收益 = 到期收盘 ÷ 买入收盘 − 1。ETF 按买入收盘建立期初 1 份，后续拆分调整份额；登记日持有份额获得分红，除息日确认应收，发放日转现金，不再投资。ETF 含分红收益 =（到期份额 × 到期收盘 + 分红现金／应收）÷ 买入收盘 − 1。在买入前登记或到期后除息的分红不计入；不按指数股息率推算 ETF 分红。</p><p>只使用行情、日历及 ETF 分红核验范围的交集。缺少任一窗口内交易日收盘，整个窗口排除。范围外收盘样本、未到期候选和缺失窗口分别计数。没有完整样本时数值显示“—”；完整样本按买入日等权统计，不按资金规模加权。</p><p>分位数按排序位置 (N−1)×p 线性插值；正收益大于 0，负收益小于 0，恰为 0 单列，计算中小于 10⁻¹² 的浮点噪声视为零。使用原始数值统计，显示舍入不改变分类。极值并列取最早买入日。没有交易费用、税费、滑点、现金利息或整手限制；不是年化收益，也不代表成立以来或未来表现。</p></details>
  </section>
</template>

<style scoped>
.holding-analysis { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.holding-heading, .holding-controls, .holding-controls > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; } h2 { font-size: 15px; }
.holding-heading p, .holding-note { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
.holding-controls { margin-top: 12px; justify-content: flex-start; } .holding-controls > div { justify-content: flex-start; }
.holding-controls button[aria-pressed="true"] { border-color: #67d5df; color: #89e3e9; background: #14313c; }
button, select, input { padding: 7px 9px; border: 1px solid #33435b; border-radius: 5px; color: #c7d8f2; background: #111d30; font: inherit; font-size: 11px; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
label { color: #acbcd3; font-size: 11px; min-width: 0; } .holding-controls label { display: flex; align-items: center; gap: 8px; }
input { display: block; box-sizing: border-box; width: 100%; max-width: 240px; color-scheme: dark; margin-top: 6px; min-width: 0; }
.holding-warning, .holding-caution { color: #d5b57f; font-size: 11px; line-height: 1.8; margin-top: 10px; overflow-wrap: anywhere; }
.holding-table-wrap { overflow-x: auto; margin-top: 14px; } table { width: 100%; min-width: 490px; border-collapse: collapse; font-size: 11px; }
caption { text-align: left; color: #b8ceec; padding-bottom: 8px; } th, td { padding: 9px 8px; border-bottom: 1px solid #223049; text-align: right; white-space: nowrap; } th { color: #93a4bf; font-weight: 500; } th:first-child { text-align: left; } td { color: #d8e6f5; font-family: var(--font-mono); } td span { color: #93a4bf; }
.holding-extremes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 14px 0; } .holding-extremes article, .holding-inspector { border: 1px solid #223049; border-radius: 8px; background: #0a1220; padding: 14px; min-width: 0; }
.holding-extremes h3 { color: #acbcd3; font-size: 12px; font-weight: 400; } .holding-extremes strong { display: block; color: #aad5ec; font: 600 24px var(--font-mono); margin-top: 8px; } .holding-extremes p { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 6px; } .holding-extremes button { margin-top: 8px; }
.holding-inspector { margin-top: 14px; } .holding-detail-result { color: #c7d8f2; font-size: 13px; line-height: 1.8; margin-top: 10px; overflow-wrap: anywhere; }
.holding-method { margin-top: 14px; border-top: 1px solid #223049; padding-top: 12px; } summary { cursor: pointer; color: #b9c9df; font-size: 12px; }
.holding-research { border-top: 1px solid #223049; margin-top: 20px; padding-top: 16px; min-width: 0; }.holding-research h3 { color: #d4e2f5; font-size: 14px; }.holding-filter-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }.holding-filter-form fieldset { min-width: 0; border: 1px solid #33435b; border-radius: 6px; padding: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.holding-filter-form legend { color: #b8ceec; font-size: 11px; padding: 0 4px; }.holding-filter-form input { max-width: none; }.holding-filter-actions, .holding-filter-form > p { grid-column: 1 / -1; }.holding-filter-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }.holding-condition-label { margin-top: 14px; color: #89dce4; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
@media (max-width: 1100px) { .holding-filter-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .holding-analysis { padding: 15px 12px; } .holding-extremes { grid-template-columns: minmax(0, 1fr); } .holding-controls label { flex-wrap: wrap; } .holding-controls select { max-width: 100%; min-width: 0; } }
@media (max-width: 480px) { .holding-filter-form { grid-template-columns: minmax(0, 1fr); } }
</style>
