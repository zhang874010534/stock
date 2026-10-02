<script setup>
import { computed, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { useObservationNotes } from '../composables/useObservationNotes.js'
import { createReviewSummaries } from '../composables/useReviewSummaries.js'
import { buildReviewSummary, chinaReviewDate, formatReviewMetric, MAX_REFLECTION_LENGTH, MAX_REVIEWS, reviewFilename, reviewMarkdown, reviewPeriod, reviewTitle } from '../utils/reviewSummary.js'
import { createReviewPng } from '../utils/reviewExport.js'
import { downloadBlob } from '../utils/chartExport.js'
import { shiftDay } from '../utils/priceRisk.js'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const dashboard = useDashboardData(), notesStore = useObservationNotes(), history = createReviewSummaries()
const today = ref(chinaReviewDate()), type = ref('week'), week = ref(today.value)
const month = ref(shiftDay(`${today.value.slice(0, 7)}-01`, -1).slice(0, 7))
const reflection = ref(''), draft = ref(null), selectedId = ref(''), message = ref(''), exporting = ref(false)
const keys = computed(() => [props.instrument, 'eastmoneyHistory', 'constituentHistory', 'collection'])
watch(keys, values => { for (const key of values) dashboard.ensure(key) }, { immediate: true })
const loading = computed(() => keys.value.some(key => dashboard.states[key].loading))
const reports = computed(() => history.reviews.value.filter(report => report.instrument === props.instrument))
const activeReport = computed(() => selectedId.value ? reports.value.find(report => report.id === selectedId.value) : draft.value ? { ...draft.value, reflection: reflection.value } : null)
const periodLabel = computed(() => {
  try { const period = reviewPeriod(type.value, type.value === 'week' ? week.value : `${month.value}-01`); return `${period.start} — ${period.end}${period.ongoing ? ' · 周期进行中' : ''}` } catch { return '请选择日期' }
})
const formatTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
function previousPeriod() {
  try {
    const period = reviewPeriod(type.value, type.value === 'week' ? week.value : `${month.value}-01`)
    const previous = shiftDay(period.start, -1)
    if (type.value === 'week') week.value = previous
    else month.value = previous.slice(0, 7)
  } catch (error) { message.value = error.message }
}
function generate() {
  try {
    today.value = chinaReviewDate()
    const warnings = []
    for (const [key, label, source] of [[props.instrument, '行情', props.instrument], ['eastmoneyHistory', '估值历史', 'valuation'], ['constituentHistory', '成分历史', null]]) {
      const state = dashboard.states[key]
      if (state.error) warnings.push(`${label}读取失败${state.data ? '，本摘要使用页面保留数据' : '，相关项目不可用'}`)
      if (source && (dashboard.states.collection.error || dashboard.states.collection.data?.sources?.[source]?.status !== 'ok')) warnings.push(`${label}后台采集失败或状态未知；仅汇总可校验的已保存观察`)
    }
    if (notesStore.hasWarning.value) warnings.push(`个人笔记状态：${notesStore.message.value}`)
    draft.value = buildReviewSummary({ instrument: props.instrument, type: type.value, anchor: type.value === 'week' ? week.value : `${month.value}-01`,
      market: dashboard.states[props.instrument].data, valuationHistory: dashboard.states.eastmoneyHistory.data, constituentHistory: dashboard.states.constituentHistory.data,
      notes: notesStore.notes.value, reflection: reflection.value, warnings })
    selectedId.value = ''; message.value = '摘要已生成；保存后保留当时数据和笔记。'
  } catch (error) { message.value = `生成未完成：${error.message}` }
}
function save() {
  try {
    if (!activeReport.value || activeReport.value.id) return
    const snapshot = history.save(activeReport.value)
    draft.value = snapshot; reflection.value = snapshot.reflection
    message.value = '历史已保存。修改感想或重新生成后可另存一份新版本。'
  } catch (error) { message.value = error.message }
}
function newVersion() {
  if (!activeReport.value) return
  const report = activeReport.value
  draft.value = { ...report, id: null }; reflection.value = report.reflection; selectedId.value = ''; message.value = '可修改感想后另存版本；原历史保持不变。'
}
function removeSelected() {
  if (!activeReport.value?.id) return
  history.remove(activeReport.value.id); selectedId.value = ''; draft.value = null; message.value = '已删除这份历史，可撤销。'
}
function undoRemove() { try { history.undoRemove(); message.value = '历史已恢复。' } catch (error) { message.value = error.message } }
async function exportReport(extension) {
  try {
    if (!activeReport.value || exporting.value) return
    exporting.value = true
    const report = activeReport.value
    const blob = extension === 'md' ? new Blob([reviewMarkdown(report)], { type: 'text/markdown;charset=utf-8' }) : await createReviewPng(report)
    downloadBlob(blob, reviewFilename(report, extension)); message.value = `${extension === 'md' ? 'Markdown' : 'PNG 图片'}已生成，已请求浏览器下载。`
  } catch (error) { message.value = `导出未完成：${error.message}` } finally { exporting.value = false }
}
watch(() => props.instrument, () => { draft.value = null; selectedId.value = ''; reflection.value = ''; message.value = '' })
defineExpose({ generate, activeReport, exportReport })
</script>

<template>
  <section class="review-summary panel" aria-label="每周每月复盘摘要">
    <header class="review-heading"><div><h2>每周／每月复盘摘要</h2><p>{{ instrument }} · 汇总已保存观察与自己的笔记</p></div><button type="button" :disabled="loading" @click="dashboard.refresh(keys)">{{ loading ? '读取中…' : '重新读取复盘数据' }}</button></header>
    <form class="review-controls" aria-label="复盘周期设置" @submit.prevent="generate">
      <label>复盘周期<select v-model="type" aria-label="复盘周期"><option value="week">每周（周一至周日）</option><option value="month">每月（自然月）</option></select></label>
      <label v-if="type === 'week'">选择本周任意一天<input v-model="week" type="date" :max="today" required aria-label="复盘周日期" /></label>
      <label v-else>选择月份<input v-model="month" type="month" :max="today.slice(0, 7)" required aria-label="复盘月份" /></label>
      <div class="review-actions"><button type="button" @click="previousPeriod">上一周期</button><button type="submit" :disabled="loading">生成复盘</button></div>
      <p class="review-note period-label">{{ periodLabel }} · 周末和休市不计交易日，当前周期只使用已收盘数据。</p>
    </form>
    <div class="review-history"><label>历史复盘（{{ reports.length }} / {{ MAX_REVIEWS }}，上限由两只证券共享）<select v-model="selectedId" aria-label="查看已保存复盘"><option value="">当前生成稿</option><option v-for="report in reports" :key="report.id" :value="report.id">{{ report.period.type === 'week' ? '周' : '月' }}复盘 · {{ report.period.start }} — {{ report.period.end }} · {{ formatTime(report.createdAt) }}</option></select></label><button v-if="history.removed.value?.instrument === instrument" type="button" @click="undoRemove">撤销删除复盘</button></div>
    <p v-if="message" class="review-note" role="status">{{ message }}</p><p v-if="history.message.value" class="review-warning" role="status">{{ history.message.value }}</p>
    <article v-if="activeReport" class="review-report" aria-label="复盘摘要内容">
      <div class="review-heading"><div><h3>{{ reviewTitle(activeReport) }}</h3><p>汇总截至 {{ activeReport.period.asOf }} · {{ activeReport.period.ongoing ? '周期进行中' : '完整自然周期' }} · 生成 {{ formatTime(activeReport.createdAt) }}（北京时间）{{ activeReport.id ? ' · 已保存快照' : ' · 尚未保存' }}</p></div></div>
      <div class="review-metrics"><article v-for="metric in activeReport.metrics" :key="metric.id"><h4>{{ metric.label }}</h4><strong>{{ formatReviewMetric(metric) }}</strong><p>{{ metric.detail }}</p></article></div>
      <section class="review-section" aria-label="复盘成分变化"><h4>成分变化</h4><p v-for="(line, index) in activeReport.constituents" :key="index">{{ line }}</p></section>
      <section class="review-section" aria-label="复盘个人笔记"><h4>我的观察笔记 · {{ activeReport.notes.length }} 条</h4><p v-if="!activeReport.notes.length">本区间没有该证券的观察笔记。可在 K 线的“观察笔记”中记录，再重新生成摘要。</p><ul v-else class="review-notes"><li v-for="note in activeReport.notes" :key="note.id"><strong>{{ note.date }}{{ note.price === null ? '' : ` · 记录价格 ${note.price}` }}</strong><p>{{ note.text }}</p></li></ul></section>
      <section class="review-section"><h4>我的复盘感想</h4><p v-if="activeReport.id" class="personal-reflection">{{ activeReport.reflection || '暂无补充感想。' }}</p><label v-else class="reflection-label">记录判断、疑问和下次观察重点<textarea v-model="reflection" :maxlength="MAX_REFLECTION_LENGTH" rows="4" aria-label="复盘感想" placeholder="本次观察到了什么？哪些判断需要继续验证？" /></label></section>
      <section class="review-section"><h4>数据状态与口径</h4><p v-for="(line, index) in activeReport.warnings" :key="`warning-${index}`" class="review-warning">{{ line }}</p><p v-for="(line, index) in activeReport.methodology" :key="index">{{ line }}</p></section>
      <div class="review-actions export-actions"><button type="button" :disabled="Boolean(activeReport.id) || history.reviews.value.length >= MAX_REVIEWS" @click="save">保存本次复盘</button><button v-if="activeReport.id" type="button" @click="newVersion">另存修改版本</button><button type="button" :disabled="exporting" @click="exportReport('png')">导出复盘图片</button><button type="button" :disabled="exporting" @click="exportReport('md')">导出 Markdown</button><button v-if="activeReport.id" type="button" @click="removeSelected">删除这份复盘</button></div>
    </article>
    <p v-else class="review-empty">选择周期并点击“生成复盘”，查看区间指标、成分变化与自己的笔记。</p>
    <p class="review-note">历史保存在当前浏览器、当前站点，不跨设备同步。导出包含个人笔记与感想；保存和导出均由你手动操作。数据较少时缺失项目显示原因，完整长笔记可用 Markdown 导出。</p>
  </section>
</template>

<style scoped>
.review-summary { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.review-heading, .review-actions, .review-history { display: flex; justify-content: space-between; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
.review-heading h2 { font-size: 15px; } .review-heading h3 { font-size: 14px; line-height: 1.7; color: #d4e2f5; overflow-wrap: anywhere; }
.review-heading p, .review-note, .review-warning { margin-top: 7px; color: #93a4bf; font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
button, select, input, textarea { border: 1px solid #33435b; border-radius: 6px; background: #111d30; color: #c7d8f2; padding: 8px 10px; font: inherit; font-size: 12px; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.review-controls { margin-top: 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 14px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; }
label { min-width: 0; color: #acbcd3; font-size: 11px; } select, input, textarea { display: block; width: 100%; box-sizing: border-box; min-width: 0; margin-top: 7px; } .period-label { grid-column: 1 / -1; margin: 0; }
.review-history { margin-top: 14px; } .review-history label { flex: 1; max-width: 720px; }
.review-report { margin-top: 18px; padding-top: 18px; border-top: 1px solid #223049; } .review-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.review-metrics article { padding: 15px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; min-width: 0; } h4 { color: #bed0e9; font-size: 12px; font-weight: 500; }
.review-metrics strong { display: block; margin-top: 10px; font-size: 23px; font-family: var(--font-mono); color: #89dce4; } .review-metrics p, .review-section p { margin-top: 8px; color: #93a4bf; font-size: 11px; line-height: 1.9; overflow-wrap: anywhere; }
.review-section { margin-top: 18px; } .review-section h4 { color: #d0ddf0; font-size: 13px; } .review-notes { list-style: none; padding: 0; display: grid; gap: 10px; margin-top: 10px; }
.review-notes li { padding: 12px 14px; border-left: 2px solid #408cff; background: #0a1220; border-radius: 4px; } .review-notes strong { color: #c5d7ee; font-size: 11px; } .review-notes p, .personal-reflection { white-space: pre-wrap; }
.reflection-label { display: block; margin-top: 10px; } textarea { resize: vertical; line-height: 1.8; } .review-actions { justify-content: flex-start; } .export-actions { margin-top: 18px; } .review-warning, .review-section p.review-warning { color: #d5b57f; } .review-empty { padding: 22px 0; color: #93a4bf; font-size: 12px; line-height: 1.9; }
@media (max-width: 1100px) { .review-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); } .review-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .review-summary { padding: 15px 12px; } .review-controls, .review-metrics { grid-template-columns: minmax(0, 1fr); } .review-history label { width: 100%; } .review-metrics strong { font-size: 22px; } }
</style>
