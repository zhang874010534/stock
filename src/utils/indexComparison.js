import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { calculateDrawdown } from './drawdown.js'
import { shiftDay as shift, tradingDate, anniversary, validatedWindow, annualizedVolatility, rollingVolatility } from './priceRisk.js'
export { annualizedVolatility, riskPercent as comparisonPercent } from './priceRisk.js'

export const COMPARISON_RANGES = [
  { key: 'ytd', label: '年初至今' }, { key: 'year', label: '近1年' },
  { key: 'threeYears', label: '近3年' }, { key: 'all', label: '全部共同历史' },
  { key: 'custom', label: '自定义' },
]
export const ROLLING_SESSIONS = 60
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

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
    // Validate dates before ordering them or adjusting to a trading session.
    shift(requestedStart, 0); shift(requestedEnd, 0)
    requireValue(requestedStart <= requestedEnd, '开始日期不能晚于结束日期')
    requireValue(requestedEnd <= commonEnd, `结束日期不能晚于共同截止日 ${commonEnd}`)
    start = tradingDate(requestedStart, 1, calendar)
    end = tradingDate(requestedEnd, -1, calendar)
  } else start = tradingDate(anniversary(end, range === 'year' ? 1 : 3), -1, calendar)
  requireValue(start >= availableStart, `共同历史不足，所需基准为 ${start}，可用历史最早为 ${availableStart}`)
  requireValue(start < end, '比较至少需要两个交易日收盘样本')
  let count
  const series = [index, benchmark].map(market => {
    const { rows, expected } = validatedWindow(market.history, start, end, calendar, market.code)
    count = expected.length
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
  return { range, startDate: start, endDate: end, commonEnd, count, returnCount: count - 1,
    calendarId: calendar.id, annualizationSessions: 252, rollingSessions: ROLLING_SESSIONS,
    basis: 'price_index_no_dividend_reinvestment', series,
    returnDifference: series[0].cumulativeReturn - series[1].cumulativeReturn,
  }
}
