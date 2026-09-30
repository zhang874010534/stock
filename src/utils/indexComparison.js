import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { calculateDrawdown } from './drawdown.js'

export const COMPARISON_RANGES = [
  { key: 'ytd', label: '年初至今' }, { key: 'year', label: '近1年' },
  { key: 'threeYears', label: '近3年' }, { key: 'all', label: '全部共同历史' },
  { key: 'custom', label: '自定义' },
]
export const ROLLING_SESSIONS = 60
const DAY = 86_400_000
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
function timestamp(day) {
  const time = Date.parse(`${day}T00:00:00Z`)
  requireValue(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day, '比较日期无效')
  return time
}
const shift = (day, count) => new Date(timestamp(day) + count * DAY).toISOString().slice(0, 10)
function session(day, calendar) {
  requireValue(day >= calendar.start && day <= calendar.end, '交易日历未覆盖比较日期')
  const weekday = new Date(timestamp(day)).getUTCDay()
  return weekday !== 0 && weekday !== 6 && !calendar.closures.some(([start, end]) => day >= start && day <= end)
}
function tradingDate(day, direction, calendar) {
  while (!session(day, calendar)) day = shift(day, direction)
  return day
}
function sessions(start, end, calendar) {
  const days = []
  for (let day = start; day <= end; day = shift(day, 1)) if (session(day, calendar)) days.push(day)
  return days
}
function anniversary(day, years) {
  const year = Number(day.slice(0, 4)) - years
  const candidate = `${year}${day.slice(4)}`
  return new Date(Date.parse(`${candidate}T00:00:00Z`)).toISOString().slice(0, 10) === candidate ? candidate : `${year}-02-28`
}
export function annualizedVolatility(returns) {
  if (returns.length < 2) return null
  requireValue(returns.every(Number.isFinite), '日收益无效')
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
  const value = Math.sqrt(variance * 252)
  requireValue(Number.isFinite(value), '波动率计算结果非有限数值')
  return value < 1e-12 ? 0 : value
}
function rollingVolatility(market, start, end, calendar) {
  let warmupStart = start, remaining = ROLLING_SESSIONS
  while (remaining && warmupStart > calendar.start) {
    warmupStart = shift(warmupStart, -1)
    if (session(warmupStart, calendar)) remaining--
  }
  const prices = new Map(market.history.map(row => [row.date, row.close]))
  const result = new Map(), returns = []
  let previous
  for (const day of sessions(warmupStart, end, calendar)) {
    const close = prices.get(day)
    if (close !== undefined && previous !== undefined) returns.push(close / previous - 1)
    else returns.length = 0
    if (returns.length > ROLLING_SESSIONS) returns.shift()
    result.set(day, returns.length === ROLLING_SESSIONS ? annualizedVolatility(returns) : null)
    previous = close
  }
  return result
}

export function calculateIndexComparison(index, benchmark, {
  range = 'year', start: requestedStart, end: requestedEnd, calendar = tradingCalendar, now = new Date(),
} = {}) {
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  for (const [market, code] of [[index, 'H30269'], [benchmark, '000300']]) {
    validateMarketData(market, code)
    requireValue(market.source === 'eastmoney', `${code} 行情来源异常`)
    requireValue(market.latest.date <= today, `${code} 行情含未来日期`)
  }
  requireValue(COMPARISON_RANGES.some(item => item.key === range), '比较区间无效')
  const commonEnd = [index.latest.date, benchmark.latest.date].sort()[0]
  requireValue(commonEnd <= calendar.end, '交易日历未覆盖共同截止日')
  const availableStart = [index.history[0].date, benchmark.history[0].date, calendar.start].sort().at(-1)
  let start, end = commonEnd
  if (range === 'all') start = tradingDate(availableStart, 1, calendar)
  else if (range === 'ytd') start = tradingDate(shift(`${end.slice(0, 4)}-01-01`, -1), -1, calendar)
  else if (range === 'custom') {
    timestamp(requestedStart); timestamp(requestedEnd)
    requireValue(requestedStart <= requestedEnd, '开始日期不能晚于结束日期')
    requireValue(requestedEnd <= commonEnd, `结束日期不能晚于共同截止日 ${commonEnd}`)
    start = tradingDate(requestedStart, 1, calendar)
    end = tradingDate(requestedEnd, -1, calendar)
  } else start = tradingDate(anniversary(end, range === 'year' ? 1 : 3), -1, calendar)
  requireValue(start >= availableStart, `共同历史不足，所需基准为 ${start}，可用历史最早为 ${availableStart}`)
  requireValue(start < end, '比较至少需要两个交易日收盘样本')
  const expected = sessions(start, end, calendar)
  const expectedSet = new Set(expected)
  const series = [index, benchmark].map(market => {
    const rows = market.history.filter(row => row.date >= start && row.date <= end)
    const dates = new Set(rows.map(row => row.date))
    const missing = expected.filter(day => !dates.has(day))
    requireValue(!missing.length, `${market.code} 缺少 ${missing.length} 个交易日：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}`)
    requireValue(rows.every(row => expectedSet.has(row.date)), `${market.code} 区间内含非交易日行情`)
    const returns = rows.slice(1).map((row, i) => row.close / rows[i].close - 1)
    const drawdown = calculateDrawdown(rows)
    const rolling = rollingVolatility(market, start, end, calendar)
    const points = rows.map((row, i) => ({ date: row.date, cumulativeReturn: row.close / rows[0].close - 1,
      drawdown: drawdown.points[i].value, rollingVolatility: rolling.get(row.date) }))
    requireValue(points.every(point => Number.isFinite(point.cumulativeReturn)) && returns.every(Number.isFinite), '比较结果非有限数值')
    return { code: market.code, name: market.name, sourceDate: market.latest.date, updatedAt: market.updatedAt,
      backfillCompleted: market.backfill.completed, points,
      cumulativeReturn: points.at(-1).cumulativeReturn, maxDrawdown: drawdown.maximum ? -drawdown.maximum.value : 0,
      annualizedVolatility: annualizedVolatility(returns),
      drawdownPeakDate: drawdown.maximum?.peakDate ?? null, drawdownTroughDate: drawdown.maximum?.troughDate ?? null,
    }
  })
  return { range, startDate: start, endDate: end, commonEnd, count: expected.length, returnCount: expected.length - 1,
    calendarId: calendar.id, annualizationSessions: 252, rollingSessions: ROLLING_SESSIONS,
    basis: 'price_index_no_dividend_reinvestment', series,
    returnDifference: series[0].cumulativeReturn - series[1].cumulativeReturn,
  }
}

export function comparisonPercent(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(Math.abs(value * 100) < .005 ? 0 : value * 100).toFixed(2)}%`
}
