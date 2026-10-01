import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { validateEtfDistributions, chinaDate } from './etfDistributions.js'
import { dateTimestamp, isSession, tradingSessions } from './priceRisk.js'
import { quantile } from './valuationStats.js'

export const HOLDING_YEARS = [1, 3]
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export function holdingAnniversary(day, years) {
  dateTimestamp(day)
  requireValue(HOLDING_YEARS.includes(years), '仅支持持有一年或三年')
  const year = Number(day.slice(0, 4)) + years, target = `${year}${day.slice(4)}`
  return new Date(Date.parse(`${target}T00:00:00Z`)).toISOString().slice(0, 10) === target ? target : `${year}-02-28`
}
function lowerBound(days, target) {
  let left = 0, right = days.length
  while (left < right) { const middle = (left + right) >>> 1; if (days[middle] < target) left = middle + 1; else right = middle }
  return left
}
export function holdingReturnBins(values) {
  const definitions = [
    ['<-20%', '低于 -20%', value => value < -.2],
    ['-20~-10%', '-20% 至低于 -10%', value => value >= -.2 && value < -.1],
    ['-10~0%', '-10% 至低于 0%', value => value >= -.1 && value < 0],
    ['0%', '恰为 0%', value => value === 0],
    ['0~10%', '大于 0% 至 10%', value => value > 0 && value <= .1],
    ['10~20%', '大于 10% 至 20%', value => value > .1 && value <= .2],
    ['20~50%', '大于 20% 至 50%', value => value > .2 && value <= .5],
    ['>50%', '大于 50%', value => value > .5],
  ]
  return definitions.map(([label, description, test]) => ({ label, description, count: values.filter(test).length }))
}

// A share bought at the entry close is entitled only to subsequent ex-dates
// whose record dates include that entry. Cash is held, never reinvested.
function windowReturn(buy, exit, distribution, basis) {
  const splits = distribution?.splits.filter(item => item.date > buy.date && item.date <= exit.date) ?? []
  const sharesAt = day => splits.filter(item => item.date <= day).reduce((shares, item) => shares * item.ratio, 1)
  const shares = sharesAt(exit.date), marketValue = shares * exit.close
  const dividends = basis === 'cash' ? distribution.dividends.filter(item => item.recordDate >= buy.date && item.exDate > buy.date && item.exDate <= exit.date) : []
  let income = 0, received = 0
  for (const item of dividends) {
    const amount = item.cashPerShare * sharesAt(item.recordDate)
    income += amount; if (item.payDate <= exit.date) received += amount
  }
  const raw = (marketValue + income) / buy.close - 1
  requireValue([shares, marketValue, income, received, raw].every(Number.isFinite), '持有期计算结果超出数值范围')
  return { shares, marketValue, income, received, receivable: Math.max(0, income - received),
    priceReturn: marketValue / buy.close - 1, cashReturn: income / buy.close, returnRate: Math.abs(raw) < 1e-12 ? 0 : raw }
}

function summarize(years, points, counts) {
  const windows = points.filter(point => point.status === 'complete'), values = windows.map(point => point.returnRate).sort((a, b) => a - b)
  let best = null, worst = null
  for (const point of windows) {
    if (!best || point.returnRate > best.returnRate) best = point
    if (!worst || point.returnRate < worst.returnRate) worst = point
  }
  const positive = values.filter(value => value > 0).length, negative = values.filter(value => value < 0).length, flat = values.length - positive - negative
  return { years, points, windows, count: values.length, ...counts, positive, negative, flat,
    positiveRate: values.length ? positive / values.length : null, negativeRate: values.length ? negative / values.length : null,
    mean: values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null,
    p10: quantile(values, .1), p25: quantile(values, .25), median: quantile(values, .5), p75: quantile(values, .75), p90: quantile(values, .9),
    best, worst, bins: holdingReturnBins(values), firstBuyDate: windows[0]?.buyDate ?? null, lastBuyDate: windows.at(-1)?.buyDate ?? null }
}

export function calculateHoldingPeriods(market, { basis = market?.code === '512890' ? 'cash' : 'price', distribution, calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(['H30269', '512890'].includes(market?.code), '持有期分析证券不受支持')
  validateMarketData(market, market.code)
  requireValue(market.source === 'eastmoney', '行情来源异常')
  requireValue(['price', 'cash'].includes(basis) && (market.code === '512890' || basis === 'price'), '指数仅支持价格收益')
  const localTime = new Date(now.getTime() + 8 * 3600000).toISOString()
  requireValue(market.latest.date <= chinaDate(now), '行情文件含未来日期')
  requireValue(market.latest.date !== localTime.slice(0, 10) || localTime.slice(11, 16) >= '15:00', '当日行情尚未收盘')
  let events = null, start = [market.history[0].date, calendar.start].sort().at(-1), end = [market.latest.date, calendar.end].sort()[0]
  if (market.code === '512890') {
    validateEtfDistributions(distribution, { now })
    requireValue(distribution.status !== 'unavailable', 'ETF 分红／拆分档案不可用，不能按零事件计算')
    start = [start, distribution.coverage.start].sort().at(-1); end = [end, distribution.coverage.end].sort()[0]
    events = distribution
    const dividends = distribution.dividends.filter(item => item.exDate > start && item.exDate <= end)
    requireValue(dividends.every(item => item.recordDate < item.exDate) && !dividends.some(item => distribution.splits.some(split => split.date === item.recordDate || split.date === item.exDate)), '分红与登记／拆分同日，须核验权益口径')
  }
  requireValue(start <= end, '暂无行情与日历、分红核验范围的交集')
  const days = tradingSessions(start, end, calendar)
  requireValue(days.length >= 2, '核验范围至少需要两个交易日')
  const rows = market.history.filter(row => row.date >= start && row.date <= end)
  requireValue(rows.every(row => isSession(row.date, calendar)), '核验区间内含非交易日行情')
  const quotes = new Map(rows.map(row => [row.date, row])), missingPrefix = [0]
  for (const day of days) missingPrefix.push(missingPrefix.at(-1) + (quotes.has(day) ? 0 : 1))
  const series = HOLDING_YEARS.map(years => {
    const points = []; let immatureCount = 0, missingCount = 0
    for (let i = 0; i < days.length; i++) {
      const buyDate = days[i], targetDate = holdingAnniversary(buyDate, years), exitIndex = lowerBound(days, targetDate)
      if (exitIndex === days.length) { immatureCount++; continue }
      const exitDate = days[exitIndex]
      if (missingPrefix[exitIndex + 1] - missingPrefix[i] > 0) {
        missingCount++; points.push({ buyDate, targetDate, exitDate, returnRate: null, status: 'missing' }); continue
      }
      const buy = quotes.get(buyDate), exit = quotes.get(exitDate)
      points.push({ buyDate, targetDate, exitDate, buyClose: buy.close, exitClose: exit.close,
        holdingDays: (dateTimestamp(exitDate) - dateTimestamp(buyDate)) / 86400000, status: 'complete', ...windowReturn(buy, exit, events, basis) })
    }
    return summarize(years, points, { immatureCount, missingCount, candidateCount: days.length })
  })
  return { code: market.code, basis, sourceDate: market.latest.date, startDate: days[0], endDate: days.at(-1), count: days.length,
    missingSessions: missingPrefix.at(-1), excludedBefore: market.history.filter(row => row.date < start).length,
    excludedAfter: market.history.filter(row => row.date > end).length, backfillCompleted: market.backfill.completed,
    distributionCoverage: market.code === '512890' ? distribution.coverage : null, series }
}
