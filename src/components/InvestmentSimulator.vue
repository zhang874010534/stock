<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateInvestmentSimulation, simulatorDefaults } from '../utils/investmentSimulator.js'
import { collectionNotice } from '../utils/sourceStatus.js'
import { riskPercent } from '../utils/priceRisk.js'
import { tradingCalendar } from '../data/tradingCalendar.js'

const InvestmentSimulationTrend = defineAsyncComponent(() => import('./InvestmentSimulationTrend.vue'))
const props = defineProps({ instrument: { type: String, default: '512890' } })
const dashboard = useDashboardData(), distributions = dashboard.states.etfDistributions
const isEtf = computed(() => props.instrument === '512890')
const market = computed(() => dashboard.states[props.instrument])
const snapshots = reactive({ H30269: null, '512890': null })
const snapshot = computed(() => snapshots[props.instrument])
const loading = computed(() => market.value.loading || (isEtf.value && distributions.loading))
const readError = computed(() => [market.value.error, isEtf.value ? distributions.error : ''].filter(Boolean).join('；'))
const config = ref(null), selected = ref('weekly'), formError = ref('')
const draft = reactive({ start: '', end: '', budget: 50000, weekday: 1, monthDay: 5, batchCount: 6, batchInterval: 30, feePercent: 0, minFee: 0, quantityMode: 'lots', basis: 'cash' })
watch(() => [props.instrument, market.value.data, market.value.loading, market.value.error, distributions.data, distributions.loading, distributions.error], () => {
  if (!loading.value && market.value.data && (!isEtf.value || distributions.data) && (!snapshot.value || !readError.value)) {
    snapshots[props.instrument] = { market: market.value.data, distribution: isEtf.value ? distributions.data : null }
    if (!config.value) {
      Object.assign(draft, simulatorDefaults(market.value.data)); config.value = { ...draft }
    }
  }
}, { immediate: true })
watch(() => props.instrument, () => {
  config.value = null; formError.value = ''; selected.value = 'weekly'
  if (snapshot.value) { Object.assign(draft, simulatorDefaults(snapshot.value.market)); config.value = { ...draft } }
  ensure()
}, { flush: 'sync' })
function ensure() { dashboard.ensure(props.instrument); if (isEtf.value) dashboard.ensure('etfDistributions') }
ensure(); dashboard.ensure('collection')
const result = computed(() => {
  if (!snapshot.value || !config.value) return { stats: null, error: '' }
  try { return { stats: calculateInvestmentSimulation(snapshot.value.market, config.value, { distribution: snapshot.value.distribution }), error: '' } }
  catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const parametersChanged = computed(() => config.value && Object.keys(draft).some(key => String(draft[key]) !== String(config.value[key])))
const selectedSeries = computed(() => stats.value?.series.find(item => item.key === selected.value))
const notice = computed(() => collectionNotice(dashboard.states.collection.data?.sources[props.instrument], { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(snapshot.value) }))
const minDate = computed(() => [snapshot.value?.market.history[0].date ?? tradingCalendar.start, tradingCalendar.start].sort().at(-1))
const maxDate = computed(() => [snapshot.value?.market.latest.date ?? tradingCalendar.end, tradingCalendar.end].sort()[0])
const money = value => Number.isFinite(value) ? `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元` : '—'
const quantity = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
function run() {
  try {
    const numeric = ['budget', 'weekday', 'monthDay', 'batchCount', 'batchInterval', 'feePercent', 'minFee']
    if (numeric.some(key => String(draft[key]).trim() === '')) throw new Error('请填写完整的金额、日期和费用参数')
    config.value = { ...draft, ...Object.fromEntries(numeric.map(key => [key, Number(draft[key])])) }; formError.value = ''
  } catch (error) { formError.value = error.message }
}
function refresh() { return dashboard.refresh([props.instrument, 'collection', ...(isEtf.value ? ['etfDistributions'] : [])]) }
defineExpose({ loading })
</script>

<template>
  <section class="investment-simulator panel" aria-label="定投模拟器" :aria-busy="loading">
    <header class="simulator-heading"><div><h2>定投模拟器</h2><p>{{ instrument }} · 相同预算，比较四种投入节奏</p></div><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取模拟数据' }}</button></header>
    <p class="simulator-note">总预算从开始时已备齐，每周／每月定投均分到区间内的计划日，分批投入按指定批数均分。未投入资金保留为现金且不计利息；这模拟的是已有预算逐步建仓。</p>
    <p v-if="!isEtf" class="simulator-warning">H30269 是价格指数，不能直接买入。这里按 1 点对应 1 元折算理论份额，不含指数成分股分红，不代表 ETF 实际收益。</p>
    <p v-if="readError" class="simulator-warning" role="status">文件读取失败：{{ readError }}。{{ snapshot ? '保留上次整组行情及分红输入和原日期。' : '暂无完整模拟输入。' }}</p>
    <p v-else-if="loading" class="simulator-note" role="status">{{ snapshot ? '正在读取，暂显示原模拟输入。' : '正在读取模拟数据…' }}</p>
    <p v-if="snapshot" class="simulator-note">行情截止 {{ snapshot.market.latest.date }} · {{ notice.text }}{{ snapshot.market.backfill.completed ? '' : ' · 历史仍在补充' }}。可选核验范围 {{ minDate }} — {{ maxDate }}。</p>
    <p v-if="isEtf && snapshot?.distribution?.coverage" class="simulator-note">分红／拆分核验截至 {{ snapshot.distribution.coverage.end }}{{ snapshot.distribution.status === 'stale' ? ` · 保留记录：${snapshot.distribution.reason}` : '' }}。整手模拟按 100 份执行；不足部分留在本策略现金中，后续计划日可合并使用。</p>
    <form class="simulator-form" aria-label="定投模拟参数" @submit.prevent="run">
      <label>开始日期<input v-model="draft.start" type="date" :min="minDate" :max="maxDate" required /></label>
      <label>结束日期<input v-model="draft.end" type="date" :min="minDate" :max="maxDate" required /></label>
      <label>总预算（元）<input v-model="draft.budget" type="number" min="1" max="1000000000" step="0.01" required /></label>
      <label>每周投入日<select v-model="draft.weekday"><option v-for="(label, i) in ['周一', '周二', '周三', '周四', '周五']" :key="i" :value="i + 1">{{ label }}</option></select></label>
      <label>每月投入日<select v-model="draft.monthDay"><option v-for="day in 28" :key="day" :value="day">每月 {{ day }} 日</option></select></label>
      <label>分批次数<input v-model="draft.batchCount" type="number" min="1" max="60" step="1" required /></label>
      <label>分批间隔（自然日）<input v-model="draft.batchInterval" type="number" min="1" max="365" step="1" required /></label>
      <label>每笔买入费率（%）<input v-model="draft.feePercent" type="number" min="0" max="5" step="any" required /></label>
      <label>每笔最低费用（元）<input v-model="draft.minFee" type="number" min="0" max="10000" step="0.01" required /></label>
      <label v-if="isEtf">份额模式<select v-model="draft.quantityMode"><option value="lots">100 份整手模拟</option><option value="fractional">理想小数份额</option></select></label>
      <label v-if="isEtf">收益口径<select v-model="draft.basis"><option value="cash">含现金分红，不再投资</option><option value="price">价格收益，仅调整拆分</option></select></label>
      <div class="simulator-run"><button type="submit" :disabled="!snapshot || loading">开始模拟</button><span>修改后点击重新计算</span></div>
    </form>
    <p v-if="formError || result.error" class="simulator-warning" role="alert">暂不能模拟：{{ formError || result.error }}</p>
    <p v-if="parametersChanged && stats" class="simulator-warning" role="status">参数已修改，以下仍为上次模拟结果；点击“开始模拟”应用新参数。</p>
    <template v-if="stats">
      <p class="simulator-note">实际区间 {{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个收盘样本 · 预算 {{ money(stats.config.budget) }} · {{ stats.config.basis === 'cash' ? '含现金分红、不再投资' : '价格收益、不含现金分红' }}。开始日顺延、结束日回退至交易日，所有买入使用当日收盘价。</p>
      <div class="simulator-table-wrap"><table><caption>相同初始预算的历史结果</caption><thead><tr><th scope="col">指标</th><th v-for="series in stats.series" :key="series.key" scope="col">{{ series.name }}</th></tr></thead><tbody>
        <tr v-for="metric in [{ key: 'assets', label: '期末总资产' }, { key: 'spent', label: '累计买入金额' }, { key: 'marketValue', label: '持仓市值' }, { key: 'cash', label: '剩余现金（含已付分红）' }, { key: 'receivable', label: '应收分红' }, { key: 'fees', label: '累计买入费用' }]" :key="metric.key"><th scope="row">{{ metric.label }}</th><td v-for="series in stats.series" :key="series.key">{{ money(series.current[metric.key]) }}</td></tr>
        <tr><th scope="row">盈亏</th><td v-for="series in stats.series" :key="series.key">{{ money(series.profit) }}</td></tr>
        <tr><th scope="row">总预算收益率</th><td v-for="series in stats.series" :key="series.key">{{ riskPercent(series.returnRate, true) }}</td></tr>
        <tr><th scope="row">总资产最大回撤</th><td v-for="series in stats.series" :key="series.key">{{ riskPercent(series.maxDrawdown) }}</td></tr>
        <tr><th scope="row">成交／计划笔数</th><td v-for="series in stats.series" :key="series.key">{{ series.executedCount }} / {{ series.plannedCount }}</td></tr>
        <tr><th scope="row">持有份额{{ isEtf ? '' : '（理论）' }}</th><td v-for="series in stats.series" :key="series.key">{{ quantity(series.current.shares) }}</td></tr>
        <tr><th scope="row">每份成本（含买入费）</th><td v-for="series in stats.series" :key="series.key">{{ money(series.averageCost) }}</td></tr>
      </tbody></table></div>
      <InvestmentSimulationTrend :stats="stats" />
      <p class="simulator-note">曲线和回撤包含尚未投入的现金，不能等同于证券自身回撤。收益率 =（期末总资产 − 初始预算）÷ 初始预算，不是年化收益或资金加权收益。</p>
      <details class="simulator-details"><summary>查看投入明细与未执行计划</summary><label class="ledger-select">明细策略<select v-model="selected"><option v-for="series in stats.series" :key="series.key" :value="series.key">{{ series.name }}</option></select></label>
        <p class="simulator-note">{{ selectedSeries.executedCount }} 笔成交 · {{ selectedSeries.skippedCount }} 笔余额不足 · {{ selectedSeries.outsideCount }} 笔在区间结束前无法执行。没有计划日时全部预算保留为现金。</p>
        <div class="simulator-table-wrap ledger"><table><thead><tr><th>计划日</th><th>执行日</th><th>计划分配</th><th>收盘价</th><th>买入份额</th><th>买入金额</th><th>费用</th><th>状态</th></tr></thead><tbody><tr v-for="(order, i) in selectedSeries.orders" :key="i"><td>{{ order.plannedDate }}</td><td>{{ order.date ?? '—' }}</td><td>{{ money(order.allocation) }}</td><td>{{ order.close ?? '—' }}</td><td>{{ quantity(order.quantity) }}</td><td>{{ money(order.value) }}</td><td>{{ money(order.fee) }}</td><td>{{ { bought: '成交', insufficient: '余额不足，留现金', outside: '区间内未执行' }[order.status] }}</td></tr></tbody></table></div>
      </details>
    </template>
    <details class="simulator-details simulator-note"><summary>模拟假设与计算口径</summary><p>一次性买入在实际首日执行；每周／每月计划按所选自然日期生成，遇非交易日顺延至区间内下一个交易日。顺延后同一天有多个计划时逐笔执行。区间末尾没有下一交易日的计划仍占预算，保留现金。分批首笔从所选开始日顺延，后续按自然日间隔；超出结束日的批次不提前买入。</p><p>每笔使用已释放预算与此前余款，买入金额加费用不得超过这部分余额。买入费用为成交金额 × 费率与最低费用的较大值；未成交不收费。默认费用为零，可按自己的假设修改。小数份额仅供理想化比较；费用计算不做逐笔分币舍入。</p><p>ETF 按登记日收盘持有份额计算分红，除息日确认应收，发放日转现金；分红不用于后续买入。拆分调整份额，不产生收益；同时发生分红与拆分且口径不明时停止模拟。价格收益模式也需核验拆分档案。</p><p>总资产 = 持仓市值 + 剩余预算现金 + 已发放分红 + 应收分红。区间末尾按收盘估值，不卖出，因此不扣卖出费用。现金不计利息，不含额外税费、滑点或市场冲击，不重复扣除基金已体现在价格内的费用。缺少交易日或分红核验范围不足时不生成结果；结果仅描述已同步历史，不预示未来。</p></details>
  </section>
</template>

<style scoped>
.investment-simulator { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.simulator-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; } h2 { font-size: 15px; }
.simulator-heading p, .simulator-note, .simulator-run span { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
.simulator-warning { color: #d5b57f; font-size: 11px; line-height: 1.8; margin-top: 8px; }
button, select, input { padding: 7px 9px; border: 1px solid #33435b; border-radius: 5px; background: #111d30; color: #c7d8f2; font: inherit; font-size: 11px; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.simulator-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px; background: #0a1220; border: 1px solid #223049; border-radius: 8px; padding: 14px; }
label { color: #acbcd3; font-size: 11px; min-width: 0; } select, input { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin-top: 6px; color-scheme: dark; }
.simulator-run { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
.simulator-table-wrap { overflow-x: auto; margin-top: 14px; } table { width: 100%; min-width: 700px; border-collapse: collapse; font-size: 11px; }
caption { color: #b8ceec; text-align: left; padding-bottom: 8px; } th, td { padding: 9px 8px; border-bottom: 1px solid #223049; white-space: nowrap; text-align: right; }
th { color: #93a4bf; font-weight: 500; } th:first-child, .ledger td:first-child { text-align: left; } td { color: #d8e6f5; font-family: var(--font-mono); }
.simulator-details { margin-top: 14px; border-top: 1px solid #223049; padding-top: 12px; } summary { cursor: pointer; color: #b9c9df; font-size: 12px; }
.simulator-details p { margin-top: 8px; } .ledger-select { display: block; margin-top: 12px; max-width: 240px; } .ledger { max-height: 360px; }
@media (max-width: 1100px) { .simulator-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .investment-simulator { padding: 15px 12px; } .simulator-form { grid-template-columns: minmax(0, 1fr); padding: 12px; } }
</style>
