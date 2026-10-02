import { calculateDrawdown } from './drawdown.js'
import { validateMarketData } from './kline.js'
import { dataFreshness } from './sourceStatus.js'
import { isTradingDay } from './latestMetrics.js'
import { VALUATION_SOURCE, validateValuationHistory } from '../api/valuations.js'
import { validateYieldHistory, validateYieldSnapshot } from './yieldSpread.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { isSession, shiftDay, tradingDate, tradingSessions, rollingVolatility } from './priceRisk.js'

// Keep the storage key so existing reminders can be migrated without losing history.
export const ALERTS_KEY = 'stock:observation-alerts:v1'
export const MAX_ALERT_RULES = 50
export const MAX_ALERT_EVENTS = 100
export const MAX_ALERT_CONDITIONS = 6
export const ALERT_METRICS = { price: '收盘价格／点位', drawdown: '当前回撤跌幅', pe: '指数 PE', pb: '指数 PB', dividend: '指数股息率', spread: '股息与国债差值', volatility: '60 日年化波动率' }
export const ALERT_OPERATORS = { lte: '≤', gte: '≥' }
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const validId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value)
function validDate(value) {
  const time = Date.parse(`${value}T00:00:00Z`)
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function validMetricValue(metric, value) {
  return Number.isFinite(value) && (metric === 'spread' ? value >= -100 && value <= 100
    : ['drawdown', 'dividend'].includes(metric) ? value >= 0 && value <= 100
    : metric === 'volatility' ? value >= 0 : value > 0)
}
const compare = (condition, value) => condition.operator === 'lte' ? value <= condition.threshold : value >= condition.threshold
export const alertConditions = rule => rule.conditions ?? [{ metric: rule.metric, operator: rule.operator, threshold: rule.threshold }]
export function alertConfiguration(rule) {
  requireValue(['H30269', '512890'].includes(rule?.instrument), '提醒证券不受支持')
  const conditions = alertConditions(rule)
  requireValue(Array.isArray(conditions) && conditions.length > 0 && conditions.length <= MAX_ALERT_CONDITIONS, `每条提醒须有 1–${MAX_ALERT_CONDITIONS} 个条件`)
  const normalized = conditions.map(condition => {
    requireValue(condition && Object.hasOwn(ALERT_METRICS, condition.metric) && Object.hasOwn(ALERT_OPERATORS, condition.operator), '请选择有效的指标和条件')
    requireValue(validMetricValue(condition.metric, condition.threshold), '阈值无效：价格／估值须为正数，回撤／股息率为 0–100，波动率非负，利差为 -100–100')
    return { metric: condition.metric, operator: condition.operator, threshold: condition.threshold }
  })
  requireValue(new Set(normalized.map(condition => JSON.stringify(condition))).size === normalized.length, '同一提醒不能重复添加相同条件')
  const consecutiveDays = rule.consecutiveDays ?? 1, cooldownDays = rule.cooldownDays ?? 0
  requireValue(Number.isInteger(consecutiveDays) && consecutiveDays >= 1 && consecutiveDays <= 30, '连续交易日须为 1–30 的整数')
  requireValue(Number.isInteger(cooldownDays) && cooldownDays >= 0 && cooldownDays <= 250, '冷却期须为 0–250 个交易日的整数')
  return { conditions: normalized, consecutiveDays, cooldownDays }
}
export const alertSignature = rule => JSON.stringify([rule.instrument, alertConfiguration(rule).conditions.map(condition => JSON.stringify(condition)).sort(), rule.consecutiveDays ?? 1, rule.cooldownDays ?? 0])
export function validateAlertRule(rule) {
  const configuration = alertConfiguration(rule)
  requireValue(validId(rule.id) && typeof rule.enabled === 'boolean', '提醒编号或启用状态异常')
  requireValue(validTime(rule.createdAt) && validTime(rule.updatedAt) && rule.updatedAt >= rule.createdAt, '提醒保存时间异常')
  requireValue(rule.lastMatched === null || typeof rule.lastMatched === 'boolean', '提醒检查状态异常')
  requireValue(rule.lastDataDate === null ? rule.lastMatched === null : validDate(rule.lastDataDate) && rule.lastMatched !== null, '提醒数据日期异常')
  const lastTriggeredDate = rule.lastTriggeredDate ?? null, episodeNotified = rule.episodeNotified ?? rule.lastMatched === true
  requireValue(lastTriggeredDate === null || validDate(lastTriggeredDate) && rule.lastDataDate !== null && lastTriggeredDate <= rule.lastDataDate, '上次触发日期异常')
  requireValue(typeof episodeNotified === 'boolean' && (!episodeNotified || rule.lastMatched === true), '提醒去重状态异常')
  return { id: rule.id, instrument: rule.instrument, ...configuration.conditions[0], ...configuration,
    enabled: rule.enabled, createdAt: rule.createdAt, updatedAt: rule.updatedAt, lastMatched: rule.lastMatched, lastDataDate: rule.lastDataDate, lastTriggeredDate, episodeNotified }
}
export function validateAlertsDocument(document) {
  requireValue([1, 2].includes(document?.schemaVersion) && document.kind === 'stock-observation-alerts', '提醒保存格式或版本异常')
  requireValue(Array.isArray(document.rules) && document.rules.length <= MAX_ALERT_RULES && Array.isArray(document.events) && document.events.length <= MAX_ALERT_EVENTS, '提醒数量异常')
  const rules = document.rules.map(validateAlertRule)
  requireValue(new Set(rules.map(rule => rule.id)).size === rules.length, '提醒编号重复')
  const events = document.events.map(event => {
    const configuration = alertConfiguration(event)
    requireValue(validId(event.id) && validId(event.ruleId) && validTime(event.checkedAt) && validDate(event.dataDate) && typeof event.read === 'boolean', '触发记录格式异常')
    const values = event.values ?? [{ ...configuration.conditions[0], value: event.value, date: event.dataDate }]
    requireValue(Array.isArray(values) && values.length === configuration.conditions.length, '触发记录条件数异常')
    const normalized = values.map((point, index) => {
      const condition = configuration.conditions[index]
      requireValue(point && ['metric', 'operator', 'threshold'].every(key => point[key] === condition[key]) && point.date === event.dataDate && validMetricValue(point.metric, point.value), '触发记录数值或日期异常')
      requireValue(compare(condition, point.value), '触发记录未满足条件')
      return { ...condition, value: point.value, date: point.date }
    })
    const streak = event.streak ?? 1, streakStart = event.streakStart ?? event.dataDate
    requireValue(Number.isInteger(streak) && streak >= configuration.consecutiveDays && streak <= 30 && validDate(streakStart) && streakStart <= event.dataDate, '触发记录连续天数异常')
    return { id: event.id, ruleId: event.ruleId, instrument: event.instrument, ...configuration.conditions[0], ...configuration,
      value: normalized[0].value, values: normalized, streak, streakStart, dataDate: event.dataDate, checkedAt: event.checkedAt, read: event.read }
  })
  requireValue(new Set(events.map(event => event.id)).size === events.length, '触发记录编号重复')
  if (document.schemaVersion === 1) for (const rule of rules) {
    rule.lastTriggeredDate = events.filter(event => event.ruleId === rule.id && event.dataDate <= rule.lastDataDate).map(event => event.dataDate).sort().at(-1) ?? null
  }
  return { schemaVersion: 2, kind: 'stock-observation-alerts', rules, events }
}
export const emptyAlertsDocument = () => ({ schemaVersion: 2, kind: 'stock-observation-alerts', rules: [], events: [] })
export function alertMetricLabel(metric, instrument) {
  if (metric === 'price') return instrument === '512890' ? 'ETF 收盘价格' : '指数收盘点位'
  if (metric === 'pe' || metric === 'pb') return `${instrument === '512890' ? '标的指数 ' : '指数 '}${metric.toUpperCase()}`
  if (metric === 'dividend') return `${instrument === '512890' ? '标的指数 ' : '指数 '}股息率`
  return ALERT_METRICS[metric]
}
export const alertUnit = (metric, instrument) => metric === 'spread' ? '个百分点' : ['drawdown', 'dividend', 'volatility'].includes(metric) ? '%' : metric === 'price' ? instrument === '512890' ? '元' : '点' : '倍'
export function formatAlertValue(value, metric, instrument) {
  return Number.isFinite(value) ? `${Number(value.toFixed(metric === 'price' && instrument === '512890' ? 3 : 2))} ${alertUnit(metric, instrument)}` : '—'
}
export function alertConditionLabel(rule) {
  return alertConditions(rule).map(condition => `${alertMetricLabel(condition.metric, rule.instrument)} ${ALERT_OPERATORS[condition.operator]} ${condition.threshold} ${alertUnit(condition.metric, rule.instrument)}`).join(' 且 ')
}
export function alertTriggerExplanation(event) {
  return `${event.values.map(point => `${alertMetricLabel(point.metric, event.instrument)} ${formatAlertValue(point.value, point.metric, event.instrument)} ${ALERT_OPERATORS[point.operator]} ${point.threshold} ${alertUnit(point.metric, event.instrument)}`).join('；')}。全部条件在 ${event.streakStart} 至 ${event.dataDate} 连续 ${event.streak} 个交易日满足；冷却期 ${event.cooldownDays} 个交易日已通过。`
}

// Never forward-fill a missing day, mix latest dates, or infer success from a failed source.
export function observationAlertSamples(instrument, { market, valuation, collection, dividend, treasury, yieldHistory, valuationHistory, now = new Date() } = {}) {
  const marketState = market ?? {}, valuationState = valuation ?? {}, collectionState = collection ?? {}
  const pending = reason => ({ value: null, date: null, reason, history: [] })
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
  const samples = { price: pending(marketReason), drawdown: pending(marketReason), volatility: pending(marketReason) }
  if (!marketReason) {
    try {
      validateMarketData(marketState.data, instrument)
      requireValue(marketState.data.source === 'eastmoney', '行情来源异常')
      const { latest, history } = marketState.data
      samples.price = { value: latest.close, date: latest.date, reason: '', history: history.map(row => ({ date: row.date, value: row.close })) }
      const stats = calculateDrawdown(history)
      let peak = 0
      const drawdownHistory = history.map(row => { peak = Math.max(peak, row.close); return { date: row.date, value: Math.max(0, (peak - row.close) / peak * 100) } }).slice(1)
      samples.drawdown = stats.current ? { value: Math.max(0, (stats.current.peakClose - latest.close) / stats.current.peakClose * 100), date: latest.date, reason: '', history: drawdownHistory } : pending('至少需要两个日线收盘样本才能检查回撤')
    } catch { samples.price = pending('行情校验失败'); samples.drawdown = pending('行情校验失败') }
    try {
      requireValue(!samples.price.reason, '行情校验失败')
      const { latest } = marketState.data
      // Only compute the recent windows needed for a maximum 30-session streak.
      let start = latest.date
      for (let i = 1; i < 30; i++) start = tradingDate(shiftDay(start, -1), -1, tradingCalendar)
      const volatilityHistory = [...rollingVolatility(marketState.data, start, latest.date, tradingCalendar, 60)]
        .filter(([date, value]) => date >= start && value !== null).map(([date, value]) => ({ date, value: value * 100 }))
      const current = volatilityHistory.at(-1)
      samples.volatility = current?.date === latest.date ? { ...current, reason: '', history: volatilityHistory } : pending('60 日波动率需要连续 61 个交易日收盘，样本不足或行情缺日')
    } catch { samples.volatility = pending('行情或波动率交易日历校验失败') }
  }
  const valuationReason = sourceReady(valuationState, 'valuation', valuationState.data?.date, 'indicator')
  for (const metric of ['pe', 'pb']) {
    const data = valuationState.data
    samples[metric] = valuationReason ? pending(valuationReason) :
      data.code === 'H30269' && data.provider === 'Eastmoney' && data.source === VALUATION_SOURCE && data.basis === 'provider_unspecified' && data.unit === 'multiple' && Number.isFinite(data[metric]) && data[metric] > 0
        ? { value: data[metric], date: data.date, reason: '', history: [{ date: data.date, value: data[metric] }] } : pending('估值身份、口径或数值校验失败')
    if (!samples[metric].reason && valuationHistory) {
      const reason = sourceReady(valuationHistory, 'valuation', valuationHistory.data?.date, 'indicator')
      try {
        requireValue(!reason, reason); validateValuationHistory(valuationHistory.data)
        const rows = valuationHistory.data.history.filter(row => row.date <= data.date)
        requireValue(rows.at(-1)?.date === data.date && rows.at(-1)?.[metric] === data[metric], '估值历史与当前快照不一致')
        samples[metric].history = rows.map(row => ({ date: row.date, value: row[metric] }))
      } catch (error) { samples[metric].historyReason = reason || error.message }
    }
  }
  const yieldSamples = {}
  for (const [kind, state, key] of [['dividend', dividend ?? {}, 'dividend'], ['treasury', treasury ?? {}, 'bond']]) {
    const reason = sourceReady(state, key, state.data?.date, 'indicator')
    try {
      requireValue(!reason, reason)
      const current = validateYieldSnapshot(kind, state.data, { now })
      yieldSamples[kind] = { ...current, reason: '', history: [current] }
      if (yieldHistory) {
        requireValue(!yieldHistory.loading && !yieldHistory.error && yieldHistory.data, '收益率历史读取失败或待完成')
        requireValue(collectionState.data?.sources?.yieldHistory?.status === 'ok', '收益率历史后台生成失败或状态未知')
        const data = validateYieldHistory(yieldHistory.data, { now })
        const rows = data.series[kind].history.filter(row => row.date <= current.date)
        requireValue(rows.at(-1)?.date === current.date && rows.at(-1)?.value === current.value, '收益率历史与当前快照不一致')
        yieldSamples[kind].history = rows.map(row => ({ ...row }))
      }
    } catch (error) {
      if (yieldSamples[kind]) yieldSamples[kind].historyReason = error.message
      else yieldSamples[kind] = pending(reason || error.message)
    }
  }
  samples.dividend = yieldSamples.dividend
  const d = yieldSamples.dividend, t = yieldSamples.treasury
  if (d.reason || t.reason) samples.spread = pending(d.reason || t.reason)
  else if (d.date !== t.date) samples.spread = pending(`股息与国债日期不一致（${d.date} / ${t.date}），等待同日数据`)
  else {
    const bonds = new Map(t.history.map(row => [row.date, row.value]))
    samples.spread = { value: d.value - t.value, date: d.date, reason: '', historyReason: d.historyReason || t.historyReason,
      history: d.history.filter(row => bonds.has(row.date)).map(row => ({ date: row.date, value: row.value - bonds.get(row.date) })) }
  }
  return samples
}
export function alertCooldownRemaining(rule, date) {
  if (!rule.lastTriggeredDate || !rule.cooldownDays) return 0
  const elapsed = tradingSessions(rule.lastTriggeredDate, date, tradingCalendar).filter(day => day > rule.lastTriggeredDate).length
  return Math.max(0, rule.cooldownDays - elapsed)
}
export function evaluateAlertRule(rule, samples) {
  const base = { ruleId: rule.id, value: null, date: null, values: [], streak: 0, streakStart: null }
  if (!rule.enabled) return { ...base, status: 'paused', reason: '提醒已暂停' }
  const conditions = alertConditions(rule)
  const values = conditions.map(condition => ({ ...condition, ...samples?.[condition.metric] }))
  const pending = reason => ({ ...base, status: 'pending', reason })
  const invalid = values.find(point => point.reason || !validMetricValue(point.metric, point.value) || !validDate(point.date))
  if (invalid) return pending(`${alertMetricLabel(invalid.metric, rule.instrument)}：${invalid.reason || '暂无可核验的指标'}`)
  const date = values[0].date
  if (values.some(point => point.date !== date)) return pending(`条件数据日期不一致（${values.map(point => `${alertMetricLabel(point.metric, rule.instrument)} ${point.date}`).join('；')}），等待同日数据`)
  if (rule.lastDataDate && date < rule.lastDataDate) return pending('数据日期倒退，保留之前检查状态')
  try { requireValue(isSession(date, tradingCalendar), '指标日期不是交易日') } catch (error) { return pending(error.message) }
  const result = { ...base, value: values[0].value, date, values: values.map(({ metric, operator, threshold, value, date }) => ({ metric, operator, threshold, value, date })) }
  if (!values.every(point => compare(point, point.value))) return { ...result, status: 'unmatched', reason: '至少一个条件未满足，连续满足天数归零' }
  const days = rule.consecutiveDays ?? 1
  let streak = 1, start = date
  if (days > 1) {
    try {
      requireValue(isSession(date, tradingCalendar), '指标日期不是交易日')
      const invalidHistory = values.find(point => point.historyReason)
      requireValue(!invalidHistory, invalidHistory?.historyReason)
      const histories = values.map(point => new Map((point.history ?? []).map(row => [row.date, row.value])))
      while (streak < days) {
        const previous = tradingDate(shiftDay(start, -1), -1, tradingCalendar)
        if (histories.some((history, index) => !validMetricValue(conditions[index].metric, history.get(previous)))) return pending(`已核验连续 ${streak}/${days} 个交易日；${previous} 缺少同日历史样本，不延用前值`)
        if (!histories.every((history, index) => compare(conditions[index], history.get(previous)))) break
        start = previous; streak++
      }
    } catch (error) { return pending(error.message || '历史交易日历待核验') }
  }
  Object.assign(result, { streak, streakStart: start })
  if (streak < days) return { ...result, status: 'unmatched', reason: `全部条件当前满足，连续 ${streak}/${days} 个交易日，尚未达到要求` }
  // A page can miss an intervening non-matching day. A verified historical
  // failure ends the old episode; absence of a historical value never does.
  result.episodeReset = rule.lastMatched === true && values.some(point => !point.historyReason && (point.history ?? []).some(row => {
    if (row.date <= rule.lastDataDate || row.date >= date || !validMetricValue(point.metric, row.value) || compare(point, row.value)) return false
    try { return isSession(row.date, tradingCalendar) } catch { return false }
  }))
  try {
    const cooldownRemaining = alertCooldownRemaining(rule, date)
    return { ...result, status: 'matched', cooldownRemaining, reason: cooldownRemaining ? `连续 ${streak}/${days} 个交易日满足；冷却期剩余 ${cooldownRemaining} 个交易日，本次不新增记录` : `全部条件连续 ${streak}/${days} 个交易日满足${rule.episodeNotified ? '；持续满足，已记录' : '；冷却期已通过'}` }
  } catch { return pending('冷却期交易日历未覆盖，检查待核验') }
}
