import { validateValuationHistory, VALUATION_SOURCE } from '../api/valuations.js'
import { summarizeHoldingWindows } from './holdingPeriods.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { shiftDay, tradingDate, tradingSessions, rollingVolatility } from './priceRisk.js'

export const HOLDING_CONDITIONS = [
  { key: 'drawdown', label: '回撤跌幅', unit: '%', limit: 100 },
  { key: 'volatility', label: '60 日年化波动率', unit: '%', limit: 10000 },
  { key: 'pe', label: '东方财富指数 PE', unit: '倍', limit: 1e6 },
  { key: 'pb', label: '东方财富指数 PB', unit: '倍', limit: 1e6 },
]
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export const emptyHoldingFilters = () => Object.fromEntries(HOLDING_CONDITIONS.map(({ key }) => [key, { min: '', max: '' }]))
export function normalizeHoldingFilters(input) {
  const filters = {}
  for (const { key, label, limit } of HOLDING_CONDITIONS) {
    const range = input?.[key]
    requireValue(range && ['min', 'max'].every(bound => range[bound] === null || typeof range[bound] === 'string' || typeof range[bound] === 'number'), `${label}条件格式异常`)
    const read = bound => {
      const raw = range[bound]
      if (raw === null || typeof raw === 'string' && !raw.trim()) return null
      const value = Number(raw)
      requireValue(Number.isFinite(value) && value >= 0 && value <= limit, `${label}须为 0 至 ${limit} 的有限数值`)
      return value
    }
    const min = read('min'), max = read('max')
    requireValue(min === null || max === null || min <= max, `${label}下限不能大于上限`)
    filters[key] = { min, max }
  }
  return filters
}
export const holdingFilterLabel = filters => HOLDING_CONDITIONS.flatMap(({ key, label, unit }) => {
  const { min, max } = filters[key]
  return min === null && max === null ? [] : [`${label} ${min === null ? `≤ ${max}` : max === null ? `≥ ${min}` : `${min} — ${max}`} ${unit}`]
}).join('；') || '不限制买入环境'

// Signals belong to the previous trading session. Returns start at the next
// session's close; neither the purchase close nor any later high/valuation is
// available to the screen. Valuations require an exact reference-date match.
export function holdingEntryEnvironments(market, stats, valuationHistory, { calendar = tradingCalendar } = {}) {
  requireValue(market?.code === stats?.code, '条件研究行情与持有样本证券不一致')
  const first = tradingDate([market.history[0].date, calendar.start].sort().at(-1), 1, calendar)
  const rows = market.history.filter(row => row.date >= first && row.date <= stats.endDate)
  const prices = new Map(rows.map(row => [row.date, row.close]))
  const drawdowns = new Map()
  let peak = 0, complete = true
  for (const date of tradingSessions(first, stats.endDate, calendar)) {
    const close = prices.get(date)
    if (close === undefined) complete = false
    if (close !== undefined) peak = Math.max(peak, close)
    drawdowns.set(date, complete ? (1 - close / peak) * 100 : null)
  }
  const volatility = rollingVolatility(market, first, stats.endDate, calendar, 60)
  let valuations = new Map(), valuationReason = ''
  try {
    validateValuationHistory(valuationHistory)
    valuations = new Map(valuationHistory.history.map(row => [row.date, row]))
  } catch (error) { valuationReason = error.message }
  const observations = new Map()
  for (const buyDate of tradingSessions(stats.startDate, stats.endDate, calendar)) {
    let referenceDate = null
    try { referenceDate = tradingDate(shiftDay(buyDate, -1), -1, calendar) } catch { /* Calendar boundary: unknown, never a fake zero. */ }
    const valuation = valuations.get(referenceDate)
    const point = { buyDate, referenceDate, drawdown: drawdowns.get(referenceDate) ?? null,
      volatility: volatility.get(referenceDate) == null ? null : volatility.get(referenceDate) * 100,
      pe: valuation?.pe ?? null, pb: valuation?.pb ?? null, valuationDate: valuation?.date ?? null,
      reasons: {} }
    if (point.drawdown === null) point.reasons.drawdown = '缺少买入前收盘或此前历史有行情缺口，回撤高点不可完整核验'
    if (point.volatility === null) point.reasons.volatility = '买入前缺少连续 61 个交易日收盘，60 日波动率不可计算'
    if (!valuation) for (const key of ['pe', 'pb']) point.reasons[key] = valuationReason || `缺少 ${referenceDate ?? '前一交易日'} 同日估值；不沿用更早观察或后来估值`
    observations.set(buyDate, point)
  }
  return { observations, historyStart: first, valuation: { reason: valuationReason, source: VALUATION_SOURCE,
    firstDate: valuationReason ? null : valuationHistory.history[0].date,
    lastDate: valuationReason ? null : valuationHistory.date,
    count: valuations.size } }
}

export function classifyHoldingEntry(observation, filters) {
  const active = HOLDING_CONDITIONS.filter(({ key }) => filters[key].min !== null || filters[key].max !== null)
  const missing = active.filter(({ key }) => !Number.isFinite(observation?.[key])).map(({ key }) => key)
  // Unknown inputs stay out of both comparison groups, even when another
  // condition is already false. Matched and unmatched share known coverage.
  if (missing.length) return { status: 'unknown', missing }
  const rejected = active.filter(({ key }) => {
    const value = observation[key], { min, max } = filters[key]
    return min !== null && value < min || max !== null && value > max
  }).map(({ key }) => key)
  return { status: rejected.length ? 'excluded' : 'complete', missing: [], rejected }
}
export function filterHoldingWindows(series, environments, input) {
  const filters = normalizeHoldingFilters(input)
  const active = HOLDING_CONDITIONS.some(({ key }) => filters[key].min !== null || filters[key].max !== null)
  const unknownByCondition = Object.fromEntries(HOLDING_CONDITIONS.map(({ key }) => [key, 0]))
  const excluded = [], unknown = []
  const points = series.points.map(point => {
    if (point.status !== 'complete') return { ...point }
    const environment = environments.observations.get(point.buyDate)
    const classification = classifyHoldingEntry(environment, filters)
    for (const key of classification.missing) unknownByCondition[key]++
    const enriched = { ...point, environment, classification }
    if (classification.status === 'excluded') excluded.push(enriched)
    if (classification.status === 'unknown') unknown.push(enriched)
    return classification.status === 'complete' ? enriched : { ...enriched, status: classification.status, returnRate: null }
  })
  const label = holdingFilterLabel(filters)
  return { active, filters, label, baseline: series,
    matched: { ...summarizeHoldingWindows(series.years, points, { immatureCount: series.immatureCount, missingCount: series.missingCount, candidateCount: series.candidateCount }), conditionLabel: active ? label : '' },
    excluded: summarizeHoldingWindows(series.years, excluded), unknownCount: unknown.length, unknownByCondition,
    knownCount: series.count - unknown.length }
}
