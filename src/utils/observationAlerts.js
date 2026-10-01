import { calculateDrawdown } from './drawdown.js'
import { validateMarketData } from './kline.js'
import { dataFreshness } from './sourceStatus.js'
import { isTradingDay } from './latestMetrics.js'
import { VALUATION_SOURCE } from '../api/valuations.js'

export const ALERTS_KEY = 'stock:observation-alerts:v1'
export const MAX_ALERT_RULES = 50
export const MAX_ALERT_EVENTS = 100
export const ALERT_METRICS = { price: '收盘价格／点位', drawdown: '当前回撤跌幅', pe: '指数 PE', pb: '指数 PB' }
export const ALERT_OPERATORS = { lte: '≤', gte: '≥' }
const instruments = ['H30269', '512890']
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const validId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value)
function validDate(value) {
  const time = Date.parse(`${value}T00:00:00Z`)
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function validCondition(rule) {
  requireValue(instruments.includes(rule?.instrument), '提醒证券不受支持')
  requireValue(Object.hasOwn(ALERT_METRICS, rule.metric) && Object.hasOwn(ALERT_OPERATORS, rule.operator), '请选择有效的指标和条件')
  requireValue(Number.isFinite(rule.threshold) && (rule.metric === 'drawdown' ? rule.threshold >= 0 && rule.threshold <= 100 : rule.threshold > 0), rule.metric === 'drawdown' ? '回撤跌幅须为 0–100 的百分数' : '价格／估值阈值必须为正数')
}
export function validateAlertRule(rule) {
  validCondition(rule)
  requireValue(validId(rule.id) && typeof rule.enabled === 'boolean', '提醒编号或启用状态异常')
  requireValue(validTime(rule.createdAt) && validTime(rule.updatedAt) && rule.updatedAt >= rule.createdAt, '提醒保存时间异常')
  requireValue(rule.lastMatched === null || typeof rule.lastMatched === 'boolean', '提醒检查状态异常')
  requireValue(rule.lastDataDate === null ? rule.lastMatched === null : validDate(rule.lastDataDate) && rule.lastMatched !== null, '提醒数据日期异常')
  return { id: rule.id, instrument: rule.instrument, metric: rule.metric, operator: rule.operator, threshold: rule.threshold,
    enabled: rule.enabled, createdAt: rule.createdAt, updatedAt: rule.updatedAt, lastMatched: rule.lastMatched, lastDataDate: rule.lastDataDate }
}
export function validateAlertsDocument(document) {
  requireValue(document?.schemaVersion === 1 && document.kind === 'stock-observation-alerts', '提醒保存格式或版本异常')
  requireValue(Array.isArray(document.rules) && document.rules.length <= MAX_ALERT_RULES && Array.isArray(document.events) && document.events.length <= MAX_ALERT_EVENTS, '提醒数量异常')
  const rules = document.rules.map(validateAlertRule)
  requireValue(new Set(rules.map(rule => rule.id)).size === rules.length, '提醒编号重复')
  const events = document.events.map(event => {
    validCondition(event)
    requireValue(validId(event.id) && validId(event.ruleId) && validTime(event.checkedAt) && validDate(event.dataDate) && typeof event.read === 'boolean', '触发记录格式异常')
    requireValue(Number.isFinite(event.value) && (event.metric === 'drawdown' ? event.value >= 0 && event.value <= 100 : event.value > 0), '触发记录数值异常')
    requireValue(event.operator === 'lte' ? event.value <= event.threshold : event.value >= event.threshold, '触发记录未满足条件')
    return { id: event.id, ruleId: event.ruleId, instrument: event.instrument, metric: event.metric, operator: event.operator,
      threshold: event.threshold, value: event.value, dataDate: event.dataDate, checkedAt: event.checkedAt, read: event.read }
  })
  requireValue(new Set(events.map(event => event.id)).size === events.length, '触发记录编号重复')
  return { schemaVersion: 1, kind: 'stock-observation-alerts', rules, events }
}
export const emptyAlertsDocument = () => ({ schemaVersion: 1, kind: 'stock-observation-alerts', rules: [], events: [] })
export function alertMetricLabel(metric, instrument) {
  if (metric === 'price') return instrument === '512890' ? 'ETF 收盘价格' : '指数收盘点位'
  if (metric === 'pe' || metric === 'pb') return `${instrument === '512890' ? '标的指数 ' : '指数 '}${metric.toUpperCase()}`
  return ALERT_METRICS[metric]
}
export const alertUnit = (metric, instrument) => metric === 'drawdown' ? '%' : metric === 'price' ? instrument === '512890' ? '元' : '点' : '倍'
export function formatAlertValue(value, metric, instrument) {
  return Number.isFinite(value) ? `${Number(value.toFixed(metric === 'price' && instrument === '512890' ? 3 : 2))} ${alertUnit(metric, instrument)}` : '—'
}
export function alertConditionLabel(rule) {
  return `${alertMetricLabel(rule.metric, rule.instrument)} ${ALERT_OPERATORS[rule.operator]} ${rule.threshold} ${alertUnit(rule.metric, rule.instrument)}`
}

// Values are the same observed snapshots used by the dashboard. Unknown or old
// data never resets a previously satisfied condition or creates a new event.
export function observationAlertSamples(instrument, { market, valuation, collection, now = new Date() } = {}) {
  const marketState = market ?? {}, valuationState = valuation ?? {}, collectionState = collection ?? {}
  const pending = reason => ({ value: null, date: null, reason })
  function sourceReady(state, key, date, kind) {
    if (state.loading || collectionState.loading) return '正在读取数据，检查待完成'
    if (state.error) return '文件读取失败，检查待核验'
    if (!state.data) return '暂无可用数据'
    if (collectionState.error || collectionState.data?.sources?.[key]?.status !== 'ok') return '后台采集失败或状态未知，检查待核验'
    const localNow = new Date(now.getTime() + 8 * 3600_000).toISOString()
    if (!validDate(date) || date > localNow.slice(0, 10)) return '数据日期无效或晚于今日'
    if (kind === 'market') {
      try { if (!isTradingDay(date)) return '行情日期不是交易日' } catch { return '行情交易日历待核验' }
      if (date === localNow.slice(0, 10) && localNow.slice(11, 16) < '15:00') return '当日行情尚未收盘'
    }
    const freshness = dataFreshness(date, { now, kind })
    return freshness.level === 'current' ? '' : freshness.text || '数据时效待核验'
  }
  const marketReason = sourceReady(marketState, instrument, marketState.data?.latest?.date, 'market')
  let price = pending(marketReason), drawdown = pending(marketReason)
  if (!marketReason) {
    try {
      validateMarketData(marketState.data, instrument)
      requireValue(marketState.data.source === 'eastmoney', '行情来源异常')
      const latest = marketState.data.latest
      price = { value: latest.close, date: latest.date, reason: '' }
      const stats = calculateDrawdown(marketState.data.history)
      drawdown = stats.current ? { value: Math.max(0, (stats.current.peakClose - latest.close) / stats.current.peakClose * 100), date: latest.date, reason: '' } : pending('至少需要两个日线收盘样本才能检查回撤')
    } catch { price = pending('行情校验失败'); drawdown = pending('行情校验失败') }
  }
  const valuationReason = sourceReady(valuationState, 'valuation', valuationState.data?.date, 'indicator')
  const samples = { price, drawdown }
  for (const metric of ['pe', 'pb']) {
    const data = valuationState.data
    samples[metric] = valuationReason ? pending(valuationReason) :
      data.code === 'H30269' && data.provider === 'Eastmoney' && data.source === VALUATION_SOURCE && data.basis === 'provider_unspecified' && data.unit === 'multiple' && Number.isFinite(data[metric]) && data[metric] > 0
        ? { value: data[metric], date: data.date, reason: '' } : pending('估值身份、口径或数值校验失败')
  }
  return samples
}
export function evaluateAlertRule(rule, samples) {
  if (!rule.enabled) return { ruleId: rule.id, status: 'paused', reason: '提醒已暂停', value: null, date: null }
  const sample = samples?.[rule.metric]
  const reason = !sample || sample.reason || !Number.isFinite(sample.value) || !validDate(sample.date) ? sample?.reason || '暂无可核验的指标' :
    rule.lastDataDate && sample.date < rule.lastDataDate ? '数据日期倒退，保留之前检查状态' : ''
  if (reason) return { ruleId: rule.id, status: 'pending', reason, value: null, date: null }
  const matched = rule.operator === 'lte' ? sample.value <= rule.threshold : sample.value >= rule.threshold
  return { ruleId: rule.id, status: matched ? 'matched' : 'unmatched', reason: '', value: sample.value, date: sample.date }
}
