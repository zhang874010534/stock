<script setup>
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateEtfPremium, calculateNavTracking, ETF_NAV_RANGES } from '../utils/etfNavAnalysis.js'
import { ETF_NAV_SOURCE } from '../utils/etfNav.js'
import { collectionNotice, dataFreshness } from '../utils/sourceStatus.js'
import { riskPercent } from '../utils/priceRisk.js'
import { downloadBlob } from '../utils/chartExport.js'

const EtfNavTrend = defineAsyncComponent(() => import('./EtfNavTrend.vue'))
const dashboard = useDashboardData(), price = dashboard.states['512890'], nav = dashboard.states.etfNav, index = dashboard.states.H30269, events = dashboard.states.etfDistributions
const premiumInputs = shallowRef(null), trackingInputs = shallowRef(null)
const keys = ['512890', 'etfNav', 'H30269', 'etfDistributions']
const loading = computed(() => keys.some(key => dashboard.states[key].loading))
const range = ref('year'), customStart = ref(''), customEnd = ref(''), custom = ref(null), message = ref('')
watch(() => keys.flatMap(key => { const state = dashboard.states[key]; return [state.data, state.loading, state.error] }), () => {
  if (loading.value) return
  if (price.data && nav.data && (!premiumInputs.value || !price.error && !nav.error)) premiumInputs.value = { market: price.data, nav: nav.data }
  if (nav.data && index.data && events.data && (!trackingInputs.value || !nav.error && !index.error && !events.error)) trackingInputs.value = { nav: nav.data, index: index.data, events: events.data }
}, { immediate: true })
for (const key of [...keys, 'collection']) dashboard.ensure(key)
function calculate(kind) {
  const inputs = kind === 'premium' ? premiumInputs.value : trackingInputs.value
  if (!inputs) return { stats: null, error: '尚无完整输入，不能假设缺失值为零。' }
  if (range.value === 'custom' && !custom.value) return { stats: null, error: '请选择日期并应用区间。' }
  try {
    const options = { range: range.value, ...(range.value === 'custom' ? custom.value : {}) }
    return { stats: kind === 'premium' ? calculateEtfPremium(inputs.market, inputs.nav, options) : calculateNavTracking(inputs.nav, inputs.index, inputs.events, options), error: '' }
  } catch (error) { return { stats: null, error: error.message } }
}
const premiumResult = computed(() => calculate('premium')), trackingResult = computed(() => calculate('tracking'))
const premium = computed(() => premiumResult.value.stats), tracking = computed(() => trackingResult.value.stats)
const readErrors = computed(() => keys.filter(key => dashboard.states[key].error).map(key => `${{ '512890': 'ETF 行情', etfNav: '净值', H30269: '标的指数', etfDistributions: '分红／拆分档案' }[key]}：${dashboard.states[key].error}`).join('；'))
const navInput = computed(() => premiumInputs.value?.nav ?? trackingInputs.value?.nav ?? nav.data)
const navFreshness = computed(() => dataFreshness(navInput.value?.date, { now: dashboard.checkedAt.value, kind: 'indicator' }))
const marketNotices = computed(() => ['512890', 'H30269'].map(code => ({ code, ...collectionNotice(dashboard.states.collection.data?.sources[code], { unavailable: Boolean(dashboard.states.collection.error), hasData: Boolean(code === '512890' ? premiumInputs.value?.market : trackingInputs.value?.index) }) })))
const hasWarning = computed(() => Boolean(readErrors.value || navInput.value?.status !== 'ok' || navFreshness.value.level === 'old' || !premium.value || !tracking.value || premium.value.missingCount || marketNotices.value.some(notice => notice.warning) || trackingInputs.value?.events.status !== 'ok'))
const selection = computed(() => `${range.value}:${custom.value?.start}:${custom.value?.end}`)
const money = number => Number.isFinite(number) ? `${number.toFixed(4)} 元` : '—'
const pp = number => Number.isFinite(number) ? `${number > 0 ? '+' : ''}${(number * 100).toFixed(4)} 个百分点` : '—'
const time = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '暂无记录'
function choose(key) {
  if (key === 'custom' && !customStart.value) { customStart.value = premium.value?.startDate ?? tracking.value?.startDate ?? ''; customEnd.value = premium.value?.endDate ?? tracking.value?.endDate ?? '' }
  range.value = key
}
function exportHistory() {
  if (!premium.value) return
  const rows = [['日期', '收盘价（元）', '单位净值（元）', '同日折溢价（%）'], ...premium.value.points.map(point => [point.date, point.close ?? '', point.nav ?? '', point.premium === null ? '' : point.premium * 100])]
  try { downloadBlob(new Blob(['\uFEFF' + rows.map(row => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `512890_折溢价_${premium.value.startDate}_${premium.value.endDate}.csv`); message.value = '折溢价 CSV 已生成，已请求浏览器下载。' }
  catch (error) { message.value = `导出未完成：${error.message}` }
}
defineExpose({ loading, hasWarning })
</script>

<template>
  <section class="etf-nav-analysis panel" aria-label="ETF净值折溢价与跟踪分析" :aria-busy="loading">
    <header class="nav-heading"><div><h2>ETF 净值、折溢价与跟踪分析</h2><p>512890 · 公布单位净值与收盘价 · 标的指数 H30269</p></div><button type="button" :disabled="loading" @click="dashboard.refresh([...keys, 'collection'])">{{ loading ? '读取中…' : '重新读取净值分析数据' }}</button></header>
    <p class="nav-note">使用已公布的每日单位净值，按净值所属日与收盘价对齐。这里是收盘后对比，净值可能晚于收盘公布，不是盘中 IOPV 或实时可成交折溢价。</p>
    <div class="nav-ranges" aria-label="净值分析区间"><button v-for="item in ETF_NAV_RANGES" :key="item.key" type="button" :aria-pressed="range === item.key" @click="choose(item.key)">{{ item.label }}</button></div>
    <form v-if="range === 'custom'" class="nav-custom" aria-label="自定义净值区间" @submit.prevent="custom = { start: customStart, end: customEnd }"><label>开始日期<input v-model="customStart" type="date" required aria-label="净值开始日期" /></label><label>结束日期<input v-model="customEnd" type="date" required aria-label="净值结束日期" /></label><button type="submit">应用净值区间</button></form>
    <p v-if="readErrors" class="nav-warning" role="status">文件读取失败：{{ readErrors }}。已有分析保留各自上次完整输入和日期；尚无完整输入的项目不可用。</p>
    <p v-else-if="loading" class="nav-note" role="status">正在读取；已有分析暂显示原输入。</p>
    <p v-if="navInput" class="nav-note" :class="{ 'nav-warning': navInput.status !== 'ok' || navFreshness.level === 'old' }">净值源日期 {{ navInput.date ?? '暂无' }} · {{ {ok:'最近一次净值采集成功',stale:'净值更新失败，保留原数据',unavailable:'净值不可用'}[navInput.status] }} · 最近尝试 {{ time(navInput.lastAttemptAt) }} · 最近成功 {{ time(navInput.lastSuccessAt) }}（北京时间）{{ navFreshness.text ? ` · ${navFreshness.text}` : '' }}{{ navInput.reason ? ` · ${navInput.reason}` : '' }}。</p>
    <p v-for="notice in marketNotices" :key="notice.code" class="nav-note" :class="{ 'nav-warning': notice.warning }">{{ notice.code }} 行情 · {{ notice.text }}</p>
    <p v-if="message" class="nav-note" role="status">{{ message }}</p>
    <section class="nav-section" aria-label="同日折溢价分析"><h3>同日收盘价与净值</h3>
      <p v-if="premiumResult.error" class="nav-warning" role="status">折溢价暂不能计算：{{ premiumResult.error }}</p>
      <template v-if="premium"><p class="nav-note">折溢价区间 {{ premium.startDate }} — {{ premium.endDate }} · {{ premium.alignedCount }} / {{ premium.count }} 个交易日同日对齐。输入：ETF 行情 {{ premium.priceDate }}、净值 {{ premium.navDate }}；最近对齐样本为 {{ premium.current.date }}。</p>
        <p v-if="premium.missingCount" class="nav-warning">缺少 {{ premium.missingCount }} 个同日样本，图表留空；均值与极值只统计已对齐日期，不代表完整区间。</p>
        <div class="nav-metrics"><article><h4>{{ premium.current.date }} 收盘价</h4><strong>{{ money(premium.current.close) }}</strong></article><article><h4>同日单位净值</h4><strong>{{ money(premium.current.nav) }}</strong></article><article><h4>同日{{ premium.current.premium >= 0 ? '溢价' : '折价' }}</h4><strong>{{ riskPercent(premium.current.premium, true) }}</strong></article><article><h4>已对齐样本平均折溢价</h4><strong>{{ riskPercent(premium.average, true) }}</strong></article><article><h4>区间最高折溢价</h4><strong>{{ riskPercent(premium.maximum.premium, true) }}</strong><p>{{ premium.maximum.date }}</p></article><article><h4>区间最低折溢价</h4><strong>{{ riskPercent(premium.minimum.premium, true) }}</strong><p>{{ premium.minimum.date }}</p></article></div>
        <EtfNavTrend :stats="premium" kind="price" :selection="selection" /><EtfNavTrend :stats="premium" kind="premium" :selection="selection" />
        <details class="nav-details"><summary>查看折溢价历史明细</summary><button type="button" @click="exportHistory">导出折溢价 CSV</button><div class="nav-table"><table><caption>所选交易日 · 同日折溢价</caption><thead><tr><th>日期</th><th>收盘价</th><th>单位净值</th><th>折溢价</th></tr></thead><tbody><tr v-for="point in [...premium.points].reverse()" :key="point.date"><td>{{ point.date }}</td><td>{{ money(point.close) }}</td><td>{{ money(point.nav) }}</td><td>{{ riskPercent(point.premium, true) }}</td></tr></tbody></table></div></details>
      </template>
    </section>
    <section class="nav-section" aria-label="净值跟踪偏离分析"><h3>净值相对标的价格指数的偏离</h3><p class="nav-warning">H30269 为价格指数，不含成分现金分红再投资。本项是净值相对价格指数的观察偏离，可能包含股息留存和费用等影响，不等同于基金合同的全收益口径跟踪差异或跟踪误差。</p>
      <p v-if="trackingResult.error" class="nav-warning" role="status">跟踪偏离暂不能计算：{{ trackingResult.error }}</p>
      <template v-if="tracking"><p class="nav-note">跟踪区间 {{ tracking.startDate }} — {{ tracking.endDate }} · {{ tracking.count }} 个完整交易日 · {{ tracking.returnCount }} 个相邻日收益；输入净值 {{ tracking.navDate }}、指数 {{ tracking.indexDate }}。净值按已核验拆分调整，不计 ETF 现金分红再投资。</p><p v-if="tracking.distributionStatus !== 'ok'" class="nav-warning">拆分档案使用保留记录，仅在原核验范围内计算。</p>
        <div class="nav-metrics"><article><h4>拆分调整净值区间变化</h4><strong>{{ riskPercent(tracking.current.navReturn, true) }}</strong></article><article><h4>H30269 价格指数区间变化</h4><strong>{{ riskPercent(tracking.current.indexReturn, true) }}</strong></article><article><h4>累计变化偏离</h4><strong>{{ pp(tracking.current.deviation) }}</strong></article><article><h4>平均每日变化差</h4><strong>{{ pp(tracking.meanDailyDifference) }}</strong></article><article><h4>日变化差的年化波动</h4><strong>{{ riskPercent(tracking.annualizedDifferenceVolatility) }}</strong><p>{{ tracking.annualizedDifferenceVolatility === null ? '不足两个日收益样本，暂不可计算' : '日变化差样本标准差 × √252' }}</p></article><article><h4>区间拆分事件</h4><strong>{{ tracking.splitCount }} 次</strong></article></div><EtfNavTrend :stats="tracking" kind="tracking" :selection="selection" />
      </template>
    </section>
    <details class="nav-details nav-note"><summary>计算口径与数据来源</summary><p>同日折溢价 = 收盘价 ÷ 当日单位净值 − 1；正数为溢价，负数为折价。累计净值不作为折溢价分母，不拿前一天净值补当日，不对缺失日期插值。非交易日的报告期净值保留在来源档案，图表仅对比交易日。</p><p>净值相对变化 = 拆分调整后的期末净值 ÷ 起始净值 − 1；累计偏离为净值区间变化减价格指数区间变化，单位为百分点。日变化差使用相邻交易日收益之差；年化波动为其样本标准差 × √252。缺少基准、任何中间交易日、日历或拆分核验覆盖时，不生成完整跟踪分析。</p><p>年初至今以上年最后交易日为基准；近1年用对应日期或此前交易日；近30日用截止日前30个自然日或此前交易日。自定义开始日顺延、结束日回退。全部历史仅为已同步、日历覆盖的可用样本，不代表成立以来。图表滑块仅改变查看范围，各图独立缩放；切换区间才重算。</p><p>重新读取只获取站点快照，不触发上游采集。单位净值为基金净值，不是场内价格；基金费用已体现在净值中，不重复扣费。</p><p><a :href="ETF_NAV_SOURCE" target="_blank" rel="noopener noreferrer">东方财富／天天基金净值</a> · <a href="https://quote.eastmoney.com/sh512890.html" target="_blank" rel="noopener noreferrer">512890 场内行情</a> · <a href="https://quote.eastmoney.com/zz/2.H30269.html" target="_blank" rel="noopener noreferrer">H30269 价格指数</a></p></details>
  </section>
</template>

<style scoped>
.etf-nav-analysis { min-width: 0; padding: 18px 20px; scroll-margin-top: calc(var(--header-height) + 18px); } .nav-heading, .nav-ranges, .nav-custom { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between; } h2 { font-size: 15px; } h3 { font-size: 13px; color: #c9d9ef; } .nav-note, .nav-warning, .nav-heading p { color: #93a4bf; font-size: 11px; line-height: 1.85; margin-top: 8px; overflow-wrap: anywhere; } .nav-warning { color: #d5b57f; }
button, input { padding: 8px 10px; border: 1px solid #33435b; border-radius: 6px; background: #111d30; color: #c7d8f2; font: inherit; font-size: 11px; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; } button[aria-pressed="true"] { border-color: #408cff; background: #183253; } .nav-ranges { justify-content: flex-start; margin-top: 14px; } .nav-custom { justify-content: flex-start; align-items: end; margin-top: 12px; } label { min-width: 0; color: #acbcd3; font-size: 11px; } input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; color-scheme: dark; } .nav-section { border-top: 1px solid #223049; padding-top: 18px; margin-top: 18px; }
.nav-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0; } .nav-metrics article { min-width: 0; padding: 15px; background: #0a1220; border: 1px solid #223049; border-radius: 8px; } h4 { font-size: 11px; font-weight: 500; color: #a8bad3; } .nav-metrics strong { display: block; color: #89dce4; font-family: var(--font-mono); font-size: 21px; margin-top: 10px; overflow-wrap: anywhere; } .nav-metrics p { color: #93a4bf; font-size: 10px; margin-top: 8px; line-height: 1.8; } .nav-details { margin-top: 14px; border-top: 1px solid #223049; padding-top: 12px; } summary { cursor: pointer; color: #b9c9df; font-size: 12px; } .nav-details button { margin-top: 10px; } .nav-table { margin-top: 12px; overflow: auto; max-height: 360px; } table { width: 100%; min-width: 580px; border-collapse: collapse; font-size: 11px; } th, td { text-align: right; white-space: nowrap; padding: 10px 8px; border-bottom: 1px solid #223049; } th:first-child, td:first-child { text-align: left; } th { color: #93a4bf; } td { font-family: var(--font-mono); color: #d8e6f5; } caption { text-align: left; color: #aebfd8; padding-bottom: 8px; }
@media (max-width: 1100px) { .nav-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 640px) { .etf-nav-analysis { padding: 15px 12px; } .nav-metrics { grid-template-columns: minmax(0, 1fr); } .nav-custom label { width: 100%; } }
</style>
