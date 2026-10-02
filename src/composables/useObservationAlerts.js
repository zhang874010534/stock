import { reactive, ref } from 'vue'
import { ALERTS_KEY, MAX_ALERT_RULES, MAX_ALERT_EVENTS, alertConfiguration, alertSignature, alertCooldownRemaining, emptyAlertsDocument, validateAlertRule, validateAlertsDocument } from '../utils/observationAlerts.js'

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
    const configuration = alertConfiguration(input)
    const changed = !previous || alertSignature({ ...input, ...configuration }) !== alertSignature(previous)
    const time = new Date(Math.max(now().getTime(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
    const rule = validateAlertRule({ ...input, ...configuration, id: previous?.id ?? id(), enabled: previous?.enabled ?? true,
      createdAt: previous?.createdAt ?? time, updatedAt: time, lastMatched: changed ? null : previous.lastMatched, lastDataDate: changed ? null : previous.lastDataDate,
      lastTriggeredDate: changed ? null : previous.lastTriggeredDate, episodeNotified: changed ? false : previous.episodeNotified })
    if (state.rules.some(item => item.id !== rule.id && alertSignature(item) === alertSignature(rule))) throw new Error('相同证券已有这条提醒条件')
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
    if (state.rules.some(item => item.id === rule.id || alertSignature(item) === alertSignature(rule))) throw new Error('已有相同提醒，不能恢复重复条件')
    state.rules.push(rule); removed.value = null; save()
  }
  function record(results) {
    let changed = false
    for (const result of results) {
      const rule = state.rules.find(item => item.id === result.ruleId)
      if (!rule?.enabled || !['matched', 'unmatched'].includes(result.status) || (rule.lastDataDate && result.date < rule.lastDataDate)) continue
      const matched = result.status === 'matched'
      let cooldownRemaining
      try { cooldownRemaining = alertCooldownRemaining(rule, result.date) } catch { continue }
      const episodeNotified = matched && rule.lastMatched === true && rule.episodeNotified && !result.episodeReset
      if (matched && !episodeNotified && !cooldownRemaining) {
        const event = { id: id(), ruleId: rule.id, instrument: rule.instrument, ...rule.conditions[0], ...alertConfiguration(rule),
          value: result.value, values: result.values ?? [{ ...rule.conditions[0], value: result.value, date: result.date }],
          streak: result.streak ?? 1, streakStart: result.streakStart ?? result.date, dataDate: result.date, checkedAt: now().toISOString(), read: false }
        // Validate the immutable snapshot before changing persistent state.
        try { validateAlertsDocument({ ...emptyAlertsDocument(), events: [event] }) } catch { continue }
        state.events.unshift(event)
        state.events = state.events.slice(0, MAX_ALERT_EVENTS)
        rule.lastTriggeredDate = result.date; rule.episodeNotified = true; changed = true
      } else if (rule.episodeNotified !== episodeNotified) {
        rule.episodeNotified = episodeNotified; changed = true
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
