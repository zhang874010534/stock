<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { createObservationAlerts } from '../composables/useObservationAlerts.js'
import { ALERT_METRICS, ALERT_OPERATORS, MAX_ALERT_RULES, alertConditionLabel, alertMetricLabel, alertUnit, evaluateAlertRule, formatAlertValue, observationAlertSamples } from '../utils/observationAlerts.js'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const dashboard = useDashboardData()
const alerts = createObservationAlerts()
const rules = computed(() => alerts.state.rules.filter(rule => rule.instrument === props.instrument))
const events = computed(() => alerts.state.events.filter(event => event.instrument === props.instrument))
const observedNow = ref(new Date())
let timer
onMounted(() => { timer = setInterval(() => { observedNow.value = new Date() }, 60_000) })
onUnmounted(() => clearInterval(timer))
const samples = computed(() => observationAlertSamples(props.instrument, {
  market: dashboard.states[props.instrument], valuation: dashboard.states.valuation,
  collection: dashboard.states.collection, now: observedNow.value,
}))
const evaluations = computed(() => rules.value.map(rule => ({ rule, result: evaluateAlertRule(rule, samples.value) })))
watch(evaluations, values => alerts.record(values.map(item => item.result)), { immediate: true })
const activeCount = computed(() => evaluations.value.filter(item => item.result.status === 'matched').length)
const unreadCount = computed(() => events.value.filter(event => !event.read).length)
const pendingCount = computed(() => evaluations.value.filter(item => item.result.status === 'pending').length)
const statusLabels = { matched: '条件满足', unmatched: '未满足', pending: '待核验', paused: '已暂停' }
const formOpen = ref(false), formError = ref(''), thresholdInput = ref(null)
const draft = reactive({ id: null, metric: 'price', operator: 'lte', threshold: '' })
async function openForm(rule) {
  Object.assign(draft, { id: rule?.id ?? null, metric: rule?.metric ?? 'price', operator: rule?.operator ?? 'lte', threshold: rule ? String(rule.threshold) : '' })
  formError.value = ''; formOpen.value = true
  await nextTick(); thresholdInput.value?.focus?.()
}
function submit() {
  try {
    if (!String(draft.threshold).trim()) throw new Error('请填写观察阈值')
    alerts.upsert({ id: draft.id, instrument: props.instrument, metric: draft.metric, operator: draft.operator, threshold: Number(draft.threshold) })
    formOpen.value = false; formError.value = ''
  } catch (error) { formError.value = error.message }
}
function undoRemove() { try { alerts.undoRemove(); formError.value = '' } catch (error) { formError.value = error.message } }
watch(() => props.instrument, () => { formOpen.value = false; formError.value = ''; dashboard.ensure(props.instrument) })
for (const key of [props.instrument, 'valuation', 'collection']) dashboard.ensure(key)
const formatTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const refresh = () => { observedNow.value = new Date(); return dashboard.refresh([props.instrument, 'valuation', 'collection']) }
const loading = computed(() => dashboard.states[props.instrument].loading || dashboard.states.valuation.loading || dashboard.states.collection.loading)
defineExpose({ activeCount, unreadCount })
</script>

<template>
  <section class="observation-alerts panel" aria-label="自定义观察提醒">
    <header class="alerts-heading"><div><h2>自定义观察提醒</h2><p>{{ instrument }} · 当前浏览器保存 · 日度快照检查</p></div><div class="alert-actions"><button type="button" :disabled="loading" @click="refresh">{{ loading ? '检查待完成…' : '重新读取并检查' }}</button><button type="button" :disabled="alerts.state.rules.length >= MAX_ALERT_RULES" @click="openForm()">添加条件</button></div></header>
    <p class="alerts-note">价格与回撤使用当前证券；{{ instrument === '512890' ? 'PE / PB 使用 H30269 标的指数估值。' : 'PE / PB 使用 H30269 指数估值。' }}回撤填写正数跌幅，例如 10 表示距已同步历史收盘高点下跌 10%。</p>
    <p class="alerts-overview" role="status">{{ rules.length ? `${rules.length} 条条件 · ${activeCount} 条满足 · ${pendingCount} 条待核验 · ${unreadCount} 条未读触发记录` : '尚未设置观察条件，点击“添加条件”开始。' }}</p>
    <p v-if="alerts.message.value" class="alerts-warning" role="status">{{ alerts.message.value }}</p>
    <p v-if="alerts.removed.value?.instrument === instrument" class="alerts-note">已删除一条条件。<button type="button" @click="undoRemove">撤销删除</button></p>
    <form v-if="formOpen" class="alert-form" aria-label="观察条件设置" @submit.prevent="submit">
      <label>观察指标<select v-model="draft.metric" aria-label="观察指标"><option v-for="(_, key) in ALERT_METRICS" :key="key" :value="key">{{ alertMetricLabel(key, instrument) }}</option></select></label>
      <label>满足条件<select v-model="draft.operator" aria-label="满足条件"><option v-for="(label, key) in ALERT_OPERATORS" :key="key" :value="key">{{ label === '≤' ? '小于或等于（≤）' : '大于或等于（≥）' }}</option></select></label>
      <label>观察阈值（{{ alertUnit(draft.metric, instrument) }}）<input ref="thresholdInput" v-model="draft.threshold" type="number" step="any" min="0" :max="draft.metric === 'drawdown' ? 100 : undefined" required aria-label="观察阈值" placeholder="填写自己的阈值" /></label>
      <div class="alert-actions form-actions"><button type="submit">{{ draft.id ? '保存修改' : '保存条件' }}</button><button type="button" @click="formOpen = false; formError = ''">取消</button></div>
    </form>
    <p v-if="formError" class="alerts-warning" role="alert">{{ formError }}</p>
    <ul v-if="evaluations.length" class="alert-rules">
      <li v-for="{ rule, result } in evaluations" :key="rule.id" :class="{ matched: result.status === 'matched' }">
        <div class="rule-heading"><strong>{{ alertConditionLabel(rule) }}</strong><span class="rule-status" :class="result.status">{{ statusLabels[result.status] }}</span></div>
        <p v-if="result.date" class="alerts-note">当前值 {{ formatAlertValue(result.value, rule.metric, instrument) }} · 数据日期 {{ result.date }}{{ rule.metric === 'drawdown' ? ' · 已同步历史收盘高点口径' : '' }}</p>
        <p v-else class="alerts-note">{{ result.reason }}{{ rule.lastDataDate ? `；上次有效检查日期 ${rule.lastDataDate}` : '' }}</p>
        <div class="alert-actions rule-actions"><button type="button" :aria-label="`${rule.enabled ? '暂停' : '启用'}条件：${alertConditionLabel(rule)}`" @click="alerts.toggle(rule.id)">{{ rule.enabled ? '暂停' : '启用' }}</button><button type="button" :aria-label="`编辑条件：${alertConditionLabel(rule)}`" @click="openForm(rule)">编辑</button><button type="button" :aria-label="`删除条件：${alertConditionLabel(rule)}`" @click="alerts.remove(rule.id)">删除</button></div>
      </li>
    </ul>
    <details v-if="events.length" class="alert-history" open><summary>触发记录 · {{ events.length }} 条（{{ unreadCount }} 条未读）</summary><div class="history-heading"><p class="alerts-note">首次检查满足条件，或条件解除后再次满足时记录；持续满足不会反复新增。记录保留触发当时的条件与数值。</p><button type="button" :disabled="!unreadCount" @click="alerts.markRead(instrument)">全部标为已读</button></div><ol><li v-for="event in events" :key="event.id"><div class="rule-heading"><strong>{{ alertConditionLabel(event) }}</strong><span>{{ event.read ? '已读' : '未读' }}</span></div><p class="alerts-note">触发值 {{ formatAlertValue(event.value, event.metric, event.instrument) }} · 数据日期 {{ event.dataDate }} · 检查时间 {{ formatTime(event.checkedAt) }}（北京时间）</p></li></ol></details>
    <details class="alert-method"><summary>提醒范围与数据口径</summary><p>只检查当前选择的证券，打开页面和重新读取数据时检查。规则和最近 100 条触发记录保存在当前浏览器、当前站点，不跨设备同步。关闭页面后不会主动通知；页面内的时间检查仅更新时效判断，不自动抓取新行情。</p><p>仅用通过校验且时效正常的已部署数据。读取失败、后台失败或状态未知、数据较旧、日历未覆盖和日期倒退时显示待核验，保留历史记录，不新增触发，也不把原条件判为解除。满足状态依据原始数值判断，显示数值可能有舍入。</p><p>ETF 使用未复权日收盘，不含现金分红，除息和份额拆分可能影响回撤。回撤使用全部已同步历史，不代表成立以来；历史回补可能改变高点。PE / PB 使用东方财富独立口径，与中证估值不同。修改指标、比较方向或阈值后按新条件重新检查，暂停再启用同一条件不会重复记录持续满足的状态。</p></details>
  </section>
</template>

<style scoped>
.observation-alerts { padding: 18px 20px; min-width: 0; scroll-margin-top: calc(var(--header-height) + 18px); }
.alerts-heading, .rule-heading, .alert-actions, .history-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; }
h2 { font-size: 15px; } .alerts-heading p { margin-top: 5px; color: #93a4bf; font-size: 11px; }
.alert-actions { justify-content: flex-start; }
button, select, input { border: 1px solid #33435b; border-radius: 5px; background: #111d30; color: #c7d8f2; padding: 7px 10px; font: inherit; font-size: 11px; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.alerts-note, .alerts-warning, .alerts-overview, .alert-method { margin-top: 9px; color: #93a4bf; font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
.alerts-warning { color: #d5b57f; } .alerts-overview { color: #b8ceec; }
.alert-form { display: grid; grid-template-columns: 1fr 1fr 1fr auto; align-items: end; gap: 12px; margin-top: 14px; padding: 14px; background: #0a1220; border: 1px solid #223049; border-radius: 8px; }
.alert-form label { min-width: 0; color: #acbcd3; font-size: 11px; } select, input { display: block; box-sizing: border-box; width: 100%; margin-top: 7px; min-width: 0; }
.alert-rules, .alert-history ol { display: grid; gap: 10px; list-style: none; padding: 0; margin-top: 14px; }
.alert-rules li, .alert-history li { padding: 12px 14px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; min-width: 0; }
.alert-rules li.matched { border-color: #477874; background: #0c242b; }
.rule-heading strong { color: #c7d8f2; font-size: 12px; font-weight: 500; overflow-wrap: anywhere; } .rule-status, .rule-heading > span { font-size: 11px; color: #93a4bf; } .rule-status.matched { color: #89e3e9; } .rule-status.pending { color: #d5b57f; }
.rule-actions { margin-top: 9px; } .alert-history, .alert-method { border-top: 1px solid #223049; margin-top: 16px; padding-top: 12px; } .alert-history { color: #b8ceec; font-size: 12px; } summary { cursor: pointer; } .alert-method p { margin-top: 8px; }
@media (max-width: 1100px) { .alert-form { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .observation-alerts { padding: 15px 12px; } .alert-form { grid-template-columns: minmax(0, 1fr); padding: 12px; } }
</style>
