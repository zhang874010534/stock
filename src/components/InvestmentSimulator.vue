<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateFeeSensitivity, calculateInvestmentSimulation, simulatorDefaults } from '../utils/investmentSimulator.js'
import { createInvestmentPlans, MAX_INVESTMENT_PLANS } from '../composables/useInvestmentPlans.js'
import { downloadBlob } from '../utils/chartExport.js'
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
const plansStore = createInvestmentPlans(), planName = ref(''), planId = ref(''), planMessage = ref('')
const plans = computed(() => plansStore.plans.value.filter(plan => plan.instrument === props.instrument))
const draft = reactive({ start: '', end: '', budget: 50000, weekday: 1, monthDay: 5, batchCount: 6, batchInterval: 30, feePercent: 0, minFee: 0, quantityMode: 'lots', basis: 'cash', fundingMode: 'upfront', monthlyAmount: 1000, contributionDay: 5, comparisonFeePercent: .03, comparisonMinFee: 5 })
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
  planId.value = ''; planName.value = ''; planMessage.value = ''
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
const sensitivity = computed(() => stats.value ? calculateFeeSensitivity(snapshot.value.market, stats.value.config, { distribution: snapshot.value.distribution }, stats.value) : [])
const basisLabel = basis => ({ cash: '含现金分红、不再投资', price: '价格收益、不含现金分红', reinvest: '已付分红再投资' }[basis])
const savedTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
const flowLabels = { initial: '初始资金', contribution: '每月入金', buy: '计划买入', reinvest: '分红再投资', dividend: '分红到账', entitlement: '应收分红', split: '份额调整', skipped: '未成交', pending: '区间内未到账' }
const notice = computed(() => collectionNotice(dashboard.states.collection.data?.sources[props.instrument], { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(snapshot.value) }))
const minDate = computed(() => [snapshot.value?.market.history[0].date ?? tradingCalendar.start, tradingCalendar.start].sort().at(-1))
const maxDate = computed(() => [snapshot.value?.market.latest.date ?? tradingCalendar.end, tradingCalendar.end].sort()[0])
const money = value => Number.isFinite(value) ? `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元` : '—'
const quantity = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
function run() {
  try {
    const numeric = ['budget', 'weekday', 'monthDay', 'batchCount', 'batchInterval', 'feePercent', 'minFee', 'monthlyAmount', 'contributionDay', 'comparisonFeePercent', 'comparisonMinFee']
    if (numeric.some(key => String(draft[key]).trim() === '')) throw new Error('请填写完整的金额、日期和费用参数')
    config.value = { ...draft, ...Object.fromEntries(numeric.map(key => [key, Number(draft[key])])) }; formError.value = ''
  } catch (error) { formError.value = error.message }
}
function savePlan() {
  try {
    if (!stats.value || parametersChanged.value) throw new Error('请先完成模拟，再保存已应用的方案参数')
    const plan = plansStore.save({ name: planName.value, instrument: props.instrument, strategy: selected.value, config: stats.value.config })
    planId.value = plan.id; planMessage.value = '已保存参数与明细策略，加载后按当前已保存数据重算。'
  } catch (error) { planMessage.value = error.message }
}
function loadPlan() {
  const plan = plans.value.find(item => item.id === planId.value)
  if (!plan) { planMessage.value = '请先选择一套已保存方案'; return }
  Object.assign(draft, plan.config); config.value = { ...plan.config }; selected.value = plan.strategy; planName.value = plan.name; formError.value = ''
  planMessage.value = '方案已加载，按当前数据重算；日期不在已核验范围时需调整后再次模拟。'
}
function removePlan() { if (planId.value) { plansStore.remove(planId.value); planId.value = ''; planMessage.value = '已删除保存方案，页面参数仍保留。' } }
function undoPlan() { try { plansStore.undoRemove(); planMessage.value = '已恢复保存方案。' } catch (error) { planMessage.value = error.message } }
function exportFlows() {
  try {
    if (!selectedSeries.value) return
    const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`
    const columns = ['日期', '类型', '计划日期', '未到账计划金额（元）', '现金变动（元）', '买入金额（元）', '费用（元）', '份额', '现金余额（元）', '应收分红（元）', '持有份额', '说明']
    const rows = selectedSeries.value.cashFlows.map(item => [item.date, flowLabels[item.type], item.plannedDate ?? '', item.plannedAmount ?? 0, item.amount, item.value ?? 0, item.fee ?? 0, item.quantity ?? 0, item.cash, item.receivable, item.shares, item.detail])
    downloadBlob(new Blob(['\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${props.instrument}_${selected.value}_${stats.value.startDate}_${stats.value.endDate}_现金流.csv`)
    planMessage.value = '现金流 CSV 已生成，已请求浏览器下载。'
  } catch (error) { planMessage.value = `现金流导出未完成：${error.message}` }
}
function refresh() { return dashboard.refresh([props.instrument, 'collection', ...(isEtf.value ? ['etfDistributions'] : [])]) }
defineExpose({ loading })
</script>

<template>
  <section class="investment-simulator panel" aria-label="定投模拟器" :aria-busy="loading">
    <header class="simulator-heading"><div><h2>定投模拟器</h2><p>{{ instrument }} · 相同资金来源，比较四种投入节奏</p></div><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取模拟数据' }}</button></header>
    <p class="simulator-note">初始预算按原节奏分配；可追加每月到账资金，四种策略使用相同入金日期与金额。新增资金不提前买入，一次性策略在到账日追加买入，其余策略留到下一个计划日；分批计划结束后到账的资金保留为现金。现金不计利息。</p>
    <div class="saved-plans" aria-label="保存定投方案"><label>方案名称<input v-model="planName" maxlength="60" aria-label="定投方案名称" placeholder="例如：每月追加与分红再投" /></label><label>已保存方案（{{ plans.length }}，两只证券合计最多 {{ MAX_INVESTMENT_PLANS }} 套）<select v-model="planId" aria-label="已保存定投方案"><option value="">选择当前证券的方案</option><option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }} · {{ plan.config.start }} — {{ plan.config.end }} · 月增 {{ plan.config.fundingMode === 'monthly' ? plan.config.monthlyAmount : 0 }} 元 · 保存 {{ savedTime(plan.savedAt) }}</option></select></label><div class="plan-actions"><button type="button" :disabled="!stats || parametersChanged || plansStore.plans.value.length >= MAX_INVESTMENT_PLANS" @click="savePlan">另存为新方案</button><button type="button" :disabled="!planId" @click="loadPlan">加载方案</button><button type="button" :disabled="!planId" @click="removePlan">删除方案</button><button v-if="plansStore.removed.value?.instrument === instrument" type="button" @click="undoPlan">撤销删除方案</button></div></div>
    <p v-if="planMessage" class="simulator-note" role="status">{{ planMessage }}</p><p v-if="plansStore.message.value" :class="plansStore.hasWarning.value ? 'simulator-warning' : 'simulator-note'" role="status">{{ plansStore.message.value }}</p>
    <p class="simulator-note">方案仅保存名称、参数与明细策略，不保存历史结果；加载时使用当前已保存数据重新计算。方案保存在当前浏览器、当前站点，不跨设备同步，同名另存也保留旧方案。</p>
    <p v-if="!isEtf" class="simulator-warning">H30269 是价格指数，不能直接买入。这里按 1 点对应 1 元折算理论份额，不含指数成分股分红，不代表 ETF 实际收益。</p>
    <p v-if="readError" class="simulator-warning" role="status">文件读取失败：{{ readError }}。{{ snapshot ? '保留上次整组行情及分红输入和原日期。' : '暂无完整模拟输入。' }}</p>
    <p v-else-if="loading" class="simulator-note" role="status">{{ snapshot ? '正在读取，暂显示原模拟输入。' : '正在读取模拟数据…' }}</p>
    <p v-if="snapshot" class="simulator-note">行情截止 {{ snapshot.market.latest.date }} · {{ notice.text }}{{ snapshot.market.backfill.completed ? '' : ' · 历史仍在补充' }}。可选核验范围 {{ minDate }} — {{ maxDate }}。</p>
    <p v-if="isEtf && snapshot?.distribution?.coverage" class="simulator-note">分红／拆分核验截至 {{ snapshot.distribution.coverage.end }}{{ snapshot.distribution.status === 'stale' ? ` · 保留记录：${snapshot.distribution.reason}` : '' }}。整手模拟按 100 份执行；不足部分留在本策略现金中，后续计划日可合并使用。</p>
    <form class="simulator-form" aria-label="定投模拟参数" @submit.prevent="run">
      <label>开始日期<input v-model="draft.start" type="date" :min="minDate" :max="maxDate" required /></label>
      <label>结束日期<input v-model="draft.end" type="date" :min="minDate" :max="maxDate" required /></label>
      <label>总预算（元）<input v-model="draft.budget" type="number" :min="draft.fundingMode === 'monthly' ? 0 : 1" max="1000000000" step="0.01" required /><span class="field-note">开始时可用的初始资金</span></label>
      <label>资金来源<select v-model="draft.fundingMode" aria-label="定投资金来源"><option value="upfront">初始预算已备齐</option><option value="monthly">初始预算 + 每月新增资金</option></select></label>
      <label v-if="draft.fundingMode === 'monthly'">每月新增资金（元）<input v-model="draft.monthlyAmount" type="number" min="1" max="1000000000" step="0.01" required /></label>
      <label v-if="draft.fundingMode === 'monthly'">每月资金到账日<select v-model="draft.contributionDay"><option v-for="day in 28" :key="day" :value="day">每月 {{ day }} 日</option></select></label>
      <label>每周投入日<select v-model="draft.weekday"><option v-for="(label, i) in ['周一', '周二', '周三', '周四', '周五']" :key="i" :value="i + 1">{{ label }}</option></select></label>
      <label>每月投入日<select v-model="draft.monthDay"><option v-for="day in 28" :key="day" :value="day">每月 {{ day }} 日</option></select></label>
      <label>分批次数<input v-model="draft.batchCount" type="number" min="1" max="60" step="1" required /></label>
      <label>分批间隔（自然日）<input v-model="draft.batchInterval" type="number" min="1" max="365" step="1" required /></label>
      <label>每笔买入费率（%）<input v-model="draft.feePercent" type="number" min="0" max="5" step="any" required /></label>
      <label>每笔最低费用（元）<input v-model="draft.minFee" type="number" min="0" max="10000" step="0.01" required /></label>
      <label>对照买入费率（%）<input v-model="draft.comparisonFeePercent" type="number" min="0" max="5" step="any" required /></label>
      <label>对照最低费用（元）<input v-model="draft.comparisonMinFee" type="number" min="0" max="10000" step="0.01" required /></label>
      <label v-if="isEtf">份额模式<select v-model="draft.quantityMode"><option value="lots">100 份整手模拟</option><option value="fractional">理想小数份额</option></select></label>
      <label v-if="isEtf">收益口径<select v-model="draft.basis"><option value="cash">含现金分红，不再投资</option><option value="reinvest">已付分红再投资</option><option value="price">价格收益，仅调整拆分</option></select></label>
      <div class="simulator-run"><button type="submit" :disabled="!snapshot || loading">开始模拟</button><span>修改后点击重新计算</span></div>
    </form>
    <p v-if="formError || result.error" class="simulator-warning" role="alert">暂不能模拟：{{ formError || result.error }}</p>
    <p v-if="parametersChanged && stats" class="simulator-warning" role="status">参数已修改，以下仍为上次模拟结果；点击“开始模拟”应用新参数。</p>
    <template v-if="stats">
      <p class="simulator-note">实际区间 {{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个收盘样本 · 初始预算 {{ money(stats.config.budget) }}{{ stats.config.fundingMode === 'monthly' ? ` · 每月新增 ${money(stats.config.monthlyAmount)}` : '' }} · {{ basisLabel(stats.config.basis) }}。开始日顺延、结束日回退至交易日，到账日遇休市也顺延，超出区间的到账不计入投入；所有买入使用当日收盘价。</p>
      <p v-if="isEtf && stats.config.basis === 'reinvest' && stats.series.every(series => series.current.income === 0)" class="simulator-note">所选区间未确认现金分红，各策略没有分红现金可再投；再投金额为零。</p>
      <div class="simulator-table-wrap"><table><caption>相同资金来源的历史结果</caption><thead><tr><th scope="col">指标</th><th v-for="series in stats.series" :key="series.key" scope="col">{{ series.name }}</th></tr></thead><tbody>
        <tr v-for="metric in [{ key: 'contributed', label: '累计外部投入' }, { key: 'assets', label: '期末总资产' }, { key: 'spent', label: '累计买入金额' }, { key: 'marketValue', label: '持仓市值' }, { key: 'cash', label: '剩余现金（含未再投分红）' }, { key: 'receivable', label: '应收分红' }, { key: 'income', label: '累计确认分红' }, { key: 'reinvested', label: '分红再投金额（不含费用）' }, { key: 'reinvestFees', label: '分红再投费用（已含在累计费用中）' }, { key: 'fees', label: '累计买入费用' }]" :key="metric.key"><th scope="row">{{ metric.label }}</th><td v-for="series in stats.series" :key="series.key">{{ money(series.current[metric.key]) }}</td></tr>
        <tr><th scope="row">盈亏</th><td v-for="series in stats.series" :key="series.key">{{ money(series.profit) }}</td></tr>
        <tr><th scope="row">累计投入收益率</th><td v-for="series in stats.series" :key="series.key">{{ riskPercent(series.returnRate, true) }}</td></tr>
        <tr><th scope="row">XIRR（年化资金加权）</th><td v-for="series in stats.series" :key="series.key" :title="series.xirr.reason">{{ riskPercent(series.xirr.value, true) }}<small v-if="series.xirr.value === null">{{ series.xirr.reason }}</small></td></tr>
        <tr><th scope="row">资金流调整后最大回撤</th><td v-for="series in stats.series" :key="series.key">{{ riskPercent(series.maxDrawdown) }}</td></tr>
        <tr><th scope="row">成交／计划笔数</th><td v-for="series in stats.series" :key="series.key">{{ series.executedCount }} / {{ series.plannedCount }}</td></tr>
        <tr><th scope="row">持有份额{{ isEtf ? '' : '（理论）' }}</th><td v-for="series in stats.series" :key="series.key">{{ quantity(series.current.shares) }}</td></tr>
        <tr><th scope="row">每份成本（含买入费）</th><td v-for="series in stats.series" :key="series.key">{{ money(series.averageCost) }}</td></tr>
      </tbody></table></div>
      <InvestmentSimulationTrend :stats="stats" />
      <p class="simulator-note">资产曲线包含现金与外部入金，虚线为累计投入；追加资金不是盈利。累计投入收益率 = 盈亏 ÷ 累计外部投入，不是年化收益。XIRR 仅用实际外部入金和期末总资产计算；未卖出，终值仅作估值。最大回撤按入金前后调整的收益路径计算，到账资金按当日收益发生前处理。</p>
      <label class="ledger-select">明细策略<select v-model="selected"><option v-for="series in stats.series" :key="series.key" :value="series.key">{{ series.name }}</option></select></label>
      <details class="simulator-details"><summary>费用敏感性比较</summary><p class="simulator-note">{{ selectedSeries.name }} · 同一资金、日期、分红口径和份额模式分别重跑，仅调整每笔买入费率及最低费用（含分红再投），展示费用对成交份额及总资产的实际影响。对照费用由上方参数指定，默认是假设值。</p><div class="simulator-table-wrap"><table><caption>费用敏感性 · {{ selectedSeries.name }}</caption><thead><tr><th>指标</th><th v-for="scenario in sensitivity" :key="scenario.key">{{ scenario.name }}</th></tr></thead><tbody><tr><th>费率 / 最低费用</th><td v-for="scenario in sensitivity" :key="scenario.key">{{ scenario.feePercent }}% / {{ money(scenario.minFee) }}</td></tr><tr v-for="metric in [{key:'fees',label:'累计买入费用'},{key:'assets',label:'期末总资产'},{key:'shares',label:'持有份额'}]" :key="metric.key"><th>{{ metric.label }}</th><td v-for="scenario in sensitivity" :key="scenario.key">{{ metric.key === 'shares' ? quantity(scenario.series.find(item => item.key === selected).current.shares) : money(scenario.series.find(item => item.key === selected).current[metric.key]) }}</td></tr><tr><th>与当前方案期末资产差值</th><td v-for="scenario in sensitivity" :key="scenario.key">{{ money(scenario.series.find(item => item.key === selected).current.assets - selectedSeries.current.assets) }}</td></tr></tbody></table></div></details>
      <details class="simulator-details"><summary>查看现金流明细</summary><p class="simulator-note">外部入金与分红到账为正，买入及费用支出为负；应收确认、份额调整和未成交不产生现金。分红是内部收益，不计外部投入。余额按各事件执行后的状态列出。</p><button type="button" @click="exportFlows">导出现金流 CSV</button><div class="simulator-table-wrap ledger"><table><caption>{{ selectedSeries.name }} · 现金流明细</caption><thead><tr><th>日期</th><th>类型</th><th>现金变动</th><th>买入金额</th><th>费用</th><th>买入份额</th><th>现金余额</th><th>应收分红</th><th>说明</th></tr></thead><tbody><tr v-for="(flow, i) in selectedSeries.cashFlows" :key="i"><td>{{ flow.date }}</td><td>{{ flowLabels[flow.type] }}</td><td>{{ money(flow.amount) }}</td><td>{{ money(flow.value ?? 0) }}</td><td>{{ money(flow.fee ?? 0) }}</td><td>{{ quantity(flow.quantity ?? 0) }}</td><td>{{ money(flow.cash) }}</td><td>{{ money(flow.receivable) }}</td><td>{{ flow.detail }}{{ flow.plannedAmount ? ` · 计划 ${money(flow.plannedAmount)}` : '' }}</td></tr></tbody></table></div></details>
      <details class="simulator-details"><summary>查看投入明细与未执行计划</summary>
        <p class="simulator-note">{{ selectedSeries.executedCount }} 笔成交 · {{ selectedSeries.skippedCount }} 笔余额不足 · {{ selectedSeries.outsideCount }} 笔在区间结束前无法执行。没有计划日时全部预算保留为现金。</p>
        <div class="simulator-table-wrap ledger"><table><thead><tr><th>计划日</th><th>执行日</th><th>计划分配</th><th>收盘价</th><th>买入份额</th><th>买入金额</th><th>费用</th><th>状态</th></tr></thead><tbody><tr v-for="(order, i) in selectedSeries.orders" :key="i"><td>{{ order.plannedDate }}</td><td>{{ order.date ?? '—' }}</td><td>{{ money(order.allocation) }}</td><td>{{ order.close ?? '—' }}</td><td>{{ quantity(order.quantity) }}</td><td>{{ money(order.value) }}</td><td>{{ money(order.fee) }}</td><td>{{ { bought: '成交', insufficient: '余额不足，留现金', outside: '区间内未执行' }[order.status] }}</td></tr></tbody></table></div>
      </details>
    </template>
    <details class="simulator-details simulator-note"><summary>模拟假设与计算口径</summary><p>一次性买入在实际首日执行，按月新增时也在到账日买入；每周／每月计划按所选自然日期生成，遇非交易日顺延至区间内下一个交易日。顺延后同一天有多个计划时逐笔执行。区间末尾没有下一交易日的计划仍占初始预算，保留现金。分批首笔从所选开始日顺延，后续按自然日间隔；超出结束日的批次不提前买入。</p><p>每笔使用已释放初始预算、已到账新增资金与此前余款，买入金额加费用不得超过这部分余额。新增资金每月按指定 1–28 日到账，区间开始前的当月到账日不补发；到账和投入同日时先到账。买入费用为成交金额 × 费率与最低费用的较大值；未成交不收费。默认费用为零，可按自己的假设修改。小数份额仅供理想化比较；费用计算不做逐笔分币舍入。</p><p>ETF 按登记日收盘持有份额计算分红，除息日确认应收，发放日转现金。再投资模式仅用已付分红现金，在发放日或之后第一个可交易收盘买入；应收分红不能提前使用。不足一手或费用时保留分红现金，后续交易日继续尝试；分红再投资逐笔计费，不与初始预算混用。登记日包括当日计划买入和再投买入，除息日买入不获得此前权益。拆分调整份额，不产生现金；同时发生分红与拆分且口径不明时停止模拟。价格收益模式也需核验拆分档案。</p><p>总资产 = 持仓市值 + 剩余现金 + 应收分红。累计投入不包含分红和再投，收益不会重复计入分红；区间末尾按收盘估值，不卖出，因此不扣卖出费用。现金不计利息，不含额外税费、滑点或市场冲击，不重复扣除基金已体现在价格内的费用。缺少交易日或分红核验范围不足时不生成结果；结果仅描述已同步历史，不预示未来。</p></details>
  </section>
</template>

<style scoped>
.investment-simulator { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.simulator-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; } h2 { font-size: 15px; }
.simulator-heading p, .simulator-note, .simulator-run span { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
.simulator-warning { color: #d5b57f; font-size: 11px; line-height: 1.8; margin-top: 8px; }
.saved-plans { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 12px; margin-top: 14px; padding: 14px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; } .plan-actions { display: flex; flex-wrap: wrap; gap: 8px; grid-column: 1 / -1; } .field-note { display: block; font-size: 10px; color: #93a4bf; margin-top: 5px; } td small { display: block; max-width: 180px; white-space: normal; line-height: 1.6; }
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
@media (max-width: 640px) { .investment-simulator { padding: 15px 12px; } .simulator-form, .saved-plans { grid-template-columns: minmax(0, 1fr); padding: 12px; } }
</style>
