<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { getValuationHistory, VALUATION_SOURCE } from '../api/valuations.js'
import { getCsiValuationHistory, getCsiValuationStatus, csiChartHistory, CSI_VALUATION_SOURCE } from '../api/csiValuations.js'
import { valuationStats } from '../utils/valuationStats.js'
import ValuationAnalysisContent from './ValuationAnalysisContent.vue'

const props = defineProps({ instrument: { type: String, default: 'H30269' } })
const source = ref('csi'), basis = ref('total'), expanded = ref(false), dialog = ref(null), expandButton = ref(null)
const states = reactive(Object.fromEntries(['csi', 'eastmoney'].map(key => [key, { data: null, loading: false, error: '', status: null, statusNotice: '', metric: 'pe', range: 'all' }])))
const current = computed(() => states[source.value])
const metric = computed({ get: () => source.value === 'csi' ? 'pe' : current.value.metric, set: v => { current.value.metric = v } })
const range = computed({ get: () => current.value.range, set: v => { current.value.range = v } })
const history = computed(() => source.value === 'csi' ? csiChartHistory(current.value.data, basis.value) : current.value.data?.history ?? [])
const stats = computed(() => valuationStats(history.value, metric.value, range.value))
const title = computed(() => props.instrument === '512890' ? '标的指数估值分析' : '估值分析')
const lastSuccess = computed(() => {
  const date = current.value.status?.lastSuccessAt
  return date ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : ''
})
const view = computed(() => ({ stats: stats.value, data: current.value.data, loading: current.value.loading, error: current.value.error,
  statusNotice: current.value.statusNotice, lastSuccess: lastSuccess.value, instrument: props.instrument,
  sourceUrl: source.value === 'csi' ? CSI_VALUATION_SOURCE : VALUATION_SOURCE }))
let disposed = false
async function load() {
  const key = source.value, state = states[key]
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
async function open() { expanded.value = true; await nextTick(); if (!disposed) dialog.value.showModal() }
function closed() { expanded.value = false; expandButton.value?.focus({ preventScroll: true }) }
watch(source, load, { immediate: true })
onBeforeUnmount(() => { disposed = true; dialog.value?.close() })
</script>

<template>
  <section class="valuation-analysis" aria-label="估值分析" :aria-busy="current.loading">
    <header><h3>{{ title }}</h3><button ref="expandButton" type="button" @click="open">放大 ↗</button></header>
    <ValuationAnalysisContent v-model:source="source" v-model:basis="basis" v-model:metric="metric" v-model:range="range" v-bind="view" @retry="load" />
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
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h3 { margin: 0; color: #dfe5f1; font-size: 14px; }
button { color: #b8c7dd; border: 1px solid #383d49; background: #20232c; border-radius: 4px; font: inherit; font-size: 11px; padding: 5px 7px; cursor: pointer; }
button:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
dialog { margin: auto; padding: 0; width: min(90vw, 1250px); max-width: 95vw; max-height: 90dvh; overflow: auto; border: 1px solid #383d49; border-radius: 10px; background: #101116; color: #dfe5f1; overscroll-behavior: contain; }
dialog::backdrop { background: #000a; }
.modal-content { padding: 22px; }
@media (max-width: 600px) { dialog { width: 96vw; max-width: 96vw; max-height: 95dvh; } .modal-content { padding: 14px; } }
</style>
