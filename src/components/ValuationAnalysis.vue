<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { getValuationHistory, VALUATION_SOURCE } from '../api/valuations.js'
import { getCsiValuationHistory, getCsiValuationStatus, csiChartHistory, CSI_VALUATION_SOURCE } from '../api/csiValuations.js'
import { valuationStats, VALUATION_RANGES } from '../utils/valuationStats.js'
import ValuationAnalysisContent from './ValuationAnalysisContent.vue'

const props = defineProps({ instrument: { type: String, default: 'H30269' }, summary: Boolean, collectionNotice: String, collectionWarning: Boolean })
const source = ref(props.summary ? 'eastmoney' : 'csi'), basis = ref('total'), expanded = ref(false), dialog = ref(null), expandButton = ref(null)
const states = reactive(Object.fromEntries(['csi', 'eastmoney'].map(key => [key, { data: null, loading: false, error: '', status: null, statusNotice: '', metric: 'pe', range: 'all' }])))
const current = computed(() => states[source.value])
const metric = computed({ get: () => source.value === 'csi' ? 'pe' : current.value.metric, set: v => { current.value.metric = v } })
const range = computed({ get: () => current.value.range, set: v => { current.value.range = v } })
const history = computed(() => source.value === 'csi' ? csiChartHistory(current.value.data, basis.value) : current.value.data?.history ?? [])
const stats = computed(() => valuationStats(history.value, metric.value, range.value))
const summaryStats = computed(() => ['pe', 'pb'].map(key => ({ key, ...valuationStats(states.eastmoney.data?.history ?? [], key, states.eastmoney.range) })))
const format = value => value == null ? '—' : value.toFixed(2)
const title = computed(() => props.instrument === '512890' ? '标的指数估值分析' : '估值分析')
const lastSuccess = computed(() => {
  const date = current.value.status?.lastSuccessAt
  return date ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : ''
})
const view = computed(() => ({ stats: stats.value, data: current.value.data, loading: current.value.loading, error: current.value.error,
  statusNotice: current.value.statusNotice, lastSuccess: lastSuccess.value, instrument: props.instrument,
  sourceUrl: source.value === 'csi' ? CSI_VALUATION_SOURCE : VALUATION_SOURCE }))
let disposed = false
let returnFocus = null
async function loadSource(key) {
  const state = states[key]
  if (state.loading) return
  state.loading = true
  state.error = ''
  const results = await Promise.allSettled(key === 'csi' ? [getCsiValuationHistory(), getCsiValuationStatus()] : [getValuationHistory()])
  if (disposed) return
  if (results[0].status === 'fulfilled') state.data = results[0].value
  else state.error = `${results[0].reason.message}${state.data ? '，保留上次数据' : ''}`
  if (key === 'csi') {
    if (results[1].status === 'fulfilled') {
      state.status = results[1].value
      state.statusNotice = state.status.status === 'error' ? '中证定时更新失败，当前显示上次成功保存的数据。' : ''
    } else state.statusNotice = '无法确认中证定时更新状态；最后成功时间仅为上次已知记录。'
  }
  state.loading = false
}
function load() { return loadSource(source.value) }
function refresh() { return Promise.all([...new Set([source.value, ...(props.summary ? ['eastmoney'] : [])])].map(loadSource)) }
defineExpose({ refresh, loading: computed(() => Object.values(states).some(state => state.loading)), error: computed(() => Boolean(states.eastmoney.error || current.value.error)) })
async function open(event, selectedMetric) {
  if (props.summary) { source.value = 'eastmoney'; if (selectedMetric) states.eastmoney.metric = selectedMetric }
  returnFocus = event?.currentTarget ?? expandButton.value
  expanded.value = true; await nextTick(); if (!disposed) dialog.value.showModal()
}
function closed() { expanded.value = false; returnFocus?.focus({ preventScroll: true }) }
watch(source, load, { immediate: true })
onBeforeUnmount(() => { disposed = true; dialog.value?.close() })
</script>

<template>
  <section class="valuation-analysis" :class="{ 'summary-panel panel': summary }" aria-label="估值分析" :aria-busy="summary ? states.eastmoney.loading : current.loading">
    <header><h3>{{ title }}</h3><button ref="expandButton" type="button" @click="open">{{ summary ? '查看完整分析 ↗' : '放大 ↗' }}</button></header>
    <template v-if="summary">
      <div class="summary-toolbar"><p>H30269 · 东方财富口径 · 与上方 PE/PB 来源一致</p><label>统计范围 <select v-model="states.eastmoney.range" aria-label="首页估值统计范围"><option v-for="(label, key) in VALUATION_RANGES" :key="key" :value="key">{{ label }}</option></select></label></div>
      <p v-if="instrument === '512890'" class="summary-caption">以下为跟踪指数估值，非 ETF 自身估值。</p>
      <p v-if="collectionNotice" class="summary-caption" :class="{ 'summary-notice': collectionWarning }">{{ collectionNotice }}</p>
      <p v-if="states.eastmoney.loading" class="summary-caption" role="status">正在读取估值历史…</p>
      <p v-if="states.eastmoney.error" class="summary-notice" role="status">{{ states.eastmoney.error }} <button :disabled="states.eastmoney.loading" @click="loadSource('eastmoney')">重新读取</button></p>
      <div class="summary-grid">
        <article v-for="item in summaryStats" :key="item.key" class="summary-metric">
          <div class="summary-heading"><h4>{{ item.key.toUpperCase() }} · {{ item.key === 'pe' ? '市盈率' : '市净率' }}</h4><button :aria-label="`查看 ${item.key.toUpperCase()} 估值详情`" @click="open($event, item.key)">详情 →</button></div>
          <div class="summary-values"><p><span>历史最新值</span><strong>{{ format(item.latest?.value) }}<small> 倍</small></strong></p><p><span>{{ states.eastmoney.range === 'all' || item.partial ? '已积累区间分位' : '所选区间分位' }}</span><strong>{{ item.rank == null ? '—' : `${format(item.rank)}%` }}</strong></p></div>
          <div v-if="item.rank != null" class="rank-track" role="meter" :aria-label="`${item.key.toUpperCase()} 历史分位`" :aria-valuenow="item.rank" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${item.rank}%` }" /></div>
          <p class="summary-caption">实际样本：{{ item.points[0]?.date ?? '—' }} — {{ item.latest?.date ?? '—' }} · {{ item.count }} 个交易日</p>
          <p v-if="!states.eastmoney.loading && !item.count" class="summary-notice">暂无可用估值历史。</p>
          <p v-else-if="!states.eastmoney.loading && item.count < 20" class="summary-notice">样本不足 20 个，暂不计算分位。</p>
          <p v-if="item.partial" class="summary-notice">历史不足所选范围，仅统计已积累样本。</p>
        </article>
      </div>
      <p class="summary-caption summary-footer">历史积累中，不代表完整历史。分位不代表上涨概率。<a :href="VALUATION_SOURCE" target="_blank" rel="noopener noreferrer">查看数据来源 ↗</a></p>
    </template>
    <ValuationAnalysisContent v-else v-model:source="source" v-model:basis="basis" v-model:metric="metric" v-model:range="range" v-bind="view" @retry="load" />
    <dialog ref="dialog" aria-label="估值分析放大图" @close="closed" @cancel.stop @click="event => { if (event.target === dialog) dialog.close() }">
      <div v-if="expanded" class="modal-content">
        <header><h3>{{ title }} · H30269</h3><button autofocus type="button" @click="dialog.close()">关闭 ✕</button></header>
        <ValuationAnalysisContent v-model:source="source" v-model:basis="basis" v-model:metric="metric" v-model:range="range" v-bind="view" expanded @retry="load" />
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.valuation-analysis { min-width: 0; padding: 16px 0; border-bottom: 1px solid #30333e; }
.summary-panel { padding: 18px 20px; }
.summary-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin: 12px 0 6px; color: #98abc7; font-size: 11px; }
.summary-toolbar select { padding: 5px; color: #b8c7dd; border: 1px solid #383d49; background: #20232c; border-radius: 4px; font: inherit; }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 12px; }
.summary-metric { min-width: 0; padding: 14px; border: 1px solid #24334b; border-radius: 8px; }
.summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.summary-heading h4 { margin: 0; font-size: 12px; color: #c3d0e3; font-weight: 500; }
.summary-values { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
.summary-values span { display: block; color: #95a7c1; font-size: 11px; }
.summary-values strong { display: block; margin-top: 6px; color: #c3d7fa; font: 600 25px var(--font-mono); }
.summary-values small { font: 12px var(--font-sans); color: #98abc7; }
.summary-caption, .summary-notice { font-size: 11px; line-height: 1.8; color: #95a7c1; }
.summary-notice { color: #dab57b; }
.summary-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; margin-top: 12px; }
.summary-footer a { color: #9bc5ff; }
.rank-track { height: 5px; background: #25334b; border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
.rank-track span { display: block; height: 100%; background: #739ce5; }
@media (max-width: 640px) { .summary-panel { padding: 16px 14px; } .summary-grid { grid-template-columns: minmax(0, 1fr); } }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h3 { margin: 0; color: #dfe5f1; font-size: 14px; }
button { color: #b8c7dd; border: 1px solid #383d49; background: #20232c; border-radius: 4px; font: inherit; font-size: 11px; padding: 5px 7px; cursor: pointer; }
button:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
dialog { margin: auto; padding: 0; width: min(90vw, 1250px); max-width: 95vw; max-height: 90dvh; overflow: auto; border: 1px solid #383d49; border-radius: 10px; background: #101116; color: #dfe5f1; overscroll-behavior: contain; }
dialog::backdrop { background: #000a; }
.modal-content { padding: 22px; }
@media (max-width: 600px) { dialog { width: 96vw; max-width: 96vw; max-height: 95dvh; } .modal-content { padding: 14px; } }
</style>
