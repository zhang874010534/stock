<script setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { calculateLowVolatility, LOW_VOLATILITY_RANGES, ROLLING_PERIODS } from '../utils/lowVolatility.js'
import { riskPercent } from '../utils/priceRisk.js'

const LowVolatilityTrend = defineAsyncComponent(() => import('./LowVolatilityTrend.vue'))
const props = defineProps({ instrument: { type: String, default: '512890' }, market: Object,
  loading: Boolean, error: String, collectionNotice: String, collectionWarning: Boolean })
defineEmits(['retry'])
const range = ref('all'), rollingSessions = ref(60), selectedMonth = ref('')
const result = computed(() => {
  if (!props.market) return { stats: null, error: '' }
  try {
    if (props.market.code !== props.instrument) throw new Error('行情证券与当前选择不一致')
    return { stats: calculateLowVolatility(props.market, { range: range.value, rollingSessions: rollingSessions.value }), error: '' }
  } catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const selected = computed(() => stats.value?.months.find(month => month.month === selectedMonth.value))
const years = computed(() => [...new Set(stats.value?.months.map(month => month.month.slice(0, 4)) ?? [])])
const monthsByKey = computed(() => new Map(stats.value?.months.map(month => [month.month, month]) ?? []))
const monthRows = computed(() => years.value.map(year => ({ year, months: Array.from({ length: 12 }, (_, index) => {
  const key = `${year}-${String(index + 1).padStart(2, '0')}`
  return { key, item: monthsByKey.value.get(key) }
}) })))
const selection = computed(() => `${props.instrument}:${range.value}`)
const isEtf = computed(() => props.instrument === '512890')
watch(() => [props.instrument, range.value], () => { selectedMonth.value = '' })
watch(stats, value => {
  if (!value?.months.some(month => month.month === selectedMonth.value)) selectedMonth.value = value?.worstMonth?.month ?? value?.months.at(-1)?.month ?? ''
}, { immediate: true })
const tone = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
const shade = value => ({ '--shade': value == null ? 0 : .1 + Math.min(Math.abs(value) / .1, 1) * .48 })
const monthStatus = item => item?.status === 'complete' ? '完整月份' : item?.status === 'partial' ? '月内收益' : '不可计算'
const monthLabel = item => `${item.month}，${monthStatus(item)}，${riskPercent(item.value, true)}${item.reason ? `，${item.reason}` : ''}`
</script>

<template>
  <section class="low-volatility-analysis panel" :aria-label="`${instrument}低波特征分析`" :aria-busy="loading">
    <div class="low-volatility-heading"><h2>低波特征分析</h2><span>{{ instrument }} · {{ isEtf ? 'ETF 场内价格' : '红利低波价格指数' }}</span></div>
    <p class="low-volatility-note">{{ isEtf ? '使用 ETF 未复权收盘价，不含现金分红；除息、份额拆分也可能影响价格风险指标。' : '使用价格指数日收盘，不含分红再投资。' }}这里只描述已观察表现，不判定未来一定低波。</p>
    <p v-if="collectionNotice" class="low-volatility-note" :class="{ warning: collectionWarning }">行情来源：{{ collectionNotice }}</p>
    <p v-if="error" class="warning" role="status">行情读取失败{{ stats ? '，保留上次分析和原日期。' : '，暂无可用分析。' }}{{ error }}<button type="button" :disabled="loading" @click="$emit('retry')">重新读取</button></p>
    <p v-else-if="loading" class="low-volatility-note" role="status">{{ stats ? '正在重新读取行情，暂显示上次分析。' : '正在读取行情…' }}</p>
    <div class="low-volatility-ranges" role="group" aria-label="低波分析统计区间"><button v-for="item in LOW_VOLATILITY_RANGES" :key="item.key" type="button" :aria-pressed="range === item.key" @click="range = item.key">{{ item.label }}</button></div>
    <p v-if="result.error" class="warning" role="status">暂不能分析：{{ result.error }}</p>
    <p v-else-if="!stats && !loading" class="low-volatility-note">暂无可用日线收盘行情。</p>
    <template v-if="stats">
      <p class="low-volatility-note">统计区间：{{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个收盘样本 / {{ stats.returnCount }} 个日收益。{{ stats.backfillCompleted ? '' : '历史仍在补充。' }}只使用已核验日历覆盖，不代表成立以来。</p>
      <dl class="low-volatility-summary">
        <div><dt>区间年化波动率</dt><dd>{{ riskPercent(stats.annualizedVolatility) }}</dd><p>日收益样本标准差 × √252</p></div>
        <div><dt>区间年化下行波动率</dt><dd>{{ riskPercent(stats.annualizedDownsideDeviation) }}</dd><p>0% 日收益目标 · 全部样本 N−1 口径</p></div>
        <div><dt>最新 {{ rollingSessions }} 日年化波动率</dt><dd>{{ riskPercent(stats.latestRolling.volatility) }}</dd><p>下行 {{ riskPercent(stats.latestRolling.downside) }}{{ stats.latestRolling.volatility == null ? ' · 连续样本不足' : '' }}</p></div>
        <div><dt>最差完整月份</dt><dd :class="tone(stats.worstMonth?.value)">{{ riskPercent(stats.worstMonth?.value, true) }}</dd><p>{{ stats.worstMonth?.month ?? '暂无完整月份' }} · {{ stats.completeMonthCount }} 个完整月参与排名</p></div>
      </dl>
      <div class="low-volatility-subheading"><h3>滚动波动率</h3><div role="group" aria-label="滚动波动率窗口"><button v-for="period in ROLLING_PERIODS" :key="period" type="button" :aria-pressed="rollingSessions === period" @click="rollingSessions = period">{{ period }}日</button></div></div>
      <LowVolatilityTrend :stats="stats" :selection="selection" />
      <p class="low-volatility-note">窗口固定使用 {{ rollingSessions }} 个连续日收益（{{ rollingSessions + 1 }} 个收盘价），可用区间之前历史预热；不足时留空。滑块只改变查看范围，不改变统计区间。</p>
      <div class="low-volatility-subheading"><h3>月度价格收益热力图</h3><span>红色上涨 · 绿色下跌 · * 为月内收益</span></div>
      <div class="monthly-scroll" role="region" aria-label="月度收益热力图，可横向查看全年月份" tabindex="0"><table class="monthly-heatmap"><caption>月收益以上月末收盘为基准；点选月份查看详情</caption><thead><tr><th scope="col">年份</th><th v-for="month in 12" :key="month" scope="col">{{ month }}月</th></tr></thead><tbody>
        <tr v-for="row in monthRows" :key="row.year"><th scope="row">{{ row.year }}</th><td v-for="cell in row.months" :key="cell.key">
          <button v-if="cell.item" type="button" :class="[tone(cell.item.value), { partial: cell.item.status === 'partial' }]" :style="shade(cell.item.value)" :aria-label="monthLabel(cell.item)" :aria-pressed="selectedMonth === cell.key" @click="selectedMonth = cell.key">{{ riskPercent(cell.item.value, true) }}{{ cell.item.status === 'partial' ? '*' : '' }}</button>
          <span v-else class="outside-month" :aria-label="`${cell.key}未在统计范围内`">—</span>
        </td></tr>
      </tbody></table></div>
      <p v-if="selected" class="month-detail" role="status">{{ selected.month }} · {{ monthStatus(selected) }} · {{ riskPercent(selected.value, true) }}<br/><template v-if="selected.baseDate">基准 {{ selected.baseDate }} → 截至 {{ selected.endDate }}。</template>{{ selected.reason }}</p>
      <p class="low-volatility-note">未完整结束的月份不参与最差月份排名。首月缺少上月末基准或区间未覆盖整月时显示“—”；不把首个收盘价当作上月末。表内空白月份未在统计范围内。</p>
      <details class="worst-months"><summary>最差完整月份前 {{ stats.worstMonths.length }} 名</summary><ol v-if="stats.worstMonths.length"><li v-for="month in stats.worstMonths" :key="month.month"><button type="button" @click="selectedMonth = month.month">{{ month.month }}</button><strong :class="tone(month.value)">{{ riskPercent(month.value, true) }}</strong></li></ol><p v-else class="low-volatility-note">暂无可排名的完整月份。</p></details>
      <div class="low-volatility-subheading"><h3>主要回撤事件</h3><span>{{ stats.totalEvents }} 次已观察事件 · 按跌幅展示前 {{ stats.events.length }} 次</span></div>
      <ol v-if="stats.events.length" class="drawdown-events"><li v-for="(event, i) in stats.events" :key="event.peakDate">
        <header><strong>#{{ i + 1 }} · 跌幅 {{ riskPercent(event.depth) }}</strong><span>{{ event.recoveryDate ? '已恢复' : '尚未恢复' }}</span></header>
        <dl><div><dt>高点日期</dt><dd>{{ event.peakDate }}</dd></div><div><dt>低点日期</dt><dd>{{ event.troughDate }}</dd></div><div><dt>首次恢复</dt><dd>{{ event.recoveryDate ?? '—' }}</dd></div><div><dt>{{ event.recoveryDate ? '高点至恢复' : '高点至截止日' }}</dt><dd>{{ event.durationDays }} 个自然日</dd></div></dl>
        <p v-if="!event.recoveryDate" class="low-volatility-note">截至 {{ event.endDate }} 仍未回到原高点。</p>
      </li></ol>
      <p v-else class="low-volatility-note">所选区间未观察到收盘回撤，无需恢复。</p>
      <p class="low-volatility-note">高点限于所选统计区间；收盘首次达到原高点即视为恢复。同一尚未恢复过程只计一次事件，等深跌幅按高点日期排序；区间切换会改变事件范围。</p>
    </template>
    <details class="low-volatility-method"><summary>低波分析口径</summary>
      <p>日收益 = 当日收盘 ÷ 上一交易日收盘 − 1。年化总波动率 = 日收益样本标准差 × √252；年化下行波动率 = √[Σmin(日收益,0)² ÷ (N−1)] × √252，N为全部日收益数量，不只计算下跌日。少于两个日收益时不展示波动率。</p>
      <p>0%为本模块固定的日收益目标，不是实际无风险利率。下行波动率衡量低于目标的偏差，不能直接解释为亏损概率，也不保证小于总波动率。</p>
      <p>年初至今要求上年末基准；近1年／近3年以截止日对应周年或此前最近交易日为基准。月收益 = 月末或最新月内收盘 ÷ 上月最后交易日收盘 − 1，只将完整月份纳入排名。</p>
      <p>复用现有静态日线，不增加数据源。统计区间缺少交易日或日历未覆盖时停止分析，不填补行情；月度基准不足时该月留空。ETF使用未复权价格，现金分红和拆分可能影响结果，需结合ETF分红收益区域阅读。</p>
      <p><a href="https://www.cfainstitute.org/sites/default/files/-/media/documents/book/curriculum-update/2021-member-guide-refresher-readings.PDF#page=48" target="_blank" rel="noopener noreferrer">下行偏差样本公式参考（CFA Institute）</a></p>
    </details>
  </section>
</template>

<style scoped>
.low-volatility-analysis { min-width: 0; padding: 18px 20px; }
.low-volatility-heading, .low-volatility-subheading { display: flex; align-items: baseline; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
.low-volatility-heading h2 { font-size: 15px; }
.low-volatility-heading span, .low-volatility-subheading span { color: #93a4bf; font-size: 11px; }
.low-volatility-subheading { margin-top: 20px; }
.low-volatility-subheading h3 { font-size: 13px; font-weight: 550; }
.low-volatility-subheading div { display: flex; gap: 7px; }
.low-volatility-note, .low-volatility-method, .month-detail { margin-top: 8px; color: #93a4bf; font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
.warning { margin-top: 8px; color: #d5b57f; font-size: 11px; line-height: 1.8; }
.warning button, .worst-months button { background: none; border: 0; color: #9bc5ff; text-decoration: underline; cursor: pointer; }
.warning button { margin-left: 8px; }
.low-volatility-ranges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.low-volatility-ranges button, .low-volatility-subheading button { padding: 6px 10px; border: 1px solid #33435b; border-radius: 6px; color: #c7d8f2; background: #111d30; font-size: 11px; cursor: pointer; }
button[aria-pressed="true"] { border-color: #67d5df; color: #89e3e9; }
button:focus-visible, summary:focus-visible, .monthly-scroll:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.low-volatility-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.low-volatility-summary > div { padding: 12px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; }
.low-volatility-summary dt { color: #acbcd3; font-size: 11px; }
.low-volatility-summary dd { margin: 8px 0 0; color: #c7d8f2; font: 600 23px var(--font-mono); }
.low-volatility-summary p { margin-top: 7px; color: #93a4bf; font-size: 10px; line-height: 1.8; }
.monthly-scroll { max-width: 100%; overflow-x: auto; margin-top: 12px; border: 1px solid #223049; border-radius: 8px; }
.monthly-heatmap { width: 100%; min-width: 780px; border-collapse: separate; border-spacing: 5px; table-layout: fixed; font-size: 10px; }
.monthly-heatmap caption { padding: 10px; text-align: left; color: #93a4bf; }
.monthly-heatmap th { padding: 6px 0; color: #acbcd3; font-weight: 500; }
.monthly-heatmap th:first-child { width: 46px; }
.monthly-heatmap td { text-align: center; }
.monthly-heatmap button { width: 100%; min-height: 36px; padding: 4px 1px; border: 1px solid transparent; border-radius: 4px; font: 10px var(--font-mono); color: #c7d8f2; background: #142035; cursor: pointer; }
.monthly-heatmap button.positive { background: rgba(192, 64, 79, var(--shade)); color: #ffd0d6; }
.monthly-heatmap button.negative { background: rgba(29, 134, 100, var(--shade)); color: #b1ebd3; }
.monthly-heatmap button.partial { border: 1px dashed #a7b5ca; }
.monthly-heatmap button[aria-pressed="true"] { outline: 2px solid #67d5df; outline-offset: -2px; }
.outside-month { color: #667b99; }
.month-detail { padding: 9px 12px; border-left: 2px solid #67d5df; background: #111d30; }
.worst-months { margin-top: 12px; font-size: 11px; color: #acbcd3; }
.worst-months summary, .low-volatility-method summary { cursor: pointer; }
.worst-months ol { list-style: decimal inside; margin-top: 6px; }
.worst-months li { padding: 5px 0; }
.worst-months strong { margin-left: 12px; font-family: var(--font-mono); }
.drawdown-events { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.drawdown-events li { border: 1px solid #223049; border-radius: 8px; padding: 12px; background: #0a1220; }
.drawdown-events header { display: flex; justify-content: space-between; gap: 8px; color: #f0a3ba; font-size: 12px; }
.drawdown-events header span { color: #acbcd3; font-size: 11px; }
.drawdown-events dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; font-size: 11px; }
.drawdown-events dt { color: #93a4bf; }
.drawdown-events dd { margin: 4px 0 0; color: #c7d8f2; }
.low-volatility-method { padding-top: 10px; border-top: 1px solid #223049; }
.low-volatility-method p { margin-top: 6px; }
.low-volatility-method a { color: #9bc5ff; text-decoration: underline; }
.low-volatility-analysis .positive { color: #ff8790; }
.low-volatility-analysis .negative { color: #63d0a7; }
@media (max-width: 1050px) { .low-volatility-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .low-volatility-analysis { padding: 15px 12px; } .low-volatility-heading span { flex-basis: 100%; } .drawdown-events { grid-template-columns: minmax(0, 1fr); } .low-volatility-summary dd { font-size: 20px; } }
</style>
