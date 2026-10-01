<script setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { analyzeYieldSpread, formatSpread, mergeYieldHistory, YIELD_SERIES } from '../utils/yieldSpread.js'
import { collectionNotice, dataFreshness } from '../utils/sourceStatus.js'
const YieldSpreadCharts = defineAsyncComponent(() => import('./YieldSpreadCharts.vue'))
const props = defineProps({ instrument: { type: String, default: '512890' } })
const dashboard = useDashboardData()
const keys = ['dividend', 'treasury', 'yieldHistory']
const states = dashboard.states
const committed = ref(null), inputError = ref(''), start = ref(''), end = ref('')
const loading = computed(() => keys.some(key => states[key].loading))
const errors = computed(() => keys.filter(key => states[key].error).map(key => `${{ dividend: '股息率', treasury: '国债收益率', yieldHistory: '收益率历史' }[key]}：${states[key].error}`))
watch(() => keys.map(key => [states[key].data, states[key].loading, states[key].error]), () => {
  if (loading.value || keys.some(key => !states[key].attempted || !states[key].data) || errors.value.length) return
  try {
    for (const kind of ['dividend', 'treasury']) {
      const last = states.yieldHistory.data.series?.[kind]?.history?.at(-1)
      if (last && states[kind].data.date < last.date) throw new Error('收益率快照落后于历史文件，请重新读取整组数据')
    }
    committed.value = mergeYieldHistory(states.yieldHistory.data, { dividend: states.dividend.data, treasury: states.treasury.data })
    inputError.value = ''
  } catch (error) { inputError.value = error.message }
}, { immediate: true, flush: 'post' })
const full = computed(() => committed.value ? analyzeYieldSpread(committed.value) : null)
const rangeError = computed(() => start.value && end.value && start.value > end.value ? '开始日期不能晚于结束日期' : '')
const selected = computed(() => committed.value && !rangeError.value ? analyzeYieldSpread(committed.value, { start: start.value, end: end.value }) : null)
const hasWarning = computed(() => Boolean(errors.value.length || inputError.value || notices.value.some(item => item.warning)))
const notices = computed(() => ['dividend', 'treasury', 'yieldHistory'].map(kind => {
  const date = kind === 'yieldHistory' ? full.value?.latest?.date : full.value?.[kind === 'dividend' ? 'latestDividend' : 'latestTreasury']?.date
  const notice = collectionNotice(states.collection.data?.sources[kind === 'treasury' ? 'bond' : kind], { unavailable: Boolean(states.collection.error), hasData: Boolean(committed.value) })
  const freshness = dataFreshness(date, { now: dashboard.checkedAt.value, kind: 'indicator' })
  return { kind, label: { dividend: '股息率', treasury: '国债收益率', yieldHistory: '收益率历史' }[kind], text: notice.text, warning: notice.warning || freshness.level === 'old', freshness: freshness.text }
}))
const currentMismatch = computed(() => full.value && full.value.latestDividend?.date !== full.value.latestTreasury?.date)
const yieldValue = (point, digits) => point ? `${point.value.toFixed(digits)}%` : '—'
function refresh() { return dashboard.refresh(keys) }
function resetRange() { start.value = ''; end.value = '' }
for (const key of [...keys, 'collection']) dashboard.ensure(key)
defineExpose({ loading, hasWarning, refresh })
</script>
<template>
  <section class="yield-spread panel" aria-label="股息率与国债收益率差值" :aria-busy="loading">
    <header class="spread-heading"><div><h2>股息率与国债收益率差值</h2><p>{{ instrument === '512890' ? 'ETF 标的指数 H30269' : 'H30269 指数' }} · 总股本口径股息率 − 中债十年期国债到期收益率</p></div><button :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取差值' }}</button></header>
    <p class="spread-note">正值表示指数股息率高于国债收益率，负值表示低于；两者口径与风险不同，差值不是投资回报或买卖信号。指数股息率不代表 ETF 实际现金分红收益率。</p>
    <p v-if="errors.length || inputError" class="spread-warning" role="status">读取失败{{ committed ? '，保留整组上次数据与原日期' : '，暂无可计算数据' }}：{{ [...errors, inputError].filter(Boolean).join('；') }}</p>
    <p v-if="!committed && !errors.length && !inputError" class="spread-note">{{ loading ? '正在读取两项收益率与历史记录…' : '暂无可计算数据' }}</p>
    <template v-if="full">
      <div class="spread-summary">
        <article><span>最近同日差值</span><strong>{{ formatSpread(full.latest?.spread, { signed: true }) }}</strong><small>{{ full.latest ? `数据日期：${full.latest.date}` : '暂无同日样本' }}</small></article>
        <article><span>较上一同日样本变化</span><strong>{{ formatSpread(full.change, { signed: true }) }}</strong><small>{{ full.previous ? `${full.previous.date} → ${full.latest.date} · 不一定相邻交易日` : '至少需要两个同日样本' }}</small></article>
        <article><span>最新指数股息率</span><strong>{{ yieldValue(full.latestDividend, 2) }}</strong><small>{{ full.latestDividend?.date || '暂无数据' }} · <a :href="YIELD_SERIES.dividend.source" target="_blank" rel="noopener noreferrer">中证 D/P1</a></small></article>
        <article><span>最新十年期国债收益率</span><strong>{{ yieldValue(full.latestTreasury, 4) }}</strong><small>{{ full.latestTreasury?.date || '暂无数据' }} · <a :href="YIELD_SERIES.treasury.source" target="_blank" rel="noopener noreferrer">中债</a></small></article>
      </div>
      <p v-if="currentMismatch" class="spread-warning" role="status">最新两项日期不一致，不相减；最近同日差值仅截至 {{ full.latest?.date || '暂无匹配日期' }}。</p>
      <p v-if="full.latest" class="spread-note">同日计算：{{ full.latest.dividend.toFixed(2) }}% − {{ full.latest.treasury.toFixed(4) }}% = {{ formatSpread(full.latest.spread) }}。1 个百分点 = 100 个基点。</p>
      <div class="spread-sources"><p v-for="notice in notices" :key="notice.kind" :class="{ 'spread-warning': notice.warning }">{{ notice.label }}：{{ notice.text }}{{ notice.freshness ? `；${notice.freshness}` : '' }}</p></div>
      <div class="spread-controls"><label>开始日期<input v-model="start" type="date" aria-label="差值开始日期" /></label><label>结束日期<input v-model="end" type="date" aria-label="差值结束日期" /></label><button @click="resetRange">全部记录</button></div>
      <p v-if="rangeError" class="spread-warning" role="status">{{ rangeError }}</p>
      <template v-if="selected">
        <p class="spread-note">所选记录：{{ selected.points[0]?.date || '—' }} — {{ selected.points.at(-1)?.date || '—' }} · {{ selected.count }} 个同日样本 · {{ selected.unpairedCount }} 个日期缺少一项。只展示已保存观察，不代表连续交易日历史。</p>
        <div v-if="selected.count" class="spread-statistics"><span>区间平均差值 <b>{{ formatSpread(selected.mean) }}</b></span><span>最低 <b>{{ formatSpread(selected.min.spread) }}</b>（{{ selected.min.date }}）</span><span>最高 <b>{{ formatSpread(selected.max.spread) }}</b>（{{ selected.max.date }}）</span></div>
        <YieldSpreadCharts v-if="selected.points.length" :analysis="selected" />
        <p v-else class="spread-note">所选区间暂无已保存记录。</p>
        <p v-if="!selected.count && selected.points.length" class="spread-warning">所选区间没有同日样本，差值与统计显示“—”。</p>
        <details class="spread-details"><summary>查看所选区间数据（{{ selected.points.length }} 个日期）</summary><div class="spread-table"><table><thead><tr><th>数据日期</th><th>指数股息率</th><th>国债收益率</th><th>差值（百分点）</th><th>较前次同日变化</th></tr></thead><tbody><tr v-for="point in selected.points" :key="point.date"><td>{{ point.date }}</td><td>{{ point.dividend === null ? '—' : point.dividend.toFixed(2) + '%' }}</td><td>{{ point.treasury === null ? '—' : point.treasury.toFixed(4) + '%' }}</td><td>{{ formatSpread(point.spread, { signed: true }) }}</td><td>{{ point.spread === null || selected.paired.indexOf(point) < 1 ? '—' : formatSpread(point.spread - selected.paired[selected.paired.indexOf(point) - 1].spread, { signed: true }) }}</td></tr></tbody></table></div></details>
      </template>
      <details class="spread-details"><summary>差值口径与历史记录说明</summary><p>原始值为百分数，例如 4.39 表示 4.39%。差值直接相减，单位为百分点，不是百分比涨跌。两项必须数据日期相同；不前向填充、不插值，也不使用采集时间对齐。已保存日期缺少任一项时保留断点；未保存的日期不推算。</p><p>历史从 Git 实际提交的原始快照建立，再由指标采集持续积累；同日修订替换该日期的观察，不新增重复样本。区间均值按同日观察等权，极值并列取最早日期。摘要最近差值及变化始终使用全部记录；日期筛选只影响图表、区间统计和明细，缩放只影响图表视窗。</p><p>重新读取只读取站点保存文件。任一文件读取失败，整组分析保留上次成功输入和日期；后台采集失败及数据时效另外标注。本模块不改变夏普比率固定 0% 的无风险利率假设。</p></details>
    </template>
  </section>
</template>
<style scoped>
.yield-spread { padding: 22px; min-width: 0; display: grid; gap: 15px; scroll-margin-top: 80px; }
.spread-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.spread-heading h2 { font-size: 16px; font-weight: 600; }.spread-heading p,.spread-note,.spread-sources,.spread-details { font-size: 12px; color: #91a4c0; line-height: 1.8; }.spread-heading p { margin-top: 6px; }
button { border: 1px solid #304b72; border-radius: 6px; background: #12243d; color: #b9d1f5; padding: 7px 11px; font-size: 12px; cursor: pointer; }button:disabled { opacity: .5; cursor: wait; }
.spread-summary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }.spread-summary article { display: grid; gap: 8px; padding: 15px; background: #0c192b; border: 1px solid #233650; border-radius: 8px; min-width: 0; }.spread-summary span { color: #a2b3cc; font-size: 12px; }.spread-summary strong { font-family: var(--font-mono); font-size: clamp(16px,1.5vw,22px); color: #76d9c0; word-break: keep-all; }.spread-summary small { color: #8199bb; font-size: 11px; line-height: 1.7; }a { color: #83b9ff; }
.spread-warning { color: #e4b977; font-size: 12px; line-height: 1.8; }.spread-controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }.spread-controls label { display: grid; gap: 6px; font-size: 11px; color: #98acc8; }input { min-width: 0; background: #0a1729; color: #c7d6eb; border: 1px solid #304b72; border-radius: 5px; padding: 6px; color-scheme: dark; }.spread-statistics { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 12px; color: #8da4c5; }.spread-statistics b { color: #c6d8ec; font-weight: 500; }
.spread-details { min-width: 0; }.spread-details summary { cursor: pointer; color: #a5c0e7; }.spread-details p { margin-top: 8px; }.spread-table { min-width: 0; overflow-x: auto; margin-top: 12px; }table { width: 100%; min-width: 650px; border-collapse: collapse; font-size: 11px; }th,td { padding: 9px; border-bottom: 1px solid #23344c; text-align: left; white-space: nowrap; }th { color: #b9cde8; font-weight: 500; }
@media(max-width:1200px) { .spread-summary { grid-template-columns: repeat(2,minmax(0,1fr)); } }@media(max-width:600px) { .yield-spread { padding: 16px; }.spread-heading { flex-wrap: wrap; }.spread-summary article { padding: 12px; }.spread-summary strong { font-size: 16px; }.spread-controls label { flex: 1; min-width: 120px; } }
</style>
