<script setup>
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { calculateIndexComparison, comparisonPercent, COMPARISON_RANGES } from '../utils/indexComparison.js'
import { collectionNotice, dataFreshness } from '../utils/sourceStatus.js'

const IndexComparisonTrend = defineAsyncComponent(() => import('./IndexComparisonTrend.vue'))
const props = defineProps({ instrument: String })
const dashboard = useDashboardData()
const index = dashboard.states.H30269, benchmark = dashboard.states['000300'], collection = dashboard.states.collection
const range = ref('year'), customStart = ref(''), customEnd = ref(''), custom = ref(null)
const pair = shallowRef(null)
const loading = computed(() => index.loading || benchmark.loading)
const readError = computed(() => [index.error ? `H30269：${index.error}` : '', benchmark.error ? `000300：${benchmark.error}` : ''].filter(Boolean).join('；'))
watch(() => [index.data, benchmark.data, index.loading, benchmark.loading, index.error, benchmark.error], () => {
  if (!loading.value && index.data && benchmark.data && (!pair.value || !readError.value)) {
    pair.value = { index: index.data, benchmark: benchmark.data }
  }
}, { immediate: true })
const result = computed(() => {
  if (!pair.value) return { stats: null, error: '' }
  try {
    if (range.value === 'custom' && !custom.value) return { stats: null, error: '请选择开始和结束日期，再点击应用区间。' }
    return { stats: calculateIndexComparison(pair.value.index, pair.value.benchmark, { range: range.value, ...(custom.value ?? {}) }), error: '' }
  } catch (error) { return { stats: null, error: error.message } }
})
const stats = computed(() => result.value.stats)
const selection = computed(() => `${range.value}:${range.value === 'custom' ? `${custom.value?.start}:${custom.value?.end}` : ''}`)
const sources = computed(() => [
  { code: 'H30269', name: '红利低波', data: pair.value?.index }, { code: '000300', name: '沪深300', data: pair.value?.benchmark },
].map(source => ({ ...source,
  notice: collectionNotice(collection.data?.sources[source.code], { unavailable: Boolean(collection.error), hasData: Boolean(source.data) }),
  freshness: dataFreshness(source.data?.latest.date, { now: dashboard.checkedAt.value, kind: 'market' }),
})))
const difference = computed(() => {
  const value = stats.value?.returnDifference
  if (!Number.isFinite(value)) return ''
  return Math.abs(value * 100) < .005 ? '两者累计收益差异小于 0.01 个百分点。'
    : `红利低波${value >= 0 ? '领先' : '落后'}沪深300 ${Math.abs(value * 100).toFixed(2)} 个百分点。`
})
function choose(key) {
  const previousStart = stats.value?.startDate
  range.value = key
  if (key === 'custom' && !customStart.value) {
    customStart.value = previousStart ?? ''
    customEnd.value = [pair.value?.index.latest.date, pair.value?.benchmark.latest.date].filter(Boolean).sort()[0] ?? ''
  }
}
function applyCustom() { custom.value = { start: customStart.value, end: customEnd.value } }
function refresh() { return dashboard.refresh(['H30269', '000300', 'collection']) }
defineExpose({ loading })
dashboard.ensure('H30269'); dashboard.ensure('000300'); dashboard.ensure('collection')
</script>

<template>
  <section class="comparison-analysis panel" aria-label="红利低波与沪深300收益风险对比" :aria-busy="loading">
    <div class="comparison-heading"><h2>收益与风险对比</h2><span>红利低波 H30269 / 沪深300 000300</span><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取对比' }}</button></div>
    <p class="comparison-note">两只价格指数，不含分红再投资。{{ props.instrument === '512890' ? '红利低波为 ETF 标的指数，不代表 512890 实际持有收益。' : '' }}</p>
    <div class="comparison-ranges" role="group" aria-label="收益风险比较区间"><button v-for="item in COMPARISON_RANGES" :key="item.key" type="button" :aria-pressed="range === item.key" @click="choose(item.key)">{{ item.label }}</button></div>
    <form v-if="range === 'custom'" class="comparison-custom" @submit.prevent="applyCustom">
      <label>开始日期<input v-model="customStart" type="date" required /></label><label>结束日期<input v-model="customEnd" type="date" required /></label><button type="submit">应用区间</button>
    </form>
    <p v-if="readError" class="comparison-warning" role="status">行情读取失败：{{ readError }}。{{ pair ? '保留上次对比输入及原日期；本次成功读取的一侧暂不替换对比。' : '暂无可用对比数据。' }}</p>
    <p v-else-if="loading" class="comparison-note" role="status">{{ pair ? '正在读取两只指数，暂显示上次对比。' : '正在读取两只指数…' }}</p>
    <p v-else-if="!pair" class="comparison-note">暂无可用对比行情。</p>
    <p v-if="result.error" class="comparison-warning" role="status">暂不能计算：{{ result.error }}</p>
    <div class="comparison-sources">
      <p v-for="source in sources" :key="source.code" class="comparison-note" :class="{ 'comparison-warning': source.notice.warning || source.freshness.level === 'old' }">{{ source.name }}行情日期：{{ source.data?.latest.date ?? '暂无' }} · {{ source.notice.text }}{{ source.freshness.text ? ` · ${source.freshness.text}` : '' }}</p>
    </div>
    <template v-if="stats">
      <p class="comparison-note">实际计算区间：{{ stats.startDate }} — {{ stats.endDate }} · {{ stats.count }} 个收盘样本 · 共同最新日期 {{ stats.commonEnd }}。{{ stats.series.some(item => !item.backfillCompleted) ? '历史仍在补充；全部共同历史不代表成立以来。' : '' }}</p>
      <p class="comparison-difference">{{ difference }}</p>
      <div class="comparison-table-wrap"><table class="comparison-table"><caption>所选区间收益与风险</caption><thead><tr><th scope="col">指标</th><th scope="col">红利低波</th><th scope="col">沪深300</th></tr></thead><tbody>
        <tr v-for="metric in [{ key: 'cumulativeReturn', label: '累计价格收益' }, { key: 'maxDrawdown', label: '最大回撤（跌幅）' }, { key: 'annualizedVolatility', label: '年化波动率' }]" :key="metric.key"><th scope="row">{{ metric.label }}</th><td v-for="series in stats.series" :key="series.code">{{ comparisonPercent(series[metric.key]) }}</td></tr>
      </tbody></table></div>
      <IndexComparisonTrend :stats="stats" :selection="selection" />
      <p class="comparison-note">三个图表共用日期及缩放范围；滑块／拖动只改变查看范围，切换计算区间才重算摘要。60日波动率使用区间之前已核验历史预热，不足61个连续收盘样本时留空；区间年化波动率不足两个日收益样本时显示“—”。</p>
    </template>
    <details class="comparison-method"><summary>计算口径与数据来源</summary>
      <p>累计收益 = 当日收盘 ÷ 区间起始收盘 − 1；回撤 = 当日收盘 ÷ 区间内此前最高收盘 − 1。最大回撤摘要以正数表示跌幅。</p>
      <p>日收益采用相邻交易日简单收益率；年化波动率 = 日收益样本标准差 × √252。滚动波动率固定使用60个日收益，不缩短窗口。</p>
      <p>近1年／近3年以共同截止日向前对应日期或此前最近交易日为基准；年初至今以上年最后交易日为基准。自定义开始日顺延、结束日回退至交易日，并显示实际日期。缺基准、缺交易日或日历未覆盖时不生成完整比较。</p>
      <p>两只日线由东方财富采集并保存为站点静态快照；重新读取不触发上游采集。此处重新计算所选区间，与上方已保存的全部历史指标范围及日期可能不同。</p>
      <p><a href="https://quote.eastmoney.com/zz/2.H30269.html" target="_blank" rel="noopener noreferrer">红利低波行情</a> · <a href="https://quote.eastmoney.com/zs000300.html" target="_blank" rel="noopener noreferrer">沪深300行情</a></p>
    </details>
  </section>
</template>

<style scoped>
.comparison-analysis { min-width: 0; padding: 18px 20px; }
.comparison-heading { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.comparison-heading h2 { font-size: 15px; }
.comparison-heading span { flex: 1; color: #93a4bf; font-size: 11px; }
.comparison-heading button, .comparison-ranges button, .comparison-custom button { padding: 6px 10px; border: 1px solid #33435b; border-radius: 6px; color: #c7d8f2; background: #111d30; font-size: 11px; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.comparison-note, .comparison-method { margin-top: 8px; color: #93a4bf; font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
.comparison-warning { margin-top: 8px; color: #d5b57f; font-size: 11px; line-height: 1.8; }
.comparison-ranges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.comparison-ranges button[aria-pressed="true"] { border-color: #67d5df; color: #89e3e9; background: #14313c; }
.comparison-custom { display: flex; align-items: end; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.comparison-custom label { display: grid; gap: 5px; color: #93a4bf; font-size: 11px; }
.comparison-custom input { min-width: 0; max-width: 100%; padding: 6px; color: #c7d8f2; background: #111d30; border: 1px solid #33435b; border-radius: 6px; color-scheme: dark; }
.comparison-difference { margin: 14px 0; color: #c7d8f2; font-size: 13px; }
.comparison-table-wrap { min-width: 0; }
.comparison-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.comparison-table caption { text-align: left; padding-bottom: 8px; color: #93a4bf; font-size: 11px; }
.comparison-table th, .comparison-table td { padding: 10px 6px; text-align: right; border-bottom: 1px solid #223049; overflow-wrap: anywhere; }
.comparison-table th:first-child { text-align: left; width: 42%; }
.comparison-table th { color: #93a4bf; font-weight: 500; }
.comparison-table td { font-family: var(--font-mono); color: #e1e8f3; }
.comparison-method { padding-top: 10px; border-top: 1px solid #223049; }
.comparison-method summary { cursor: pointer; }
.comparison-method p { margin-top: 6px; }
.comparison-method a { color: #9bc5ff; text-decoration: underline; }
@media (max-width: 700px) { .comparison-analysis { padding: 15px 12px; } .comparison-heading span { flex-basis: 100%; order: 3; } .comparison-heading button { margin-left: auto; } .comparison-table { font-size: 11px; } }
</style>
