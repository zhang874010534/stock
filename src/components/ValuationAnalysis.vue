<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { getValuationHistory, VALUATION_SOURCE } from '../api/valuations.js'
import { valuationStats, VALUATION_RANGES } from '../utils/valuationStats.js'
import ValuationTrend from './ValuationTrend.vue'

const props = defineProps({ instrument: { type: String, default: 'H30269' } })
const data = ref(null), loading = ref(false), error = ref('')
const metric = ref('pe'), range = ref('1y'), expanded = ref(false), dialog = ref(null), expandButton = ref(null)
const stats = computed(() => valuationStats(data.value?.history ?? [], metric.value, range.value))
const title = computed(() => props.instrument === '512890' ? '标的指数估值分析' : '估值分析')
const format = value => value == null ? '—' : value.toFixed(2)
let disposed = false
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try { const result = await getValuationHistory(); if (!disposed) data.value = result }
  catch (cause) { if (!disposed) error.value = `${cause.message}${data.value ? '，保留上次数据' : ''}` }
  finally { if (!disposed) loading.value = false }
}
async function open() {
  expanded.value = true
  await nextTick()
  if (!disposed) dialog.value.showModal()
}
function close() { dialog.value.close() }
function closed() { expanded.value = false; expandButton.value?.focus({ preventScroll: true }) }
onMounted(load)
onBeforeUnmount(() => { disposed = true; dialog.value?.close() })
</script>

<template>
  <section class="valuation-analysis" aria-label="估值分析" :aria-busy="loading">
    <header><h3>{{ title }}</h3><button ref="expandButton" type="button" @click="open">放大 ↗</button></header>
    <dialog ref="dialog" aria-label="估值分析放大图" @close="closed" @cancel.stop @click="event => { if (event.target === dialog) close() }">
      <div v-if="expanded" class="modal-content">
        <header><h3>{{ title }} · H30269</h3><button autofocus type="button" @click="close">关闭 ✕</button></header>
        <div class="controls">
          <div role="group" aria-label="放大图估值指标"><button v-for="(label, key) in { pe: '市盈率', pb: '市净率' }" :key="key" :aria-pressed="metric === key" @click="metric = key">{{ label }}</button></div>
          <select v-model="range" aria-label="放大图统计范围"><option v-for="(label, key) in VALUATION_RANGES" :key="key" :value="key">{{ label }}</option></select>
        </div>
        <p class="current">{{ metric.toUpperCase() }} {{ format(stats.latest?.value) }} 倍 <span>历史分位 {{ format(stats.rank) }}%</span></p>
        <div class="levels"><span>70%分位值 {{ format(stats.high) }}</span><span>30%分位值 {{ format(stats.low) }}</span></div>
        <p v-if="error" class="notice" role="status">{{ error }} <button :disabled="loading" @click="load">重试</button></p>
        <ValuationTrend v-if="stats.count" :stats="stats" :metric="metric" expanded />
        <p v-else class="empty">{{ loading ? '正在读取估值历史…' : '暂无可用估值历史' }}</p>
        <p class="caption">实际样本：{{ stats.points[0]?.date ?? '—' }} — {{ stats.latest?.date ?? '—' }} · {{ stats.count }} 个交易日样本</p>
        <p v-if="stats.partial" class="notice">历史不足所选范围，当前仅展示已积累的数据。</p>
        <p v-if="stats.count < 20" class="notice">有效样本不足 20 个，暂不计算历史分位及分位线。</p>
        <div class="methodology">
          <p>分位统计以所选范围内的有效交易日等权计算，30% / 70% 分位值采用线性插值。历史分位 =（小于当前值的样本数 + 等于当前值的样本数 × 0.5）÷ 样本数 × 100%。</p>
          <p>底部滑块只缩放图表，不改变统计范围；与左侧 K 线独立。历史分位不代表上涨概率。</p>
          <p>H30269 指数估值，非 ETF 自身估值。来源尚未明确财报周期及聚合口径，因此不标为 TTM / MRQ。不同来源数据不拼接。</p>
          <p><a :href="VALUATION_SOURCE" target="_blank" rel="noopener noreferrer">数据来源：东方财富 / 天天基金</a> · 截至 {{ data?.date ?? '—' }}</p>
          <p v-if="data?.collection === 'daily_snapshots'">当前由已保存的真实每日快照积累，完整历史回补尚未接入。</p>
        </div>
      </div>
    </dialog>
    <div class="controls">
      <div role="group" aria-label="估值指标"><button v-for="(label, key) in { pe: '市盈率', pb: '市净率' }" :key="key" :aria-pressed="metric === key" @click="metric = key">{{ label }}</button></div>
      <select v-model="range" aria-label="估值统计范围"><option v-for="(label, key) in VALUATION_RANGES" :key="key" :value="key">{{ label }}</option></select>
    </div>
    <p class="current">{{ metric.toUpperCase() }} {{ format(stats.latest?.value) }} 倍 <span>历史分位 {{ format(stats.rank) }}%</span></p>
    <div class="levels"><span>70%分位值 {{ format(stats.high) }}</span><span>30%分位值 {{ format(stats.low) }}</span></div>
    <p v-if="error" class="notice" role="status">{{ error }} <button :disabled="loading" @click="load">重试</button></p>
    <ValuationTrend v-if="stats.count" :stats="stats" :metric="metric" />
    <p v-else class="empty">{{ loading ? '正在读取估值历史…' : '暂无可用估值历史' }}</p>
    <p class="caption">{{ stats.points[0]?.date ?? '—' }} — {{ stats.latest?.date ?? '—' }} · {{ stats.count }} 个样本</p>
    <p v-if="stats.partial" class="notice">历史不足所选范围，仅展示实际样本。</p>
    <p v-if="stats.count < 20" class="notice">样本不足 20 个，暂不计算分位。</p>
    <p class="caption">H30269 · 东方财富口径 · 每日快照积累<span v-if="instrument === '512890'"> · 非 ETF 自身估值</span></p>
  </section>
</template>

<style scoped>
.valuation-analysis { min-width: 0; padding: 16px 0; border-bottom: 1px solid #30333e; }
header, .controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h3 { margin: 0; color: #dfe5f1; font-size: 14px; }
button, select { color: #b8c7dd; border: 1px solid #383d49; background: #20232c; border-radius: 4px; font: inherit; font-size: 11px; padding: 5px 7px; cursor: pointer; }
button:disabled { opacity: .5; }
button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
button[aria-pressed=true] { background: #193741; color: #67d5df; border-color: #386779; }
.controls { margin: 14px 0 10px; }
.controls > div { display: flex; gap: 5px; }
.current { color: #709bff; font-size: 13px; line-height: 1.8; font-variant-numeric: tabular-nums; }
.current span { margin-left: 8px; color: #bfc5d2; font-size: 11px; }
.levels { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; line-height: 1.8; }
.levels span:first-child { color: #ef697c; }
.levels span:last-child { color: #34c79a; }
.caption, .methodology { font-size: 11px; color: #959baa; line-height: 1.8; }
.notice { font-size: 11px; color: #dab57b; line-height: 1.8; }
.empty { padding: 65px 0; text-align: center; color: #959baa; font-size: 12px; }
dialog { margin: auto; padding: 0; width: min(90vw, 1250px); max-width: 95vw; max-height: 90dvh; overflow: auto; border: 1px solid #383d49; border-radius: 10px; background: #101116; color: #dfe5f1; overscroll-behavior: contain; }
dialog::backdrop { background: #000a; }
.modal-content { padding: 22px; }
.methodology { border-top: 1px solid #30333e; margin-top: 12px; padding-top: 10px; }
a { color: #8ba8cd; }
@media (max-width: 600px) { dialog { width: 96vw; max-width: 96vw; max-height: 95dvh; } .modal-content { padding: 14px; } }
</style>
