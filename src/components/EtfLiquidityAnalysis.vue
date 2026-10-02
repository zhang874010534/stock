<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateEtfLiquidity, estimateEtfCost, LIQUIDITY_RANGES } from '../utils/etfLiquidity.js'
import { collectionNotice, dataFreshness } from '../utils/sourceStatus.js'
import { downloadBlob } from '../utils/chartExport.js'
const EtfLiquidityTrend = defineAsyncComponent(() => import('./EtfLiquidityTrend.vue'))
const dashboard = useDashboardData(), market = dashboard.states['512890'], size = dashboard.states.etfSize, fees = dashboard.states.etfFees
for (const key of ['512890', 'etfSize', 'etfFees', 'collection']) dashboard.ensure(key)
const range = ref('year'), start = ref(''), end = ref(''), custom = ref(null), message = ref('')
const loading = computed(() => [market, size, fees].some(state => state.loading))
const result = computed(() => {
  if (!market.data) return { stats: null, error: '暂无 ETF 行情，成交额与换手率不可用。' }
  if (range.value === 'custom' && !custom.value) return { stats: null, error: '请选择日期并应用流动性区间。' }
  try { return { stats: calculateEtfLiquidity(market.data, { range: range.value, ...(range.value === 'custom' ? custom.value : {}), now: dashboard.checkedAt.value }), error: '' } }
  catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats), latestSize = computed(() => size.data?.history.at(-1)), previousSize = computed(() => size.data?.history.at(-2))
const sizeChange = computed(() => latestSize.value && previousSize.value ? (latestSize.value.netAssets / previousSize.value.netAssets - 1) * 100 : null)
const notice = computed(() => collectionNotice(dashboard.states.collection.data?.sources['512890'], { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(market.data) }))
const freshness = computed(() => dataFreshness(market.data?.latest.date, { now: dashboard.checkedAt.value, kind: 'market' }))
const sizeOld = computed(() => size.data?.date && (dashboard.checkedAt.value.getTime() - Date.parse(`${size.data.date}T00:00:00+08:00`)) / 86400000 > 180)
const readErrors = computed(() => [[market, 'ETF 行情'], [size, '规模'], [fees, '费率']].filter(([state]) => state.error).map(([state, label]) => `${label}：${state.error}`).join('；'))
const hasWarning = computed(() => Boolean(readErrors.value || result.value.error || size.data?.status !== 'ok' || !fees.data || sizeOld.value || notice.value.warning || freshness.value.level === 'old' || stats.value?.missingAmount || stats.value?.missingTurnover))
const money = value => Number.isFinite(value) ? `${(value / 1e8).toFixed(2)} 亿元` : '—'
const percent = (value, digits = 2) => Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—'
const cash = value => Number.isFinite(value) ? `${value.toFixed(2)} 元` : '—'
const time = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '暂无记录'
const amount = ref('10000'), commissionBps = ref(''), minimumCommission = ref(''), days = ref('365'), assumptions = ref(null), costError = ref('')
const cost = computed(() => {
  if (!assumptions.value || !fees.data) return null
  try { return estimateEtfCost(assumptions.value, fees.data, stats.value?.current.amount20) } catch { return null }
})
function applyCost() {
  costError.value = ''; assumptions.value = null
  try {
    if (!fees.data) throw new Error('费率不可用，不能估算基金运作费用。')
    if ([amount.value, commissionBps.value, minimumCommission.value, days.value].some(value => String(value).trim() === '')) throw new Error('请填写自己的佣金费率和最低收费，不能把未知费用当作零。')
    const value = { amount: Number(amount.value), commissionBps: Number(commissionBps.value), minimumCommission: Number(minimumCommission.value), days: Number(days.value) }
    estimateEtfCost(value, fees.data, stats.value?.current.amount20); assumptions.value = value
  } catch (error) { costError.value = error.message }
}
function choose(key) { const current = stats.value; if (key === 'custom' && !start.value) { start.value = current?.startDate ?? ''; end.value = current?.endDate ?? '' } range.value = key }
function exportHistory() {
  if (!stats.value) return
  const rows = [['日期', '成交额（元）', '20日均成交额（元）', '场内换手率（%）', '20日均换手率（%）'], ...stats.value.points.map(point => [point.date, point.amount ?? '', point.amount20 ?? '', point.turnover ?? '', point.turnover20 ?? ''])]
  try { downloadBlob(new Blob(['\uFEFF' + rows.map(row => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `512890_流动性_${stats.value.startDate}_${stats.value.endDate}.csv`); message.value = '流动性 CSV 已生成，已请求浏览器下载。' }
  catch (error) { message.value = `导出未完成：${error.message}` }
}
defineExpose({ loading, hasWarning })
</script>

<template>
  <section class="etf-liquidity panel" aria-label="ETF规模与交易成本分析" :aria-busy="loading">
    <header class="liquidity-heading"><div><h2>ETF 规模与交易成本分析</h2><p>512890 · 报告期规模、披露费率与场内成交观察</p></div><button type="button" :disabled="loading" @click="dashboard.refresh(['512890', 'etfSize', 'etfFees', 'collection'])">{{ loading ? '读取中…' : '重新读取规模与流动性' }}</button></header>
    <p v-if="readErrors" class="warning" role="status">文件读取失败：{{ readErrors }}。可用项目继续显示原数据与日期，缺失项目不可用。</p>
    <p v-if="loading" class="note" role="status">正在读取站点快照，已有内容保留原日期。</p>
    <section class="liquidity-section" aria-label="报告期规模与披露费率"><h3>报告期规模与披露费率</h3>
      <div class="liquidity-metrics profile-metrics">
        <article><h4>最近报告期资产净值</h4><strong>{{ money(latestSize?.netAssets) }}</strong><p>报告期 {{ latestSize?.date ?? '暂无记录' }} · 季度披露口径</p></article>
        <article><h4>较上个可用报告期变化</h4><strong>{{ percent(sizeChange) }}</strong><p>{{ previousSize?.date ?? '尚无前期报告' }} → {{ latestSize?.date ?? '—' }}</p></article>
        <article><h4>管理费 / 年</h4><strong>{{ percent(fees.data ? fees.data.management * 100 : null) }}</strong><p>披露资料 {{ fees.data?.documentDate ?? '暂无' }}</p></article>
        <article><h4>托管费 / 年</h4><strong>{{ percent(fees.data ? fees.data.custody * 100 : null) }}</strong><p>从基金资产计提，体现在净值中</p></article>
      </div>
      <p class="note">资产净值来自报告期，不是今日实时规模；规模变化包含行情与申赎等影响，不等同于资金净流入。费率按所列资料日期展示；管理费与托管费不包含其他运作费用，也不等同于券商买卖佣金。</p>
      <p v-if="size.data" class="note" :class="{warning: size.data.status !== 'ok' || sizeOld}">规模状态：{{ { ok: '最近一次采集成功', stale: '更新失败，保留原报告期', unavailable: '规模不可用' }[size.data.status] }} · 最近尝试 {{ time(size.data.lastAttemptAt) }} · 最近成功 {{ time(size.data.lastSuccessAt) }}（北京时间）{{ size.data.reason ? ` · ${size.data.reason}` : '' }}{{ sizeOld ? ' · 报告期距当前已超过 180 天，请核验后续披露' : '' }}</p>
      <p v-if="fees.data" class="note"><a :href="fees.data.source" target="_blank" rel="noopener noreferrer">费率资料与费用说明</a> · 人工核验日期 {{ fees.data.verifiedDate }} · <a href="https://fund.eastmoney.com/512890.html" target="_blank" rel="noopener noreferrer">查看基金资料与后续公告</a></p>
      <EtfLiquidityTrend v-if="latestSize" :stats="size.data" kind="size" />
    </section>
    <section class="liquidity-section" aria-label="成交额与流动性观察"><h3>成交额与流动性观察</h3>
      <div class="liquidity-ranges" aria-label="流动性观察区间"><button v-for="item in LIQUIDITY_RANGES" :key="item.key" type="button" :aria-pressed="range === item.key" @click="choose(item.key)">{{ item.label }}</button></div>
      <form v-if="range === 'custom'" class="liquidity-form" aria-label="自定义流动性区间" @submit.prevent="custom = { start, end }"><label>开始日期<input v-model="start" type="date" required aria-label="流动性开始日期" /></label><label>结束日期<input v-model="end" type="date" required aria-label="流动性结束日期" /></label><button type="submit">应用流动性区间</button></form>
      <p class="note" :class="{warning: notice.warning || freshness.level === 'old'}">行情日期 {{ market.data?.latest.date ?? '暂无' }} · {{ notice.text }}{{ freshness.text ? ` · ${freshness.text}` : '' }}</p>
      <p v-if="result.error" class="warning" role="status">{{ result.error }}</p>
      <template v-if="stats">
        <p class="note">实际区间 {{ stats.startDate }} — {{ stats.endDate }} · {{ stats.amountCount }} / {{ stats.count }} 日有成交额，{{ stats.turnoverCount }} / {{ stats.count }} 日有换手率；{{ market.data.backfill.completed ? '全部历史仅指已同步历史。' : '历史仍在补充。' }}{{ stats.clipped ? '所选区间起点超出可用历史，已截到首个可用交易日。' : '' }}</p>
        <p v-if="stats.missingAmount || stats.missingTurnover" class="warning">缺成交额 {{ stats.missingAmount }} 日、缺换手率 {{ stats.missingTurnover }} 日，其中缺行情 {{ stats.missingSessions }} 日；均值与极值仅统计有效样本，缺值在图表和 CSV 留空。</p>
        <div class="liquidity-metrics">
          <article><h4>{{ stats.current.date }} 成交额</h4><strong>{{ money(stats.current.amount) }}</strong></article>
          <article><h4>截止日 20 日均成交额</h4><strong>{{ money(stats.current.amount20) }}</strong><p>不足 20 个完整交易日时不可用</p></article>
          <article><h4>截止日场内换手率</h4><strong>{{ percent(stats.current.turnover) }}</strong><p>场内交易活跃度，非基金持仓换手</p></article>
          <article><h4>截止日成交额 / 20 日均额</h4><strong>{{ Number.isFinite(stats.amountVs20) ? `${stats.amountVs20.toFixed(2)} 倍` : '—' }}</strong><p>对比包含当日在内的 20 日均值</p></article>
          <article><h4>区间日均成交额</h4><strong>{{ money(stats.averageAmount) }}</strong><p>最低 {{ money(stats.minimum?.amount) }}（{{ stats.minimum?.date ?? '—' }}）<br />最高 {{ money(stats.maximum?.amount) }}（{{ stats.maximum?.date ?? '—' }}）</p></article>
          <article><h4>区间平均换手率</h4><strong>{{ percent(stats.averageTurnover) }}</strong><p>成交额为零 {{ stats.zeroAmountDays }} 日 · 不将缺值计为零</p></article>
        </div>
        <EtfLiquidityTrend :stats="stats" :selection="`${range}:${custom?.start}:${custom?.end}`" />
        <details class="liquidity-details"><summary>查看成交明细与导出</summary><button type="button" @click="exportHistory">导出流动性 CSV</button><div class="liquidity-table"><table><caption>512890 所选区间成交额与场内换手率</caption><thead><tr><th>日期</th><th>成交额</th><th>20 日均额</th><th>换手率</th><th>20 日均换手</th></tr></thead><tbody><tr v-for="point in [...stats.points].reverse()" :key="point.date"><td>{{ point.date }}</td><td>{{ money(point.amount) }}</td><td>{{ money(point.amount20) }}</td><td>{{ percent(point.turnover) }}</td><td>{{ percent(point.turnover20) }}</td></tr></tbody></table></div></details>
      </template>
      <p v-if="message" class="note" role="status">{{ message }}</p>
    </section>
    <section class="liquidity-section" aria-label="交易成本情景估算"><h3>交易成本情景估算</h3>
      <form class="liquidity-form" @submit.prevent="applyCost"><label>每笔交易金额（元）<input v-model="amount" type="number" min="0.01" max="1000000000000" step="0.01" required aria-label="成本交易金额" /></label><label>券商佣金（万分比）<input v-model="commissionBps" type="number" min="0" max="100" step="0.01" required placeholder="自行填写，如万一填 1" aria-label="成本佣金万分比" /></label><label>每笔最低佣金（元）<input v-model="minimumCommission" type="number" min="0" max="1000000" step="0.01" required placeholder="以券商实际规则为准" aria-label="成本最低佣金" /></label><label>假设持有天数<input v-model="days" type="number" min="0" max="36500" step="1" required aria-label="成本持有天数" /></label><button type="submit">计算成本情景</button></form>
      <p v-if="costError" class="warning" role="alert">{{ costError }}</p>
      <div v-if="cost" class="liquidity-metrics profile-metrics" aria-live="polite"><article><h4>单笔佣金</h4><strong>{{ cash(cost.perOrder) }}</strong><p>金额 × 万分比 / 10000，与最低收费取较大值</p></article><article><h4>两笔等额买卖佣金</h4><strong>{{ cash(cost.equalRoundTrip) }}</strong><p>假设买入、卖出均为 {{ cash(assumptions.amount) }}</p></article><article><h4>管理 + 托管费用参考</h4><strong>{{ cash(cost.managementCustody) }}</strong><p>资产恒定 {{ cash(assumptions.amount) }}、持有 {{ assumptions.days }} 天的简化估算</p></article><article><h4>单笔金额 / 截止日 20 日均额</h4><strong>{{ percent(cost.participation === null ? null : cost.participation * 100, 4) }}</strong><p>成交占比参考，不是冲击成本预测</p></article></div>
      <p class="note">假设仅在本页用于试算，佣金以自己的券商规则为准。管理与托管费已反映在基金净值中，不再从账本或历史收益重复扣除；以上参考金额不与交易佣金相加作为实际支出。未估算其他运作费用、交易相关税费、滑点或买卖价差。</p>
      <p class="warning">买卖价差：未接入盘口数据。需要同一时刻的买一／卖一与深度数据；日内振幅、成交额和换手率不能代替可成交价差。成交活跃也不保证任意订单即时成交。</p>
    </section>
    <details class="liquidity-details note"><summary>数据来源与计算口径</summary><p>成交额沿用东方财富 512890 日线，单位元；场内换手率沿用来源百分数，不再次乘 100。20 日均值要求连续 20 个交易日都有该字段，缺日、缺字段或预热不足保留空值。窗口在所选区间前预热，图表滑块只改变查看范围。全年口径受已维护交易日历限制，截止日排除当前未收盘交易日。</p><p>规模采用天天基金报告期资产净值系列，原始单位亿元在采集时转为元，显示时转回亿元。仅连接真实报告点，不生成日度规模，不用成交额／换手率反推资产净值。规模日期独立于行情日期。</p><p>规模更新由独立采集命令执行；页面重新读取只读取站点快照。费率是人工核验的资料快照，资料更新后需要再次核验，不自动认定旧文件仍是最新费率。</p><p><a :href="size.data?.source ?? 'https://fund.eastmoney.com/512890.html'" target="_blank" rel="noopener noreferrer">天天基金规模资料</a> · <a href="https://quote.eastmoney.com/sh512890.html" target="_blank" rel="noopener noreferrer">东方财富 512890 行情</a></p></details>
  </section>
</template>

<style scoped>
.etf-liquidity { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); } h2 { font-size: 15px; } h3 { font-size: 13px; color: #c9d9ef; }
.liquidity-heading, .liquidity-ranges, .liquidity-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; } .liquidity-heading { justify-content: space-between; } .liquidity-heading p, .note, .warning { font-size: 11px; color: #93a4bf; line-height: 1.85; margin-top: 8px; overflow-wrap: anywhere; } .warning { color: #d5b57f; }
.liquidity-section { border-top: 1px solid #223049; margin-top: 18px; padding-top: 18px; } .liquidity-ranges { margin-top: 12px; } button, input { padding: 8px 10px; border: 1px solid #33435b; border-radius: 6px; background: #111d30; color: #c7d8f2; font: inherit; font-size: 11px; min-width: 0; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button[aria-pressed=true] { background: #183253; border-color: #408cff; } button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.liquidity-form { align-items: end; margin-top: 14px; } label { font-size: 11px; color: #acbcd3; min-width: 0; flex: 1 1 150px; } input { display: block; margin-top: 6px; width: 100%; box-sizing: border-box; color-scheme: dark; } .liquidity-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0; } .liquidity-metrics article { background: #0a1220; border: 1px solid #223049; border-radius: 8px; padding: 14px; min-width: 0; } h4 { color: #a8bad3; font-size: 11px; font-weight: 500; } .liquidity-metrics strong { display: block; color: #89dce4; font-family: var(--font-mono); font-size: 20px; margin-top: 10px; overflow-wrap: anywhere; } .liquidity-metrics p { color: #93a4bf; font-size: 10px; margin-top: 8px; line-height: 1.8; }
.profile-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.liquidity-details { margin-top: 14px; border-top: 1px solid #223049; padding-top: 12px; } summary { cursor: pointer; color: #b9c9df; font-size: 12px; } .liquidity-details button { margin-top: 10px; } .liquidity-table { overflow: auto; max-height: 350px; margin-top: 12px; } table { border-collapse: collapse; min-width: 570px; width: 100%; font-size: 11px; } th,td { padding: 10px 8px; border-bottom: 1px solid #223049; text-align: right; white-space: nowrap; } th:first-child,td:first-child { text-align: left; } td { font-family: var(--font-mono); } caption { text-align: left; padding-bottom: 8px; color: #aebfd8; }
@media(max-width:1100px) { .liquidity-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } } @media(max-width:640px) { .etf-liquidity { padding: 15px 12px; } .liquidity-metrics { grid-template-columns: minmax(0,1fr); } .liquidity-form label { flex-basis: 100%; } }
</style>
