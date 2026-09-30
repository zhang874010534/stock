import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { calculateDrawdown } from './drawdown.js'
import { DAY, ANNUAL_SESSIONS, dateTimestamp, shiftDay, tradingDate, anniversary, validatedWindow,
  annualizedVolatility, annualizedDownsideDeviation, rollingVolatility } from './priceRisk.js'

export const LOW_VOLATILITY_RANGES = [
  { key: 'all', label: '全部已核验历史' }, { key: 'year', label: '近1年' },
  { key: 'threeYears', label: '近3年' }, { key: 'ytd', label: '年初至今' },
]
export const ROLLING_PERIODS = [20, 60, 120]
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
function monthEnd(month) {
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5))
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}
function nextMonth(month) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 7)
}

export function monthlyPriceReturns(history, start, end, calendar = tradingCalendar) {
  const prices = new Map(history.map(row => [row.date, row.close])), months = []
  // The starting close is a baseline, not a return observation. A year-to-date
  // window starting on December 31 must not create a spurious December cell.
  const firstReturnDay = tradingDate(shiftDay(start, 1), 1, calendar)
  for (let month = firstReturnDay.slice(0, 7); month <= end.slice(0, 7); month = nextMonth(month)) {
    const result = { month, value: null, status: 'unavailable', reason: '', baseDate: null, endDate: null }
    try {
      const baseDate = tradingDate(shiftDay(`${month}-01`, -1), -1, calendar)
      const fullEnd = tradingDate(monthEnd(month), -1, calendar)
      const observedEnd = end < fullEnd ? end : fullEnd
      result.baseDate = baseDate; result.endDate = observedEnd
      requireValue(baseDate >= start, '所选区间未覆盖上月末基准')
      requireValue(prices.has(baseDate), '缺少上月最后交易日收盘价')
      const { rows } = validatedWindow(history, baseDate, observedEnd, calendar, '月份')
      requireValue(rows.length >= 2, '月度收益样本不足')
      const value = prices.get(observedEnd) / prices.get(baseDate) - 1
      requireValue(Number.isFinite(value), '月度收益无效')
      result.value = value; result.status = observedEnd === fullEnd ? 'complete' : 'partial'
      result.reason = result.status === 'partial' ? '截至行情日期的月内收益，不参与完整月份排名' : ''
    } catch (error) { result.reason = error.message }
    months.push(result)
  }
  return months
}

export function drawdownEvents(history) {
  const drawdown = calculateDrawdown(history)
  const indices = new Map(history.map((row, i) => [row.date, i]))
  const events = []
  let active = null
  function finish(endDate, endIndex, recovered) {
    events.push({ ...active, recoveryDate: recovered ? endDate : null, endDate,
      durationDays: (dateTimestamp(endDate) - dateTimestamp(active.peakDate)) / DAY,
      durationSessions: endIndex - indices.get(active.peakDate),
    })
    active = null
  }
  drawdown.points.forEach((point, i) => {
    if (point.value < 0) {
      if (!active) active = { peakDate: point.peakDate, peakClose: point.peakClose,
        troughDate: point.date, troughClose: point.close, depth: -point.value }
      else if (-point.value > active.depth) Object.assign(active, { troughDate: point.date, troughClose: point.close, depth: -point.value })
    } else if (active) finish(point.date, i, true)
  })
  if (active) finish(history.at(-1).date, history.length - 1, false)
  return events.sort((a, b) => b.depth - a.depth || a.peakDate.localeCompare(b.peakDate))
}

export function calculateLowVolatility(market, { range = 'all', rollingSessions = 60, calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(market && ['H30269', '512890'].includes(market.code), '低波分析证券身份无效')
  validateMarketData(market, market.code)
  requireValue(market.source === 'eastmoney', '低波分析行情来源异常')
  requireValue(LOW_VOLATILITY_RANGES.some(item => item.key === range), '低波分析区间无效')
  requireValue(ROLLING_PERIODS.includes(rollingSessions), '滚动窗口仅支持20、60或120个交易日')
  const end = market.latest.date, today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  requireValue(end <= today, '行情含未来日期')
  requireValue(end <= calendar.end, '交易日历未覆盖行情截止日')
  const availableStart = [market.history[0].date, calendar.start].sort().at(-1)
  let start
  if (range === 'all') start = tradingDate(availableStart, 1, calendar)
  else if (range === 'ytd') start = tradingDate(shiftDay(`${end.slice(0, 4)}-01-01`, -1), -1, calendar)
  else start = tradingDate(anniversary(end, range === 'year' ? 1 : 3), -1, calendar)
  requireValue(start >= availableStart, `历史不足，所需基准为 ${start}，可用历史最早为 ${availableStart}`)
  requireValue(start < end, '分析至少需要两个交易日收盘样本')
  const { rows } = validatedWindow(market.history, start, end, calendar, market.code)
  const returns = rows.slice(1).map((row, i) => row.close / rows[i].close - 1)
  requireValue(returns.every(Number.isFinite), '日收益无效')
  const rolling = rollingVolatility(market, start, end, calendar, rollingSessions)
  const downside = rollingVolatility(market, start, end, calendar, rollingSessions, annualizedDownsideDeviation)
  const points = rows.map(row => ({ date: row.date, volatility: rolling.get(row.date), downside: downside.get(row.date) }))
  const months = monthlyPriceReturns(market.history, start, end, calendar)
  const completeMonths = months.filter(month => month.status === 'complete')
  const rankedMonths = [...completeMonths].sort((a, b) => a.value - b.value || a.month.localeCompare(b.month))
  const events = drawdownEvents(rows)
  return { code: market.code, range, rollingSessions, annualizationSessions: ANNUAL_SESSIONS, dailyDownsideTarget: 0,
    downsideDenominator: 'all_returns_minus_one', calendarId: calendar.id,
    startDate: start, endDate: end, count: rows.length, returnCount: returns.length, points,
    annualizedVolatility: annualizedVolatility(returns), annualizedDownsideDeviation: annualizedDownsideDeviation(returns),
    latestRolling: points.at(-1), months, completeMonthCount: completeMonths.length,
    worstMonth: rankedMonths[0] ?? null, worstMonths: rankedMonths.slice(0, 5),
    totalEvents: events.length, events: events.slice(0, 5),
    backfillCompleted: market.backfill.completed,
    basis: market.code === '512890' ? 'unadjusted_etf_price_no_cash_dividends' : 'price_index_no_dividend_reinvestment',
  }
}
