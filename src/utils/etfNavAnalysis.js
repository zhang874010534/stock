import { validateEtfNav } from './etfNav.js'
import { chinaDate, validateEtfDistributions } from './etfDistributions.js'
import { validateMarketData } from './kline.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { annualizedVolatility, anniversary, shiftDay, tradingDate, tradingSessions, validatedWindow } from './priceRisk.js'

export const ETF_NAV_RANGES = [{ key: '30d', label: '近30日' }, { key: 'year', label: '近1年' }, { key: 'ytd', label: '年初至今' }, { key: 'all', label: '全部可用历史' }, { key: 'custom', label: '自定义' }]
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
function validateMarket(market, code, now) {
  validateMarketData(market, code)
  requireValue(market.source === 'eastmoney' && market.latest.date <= chinaDate(now), `${code} 行情来源或未来日期异常`)
}
function period(firstDates, latestDates, { range = 'year', start: requestedStart, end: requestedEnd, calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(ETF_NAV_RANGES.some(item => item.key === range), '净值分析区间无效')
  const local = new Date(now.getTime() + 8 * 3600000).toISOString()
  const cutoff = local.slice(11, 16) < '15:00' ? shiftDay(local.slice(0, 10), -1) : local.slice(0, 10)
  const availableStart = [...firstDates, calendar.start].sort().at(-1)
  const latest = [latestDates.sort().at(-1), cutoff].sort()[0]
  requireValue(latest <= calendar.end, '交易日历未覆盖净值分析截止日')
  let end = tradingDate(latest, -1, calendar), start
  if (range === 'all') start = tradingDate(availableStart, 1, calendar)
  else if (range === 'custom') {
    shiftDay(requestedStart, 0); shiftDay(requestedEnd, 0)
    requireValue(requestedStart <= requestedEnd, '开始日期不能晚于结束日期')
    requireValue(requestedEnd <= latest, `结束日期不能晚于分析截止日 ${latest}`)
    start = tradingDate(requestedStart, 1, calendar); end = tradingDate(requestedEnd, -1, calendar)
  } else {
    const target = range === 'ytd' ? shiftDay(`${end.slice(0, 4)}-01-01`, -1) : range === '30d' ? shiftDay(end, -30) : anniversary(end, 1)
    start = tradingDate(target, -1, calendar)
  }
  requireValue(start >= availableStart, `净值分析基准 ${start} 超出共同可用历史（最早 ${availableStart}），请调整区间`)
  requireValue(start <= end, '所选区间没有共同可用交易日')
  return { range, startDate: start, endDate: end, calendar }
}

export function calculateEtfPremium(market, nav, options = {}) {
  const now = options.now ?? new Date(), calendar = options.calendar ?? tradingCalendar
  validateMarket(market, '512890', now); validateEtfNav(nav, { now })
  requireValue(nav.status !== 'unavailable', 'ETF 净值不可用，不能计算折溢价')
  const selection = period([market.history[0].date, nav.history[0].date], [market.latest.date, nav.date], { ...options, now, calendar })
  const dates = tradingSessions(selection.startDate, selection.endDate, calendar), dateSet = new Set(dates)
  requireValue(market.history.filter(row => row.date >= selection.startDate && row.date <= selection.endDate).every(row => dateSet.has(row.date)), 'ETF 行情区间内含非交易日记录')
  const prices = new Map(market.history.map(row => [row.date, row.close])), values = new Map(nav.history.map(row => [row.date, row.nav]))
  const points = dates.map(date => {
    const close = prices.get(date) ?? null, unitNav = values.get(date) ?? null
    const premium = close !== null && unitNav !== null ? close / unitNav - 1 : null
    requireValue(premium === null || Number.isFinite(premium), '折溢价结果超出数值范围')
    return { date, close, nav: unitNav, premium }
  })
  const aligned = points.filter(point => point.premium !== null)
  requireValue(aligned.length, '所选区间没有同日收盘价与净值样本')
  return { ...selection, points, count: points.length, alignedCount: aligned.length, missingCount: points.length - aligned.length, current: aligned.at(-1),
    average: aligned.reduce((sum, point) => sum + point.premium, 0) / aligned.length,
    maximum: aligned.reduce((a, b) => a.premium >= b.premium ? a : b), minimum: aligned.reduce((a, b) => a.premium <= b.premium ? a : b),
    priceDate: market.latest.date, navDate: nav.date, navStatus: nav.status }
}

export function calculateNavTracking(nav, index, distribution, options = {}) {
  const now = options.now ?? new Date(), calendar = options.calendar ?? tradingCalendar
  validateEtfNav(nav, { now }); requireValue(nav.status !== 'unavailable', 'ETF 净值不可用，不能计算跟踪偏离')
  validateMarket(index, 'H30269', now)
  const selection = period([nav.history[0].date, index.history[0].date], [nav.date, index.latest.date], { ...options, now, calendar })
  requireValue(selection.startDate < selection.endDate, '跟踪偏离至少需要两个交易日样本')
  validateEtfDistributions(distribution, { now })
  requireValue(distribution.status !== 'unavailable', '拆分档案不可用，不能计算净值跟踪偏离')
  requireValue(selection.startDate >= distribution.coverage.start && selection.endDate <= distribution.coverage.end, '拆分核验范围未覆盖净值跟踪区间')
  // Funds may publish audited valuations on non-trading reporting dates.
  // Keep these in the source archive, but only compare exchange sessions.
  const sessions = new Set(tradingSessions(selection.startDate, selection.endDate, calendar))
  const { rows: values } = validatedWindow(nav.history.filter(row => sessions.has(row.date)), selection.startDate, selection.endDate, calendar, 'ETF 净值')
  const { rows: benchmark } = validatedWindow(index.history, selection.startDate, selection.endDate, calendar, 'H30269 指数')
  const splits = distribution.splits.filter(split => split.date > selection.startDate && split.date <= selection.endDate)
  let shares = 1, previousFund, previousIndex
  const dailyDifferences = []
  const points = values.map((row, i) => {
    for (const split of splits) if (split.date > (values[i - 1]?.date ?? selection.startDate) && split.date <= row.date) shares *= split.ratio
    const fundValue = row.nav * shares, indexValue = benchmark[i].close
    const navReturn = fundValue / values[0].nav - 1, indexReturn = indexValue / benchmark[0].close - 1
    const dailyDifference = i ? fundValue / previousFund - indexValue / previousIndex : null
    if (dailyDifference !== null) dailyDifferences.push(dailyDifference)
    requireValue([fundValue, navReturn, indexReturn, navReturn - indexReturn].every(Number.isFinite) && (dailyDifference === null || Number.isFinite(dailyDifference)), '跟踪偏离结果超出数值范围')
    previousFund = fundValue; previousIndex = indexValue
    return { date: row.date, nav: row.nav, indexClose: indexValue, navReturn, indexReturn, deviation: navReturn - indexReturn, dailyDifference }
  })
  const current = points.at(-1)
  return { ...selection, points, current, count: points.length, returnCount: dailyDifferences.length,
    annualizedDifferenceVolatility: annualizedVolatility(dailyDifferences),
    meanDailyDifference: dailyDifferences.reduce((sum, value) => sum + value, 0) / dailyDifferences.length,
    navDate: nav.date, indexDate: index.latest.date, navStatus: nav.status, distributionStatus: distribution.status, splitCount: splits.length,
    basis: 'split_adjusted_nav_price_vs_H30269_price_no_cash_reinvestment' }
}
