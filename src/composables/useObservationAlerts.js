import { reactive, ref } from 'vue'
import { ALERTS_KEY, MAX_ALERT_RULES, MAX_ALERT_EVENTS, emptyAlertsDocument, validateAlertRule, validateAlertsDocument } from '../utils/observationAlerts.js'

export function createObservationAlerts({ storage, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
  const message = ref(''), removed = ref(null)
  const getStorage = () => storage ?? globalThis.localStorage
  let initial = emptyAlertsDocument(), readable = true
  try {
    const raw = getStorage()?.getItem(ALERTS_KEY)
    if (raw != null) initial = validateAlertsDocument(JSON.parse(raw))
  } catch { readable = false; message.value = '本机提醒读取失败。为保留原记录，当前修改仅留在页面中。' }
  const state = reactive(initial)
  function save() {
    if (!readable) return
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(ALERTS_KEY, JSON.stringify(validateAlertsDocument(state)))
      message.value = ''
    } catch { message.value = '本机提醒保存失败，当前规则与触发记录仅留在页面中。' }
  }
  function upsert(input) {
    const previous = input.id ? state.rules.find(rule => rule.id === input.id) : null
    if (input.id && (!previous || previous.instrument !== input.instrument)) throw new Error('待编辑的提醒已不存在')
    if (!previous && state.rules.length >= MAX_ALERT_RULES) throw new Error(`最多保存 ${MAX_ALERT_RULES} 条提醒`)
    const changed = !previous || ['metric', 'operator', 'threshold'].some(key => input[key] !== previous[key])
    const time = new Date(Math.max(now().getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
    const rule = validateAlertRule({ ...input, id: previous?.id ?? id(), enabled: previous?.enabled ?? true,
      createdAt: previous?.createdAt ?? time, updatedAt: time, lastMatched: changed ? null : previous.lastMatched, lastDataDate: changed ? null : previous.lastDataDate })
    if (state.rules.some(item => item.id !== rule.id && ['instrument', 'metric', 'operator', 'threshold'].every(key => item[key] === rule[key]))) throw new Error('相同证券已有这条提醒条件')
    state.rules = [...state.rules.filter(item => item.id !== rule.id), rule]
    save()
    return rule
  }
  function toggle(ruleId) {
    const rule = state.rules.find(item => item.id === ruleId)
    if (rule) { rule.enabled = !rule.enabled; save() }
  }
  function remove(ruleId) {
    const rule = state.rules.find(item => item.id === ruleId)
    if (!rule) return
    removed.value = { ...rule }
    state.rules = state.rules.filter(item => item.id !== ruleId)
    save()
  }
  function undoRemove() {
    if (!removed.value) return
    if (state.rules.length >= MAX_ALERT_RULES) throw new Error(`最多保存 ${MAX_ALERT_RULES} 条提醒`)
    const rule = removed.value
    if (state.rules.some(item => item.id === rule.id || ['instrument', 'metric', 'operator', 'threshold'].every(key => item[key] === rule[key]))) throw new Error('已有相同提醒，不能恢复重复条件')
    state.rules.push(rule); removed.value = null; save()
  }
  function record(results) {
    let changed = false
    for (const result of results) {
      const rule = state.rules.find(item => item.id === result.ruleId)
      if (!rule?.enabled || !['matched', 'unmatched'].includes(result.status) || (rule.lastDataDate && result.date < rule.lastDataDate)) continue
      const matched = result.status === 'matched'
      if (matched && rule.lastMatched !== true) {
        state.events.unshift({ id: id(), ruleId: rule.id, instrument: rule.instrument, metric: rule.metric, operator: rule.operator,
          threshold: rule.threshold, value: result.value, dataDate: result.date, checkedAt: now().toISOString(), read: false })
        state.events = state.events.slice(0, MAX_ALERT_EVENTS)
      }
      if (rule.lastMatched !== matched || rule.lastDataDate !== result.date) {
        rule.lastMatched = matched; rule.lastDataDate = result.date; changed = true
      }
    }
    if (changed) save()
  }
  function markRead(instrument) {
    for (const event of state.events) if (event.instrument === instrument) event.read = true
    save()
  }
  return { state, message, removed, upsert, toggle, remove, undoRemove, record, markRead }
}
