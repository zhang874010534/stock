<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateEtfReturn, chinaDate, etfReturnHistory, ETF_DISTRIBUTION_SOURCE } from '../utils/etfDistributions.js'
import { signedValue } from '../utils/marketSummary.js'
const EtfReturnTrend = defineAsyncComponent(() => import('./EtfReturnTrend.vue'))

const props = defineProps({ history: { type: Array, default: () => [] }, loading: Boolean, error: String, sourceNotice: String, backfillCompleted: Boolean })
const emit = defineEmits(['retry-market'])
const dashboard = useDashboardData(), state = dashboard.states.etfDistributions
dashboard.ensure('etfDistributions')
const range = ref('all')
const result = computed(() => {
  if (!state.data || !props.history.length) return { stats: null, error: '' }
  try { return { stats: calculateEtfReturn(etfReturnHistory(props.history, range.value), state.data), error: '' } }
  catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const notCurrent = computed(() => state.data?.coverage && state.data.coverage.end < chinaDate(dashboard.checkedAt.value))
const hasWarning = computed(() => Boolean(state.error || state.data?.status !== 'ok' || result.value.error || notCurrent.value))
const loading = computed(() => state.loading || props.loading)
const error = computed(() => state.error)
defineExpose({ loading, error, hasWarning })
const cash = value => value == null ? '—' : `${value.toFixed(4)} 元`
const percent = value => signedValue(value == null ? null : value * 100, 2, '%')
const refresh = () => dashboard.refresh(['etfDistributions'])
const dividends = computed(() => [...(state.data?.dividends ?? [])].reverse())
</script>

<template>
  <section class="etf-income panel" aria-label="ETF 分红记录与含分红收益" :aria-busy="loading">
    <div class="income-heading"><h2>ETF 分红记录与含分红收益</h2><span>512890 · 场内收盘价口径</span><button type="button" :disabled="state.loading" @click="refresh">{{ state.loading ? '读取中…' : '重新读取分红' }}</button></div>
    <p class="income-note">ETF 实际现金分红与 H30269 指数股息率分开记录。原 K 线展示未复权价格，下方比较持有收益。</p>
    <p v-if="state.loading" class="income-note" role="status">{{ state.data ? '正在重新读取分红，暂显示原记录及核验日期。' : '正在读取 ETF 分红记录…' }}</p>
    <p v-if="state.error" class="income-warning" role="status">分红文件读取失败{{ state.data ? '，保留原记录及核验范围。' : '，暂无已核验记录。' }}<button type="button" :disabled="state.loading" @click="refresh">重试</button></p>
    <p v-if="state.data && state.data.status !== 'ok'" class="income-warning" role="status">{{ state.data.reason }}</p>
    <p v-if="props.error" class="income-warning" role="status">行情读取失败，沿用已显示行情及原日期。<button type="button" :disabled="props.loading" @click="emit('retry-market')">重新读取行情</button></p>
    <p v-if="sourceNotice" class="income-warning">行情来源状态：{{ sourceNotice }}</p>
    <p v-if="state.data?.coverage" class="income-note">分红／拆分记录核验范围：{{ state.data.coverage.start }} — {{ state.data.coverage.end }} · <a :href="ETF_DISTRIBUTION_SOURCE" target="_blank" rel="noopener noreferrer">天天基金分红送配档案</a></p>
    <p v-if="notCurrent" class="income-warning">分红记录尚未核验至今日；仅在原核验范围内计算，不将后续未知分红视为零。</p>
    <div class="income-ranges" role="group" aria-label="ETF 收益计算区间"><button v-for="item in [{ key: 'all', label: '全部已同步' }, { key: 'ytd', label: '年初至今' }, { key: 'year', label: '近1年' }]" :key="item.key" type="button" :aria-pressed="range === item.key" @click="range = item.key">{{ item.label }}</button></div>
    <p v-if="result.error" class="income-warning" role="status">暂不能计算含分红收益：{{ result.error }}</p>
    <p v-else-if="!stats && !loading" class="income-note">暂无可计算的已同步行情或已核验分红记录。</p>
    <template v-if="stats">
      <p class="income-note">计算区间：{{ stats.startDate }} — {{ stats.endDate }} · {{ stats.points.length }} 个已同步收盘样本{{ backfillCompleted ? '' : ' · 历史仍在补充' }}。按区间首日收盘买入 1 份并持有。</p>
      <dl class="income-summary">
        <div><dt>价格收益（拆分调整）</dt><dd>{{ percent(stats.current.priceReturn) }}</dd><p>区间内 {{ stats.splits }} 次份额拆分／折算</p></div>
        <div><dt>现金分红权益</dt><dd>{{ cash(stats.current.cash) }}</dd><p>每期初份额 · {{ stats.count }} 次 · 贡献 {{ percent(stats.current.cashReturn) }}</p><p>已发放 {{ cash(stats.received) }} · 应收 {{ cash(stats.receivable) }}</p></div>
        <div><dt>含分红收益（现金不再投）</dt><dd>{{ percent(stats.current.totalReturn) }}</dd><p>持仓市值 + 现金／应收分红</p></div>
      </dl>
      <EtfReturnTrend :stats="stats" :range="range" />
      <p v-if="stats.count === 0" class="income-note">该计算区间的来源记录暂无现金分红，价格收益与含分红收益曲线重合。</p>
      <p class="income-note">图表缩放只改变查看范围，不改变收益基准；切换上方区间重新计算。</p>
    </template>
    <details class="income-records" open><summary>现金分红明细（每份金额）</summary>
      <p v-if="state.data?.status === 'unavailable' || !state.data" class="income-note">尚无已核验的分红记录，不能确认未分红。</p>
      <p v-else-if="!dividends.length" class="income-note">截至 {{ state.data.coverage.end }} 的来源档案暂无现金分红记录。</p>
      <div v-else class="income-table"><table><thead><tr><th>权益登记日</th><th>除息日</th><th>每份现金</th><th>发放日</th><th>按行情截止日</th></tr></thead><tbody><tr v-for="item in dividends" :key="item.exDate"><td>{{ item.recordDate }}</td><td>{{ item.exDate }}</td><td>{{ cash(item.cashPerShare) }}</td><td>{{ item.payDate }}</td><td>{{ !history.length ? '暂无行情' : item.exDate > history.at(-1).date ? '未除息' : item.payDate > history.at(-1).date ? '应收未到账' : '已发放' }}</td></tr></tbody></table></div>
    </details>
    <details v-if="state.data?.splits.length" class="income-records"><summary>份额拆分／折算（独立于现金分红）</summary><p v-for="item in state.data.splits" :key="item.date" class="income-note">{{ item.date }} · 1 份变为 {{ item.ratio }} 份，不产生现金分红。</p></details>
    <details class="income-records"><summary>计算口径与来源核验</summary>
      <p class="income-note">含分红收益 =（期末份额 × 期末收盘价 + 累计现金分红权益）÷ 期初收盘价 − 1。分红权益在除息日确认，发放日前计入应收；不假设分红再投资或现金利息。只有基准日收盘买入后有权获得的分红计入；期初份额为 1，按已公布拆分比例调整后续份额。</p>
      <p class="income-note">这是场内价格持有收益，不是基金净值增长率或指数全收益；不含个人交易费用和税费，不按指数股息率推算 ETF 分红。基金已计入净值的运营费用不再重复扣除。</p>
      <p class="income-note">静态档案记录每10份金额，采集转换为每份元。核验日期表示读取来源完整记录的日期，不是分红发生日或行情日期。字段改变、未知方案或旧记录消失时停止更新并保留原数据。近期核验参考<a href="https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-31/512890_20260331_5BME.pdf" target="_blank" rel="noopener noreferrer">基金 2025 年年度报告</a>；正式分红以基金公告为准。</p>
    </details>
  </section>
</template>

<style scoped>
.etf-income { min-width: 0; padding: 18px 20px; scroll-margin-top: calc(var(--header-height) + 16px); }
.income-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.income-heading h2 { font-size: 15px; }
.income-heading span, .income-note, .income-summary p { color: #93a4bf; font-size: 11px; line-height: 1.7; }
.income-heading button { margin-left: auto; }
button { padding: 5px 9px; border: 1px solid #2c405e; border-radius: 5px; background: #111d30; color: #b8ceec; font-size: 11px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid #69a9ff; outline-offset: 2px; }
.income-note, .income-warning { margin-top: 8px; }
.income-warning { font-size: 11px; line-height: 1.7; color: #d5b57f; }
a { color: #94baff; text-decoration: underline; }
.income-ranges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
.income-ranges button[aria-pressed="true"] { border-color: #4271a5; background: #1b3454; color: #dfebfb; }
.income-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.income-summary > div { padding: 14px; border: 1px solid #223049; border-radius: 9px; background: #0a1220; }
.income-summary dt { color: #acbcd3; font-size: 12px; }
.income-summary dd { font: 600 24px var(--font-mono); color: #aad5ec; margin-top: 8px; }
.income-summary p { margin-top: 8px; }
.income-records { margin-top: 12px; padding-top: 10px; border-top: 1px solid #223049; font-size: 12px; }
summary { color: #b9c9df; cursor: pointer; }
.income-table { overflow-x: auto; margin-top: 9px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { padding: 9px; border-bottom: 1px solid #24324a; text-align: left; white-space: nowrap; }
th { color: #9aacc7; font-weight: 500; }
@media (max-width: 700px) { .etf-income { padding: 15px 12px; } .income-summary { grid-template-columns: minmax(0, 1fr); } }
</style>
