import { marketSummary } from './marketSummary.js'
import { isTradingDay } from './latestMetrics.js'

export const ETF_DISTRIBUTION_SOURCE = 'https://fundf10.eastmoney.com/fhsp_512890.html'
export const ETF_RETURN_RULE = 'etf-market-cash-hold-v1'
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export const chinaDate = (now = new Date()) => new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10)
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function validateEtfDistributions(data, { now = new Date() } = {}) {
  requireValue(data?.schemaVersion === 1 && data.code === '512890' && data.source === ETF_DISTRIBUTION_SOURCE && data.unit === 'CNY_per_share', 'ETF 分红数据身份或单位异常')
  requireValue(['ok', 'stale', 'unavailable'].includes(data.status), 'ETF 分红状态异常')
  requireValue(Array.isArray(data.dividends) && Array.isArray(data.splits), 'ETF 分红或拆分记录异常')
  requireValue(data.status === 'ok' || (typeof data.reason === 'string' && data.reason.trim()), 'ETF 分红失败原因缺失')
  if (data.status === 'unavailable') {
    requireValue(data.coverage === null && data.checkedAt === null && !data.dividends.length && !data.splits.length, '不可用分红不能带有有效记录')
    return data
  }
  const coverage = data.coverage
  requireValue(coverage?.start === '2018-12-19' && validDate(coverage.end) && coverage.end >= coverage.start && coverage.end <= chinaDate(now), 'ETF 分红核验范围异常')
  requireValue(typeof data.checkedAt === 'string' && Number.isFinite(Date.parse(data.checkedAt)) && new Date(data.checkedAt).toISOString() === data.checkedAt && chinaDate(data.checkedAt) === coverage.end, 'ETF 分红核验时间异常')
  let lastDate = ''
  for (const item of data.dividends) {
    requireValue(validDate(item?.recordDate) && validDate(item.exDate) && validDate(item.payDate) && item.recordDate <= item.exDate && item.exDate <= item.payDate, 'ETF 分红日期异常')
    requireValue(item.recordDate >= coverage.start && item.exDate > lastDate && Number.isFinite(item.cashPerShare) && item.cashPerShare > 0, 'ETF 分红重复、乱序或金额异常')
    lastDate = item.exDate
  }
  lastDate = ''
  for (const item of data.splits) {
    requireValue(validDate(item?.date) && item.date >= coverage.start && item.date > lastDate && Number.isFinite(item.ratio) && item.ratio > 0 && item.ratio !== 1, 'ETF 拆分日期或比例异常')
    lastDate = item.date
  }
  return data
}

export function etfReturnHistory(history, range = 'all') {
  if (!history.length || range === 'all') return history
  const end = history.at(-1).date
  let target
  if (range === 'ytd') {
    const summary = marketSummary(history)
    requireValue(!summary.ytdReason, summary.ytdReason)
    return history.slice(history.findIndex(row => row.date === summary.baseDate))
  }
  if (range === 'year') {
    const year = Number(end.slice(0, 4)) - 1
    target = `${year}${end.slice(4)}`
    if (!validDate(target)) target = `${year}-02-28`
  } else throw new Error('不支持的收益区间')
  while (!isTradingDay(target)) target = new Date(Date.parse(`${target}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const index = history.findIndex(row => row.date === target)
  requireValue(index >= 0, '已同步历史未覆盖所选收益基准')
  return history.slice(index)
}

// Buy one share at the first observed close, then hold shares and cash without
// reinvesting. Ex-date recognizes the entitlement; pay-date moves it to cash.
export function calculateEtfReturn(history, distribution, { now = new Date() } = {}) {
  validateEtfDistributions(distribution, { now })
  requireValue(distribution.status !== 'unavailable', 'ETF 分红记录尚不可用，不能按零分红计算')
  requireValue(Array.isArray(history) && history.length >= 2, '至少需要两个收盘样本')
  let previous = ''
  for (const row of history) {
    requireValue(validDate(row?.date) && row.date > previous && Number.isFinite(row.close) && row.close > 0, '行情日期、顺序或收盘价异常')
    previous = row.date
  }
  const start = history[0], end = history.at(-1)
  requireValue(start.date >= distribution.coverage.start && end.date <= distribution.coverage.end, '分红核验范围未覆盖行情区间，请更新分红记录')
  const splits = distribution.splits.filter(item => item.date > start.date && item.date <= end.date)
  const dividends = distribution.dividends.filter(item => item.exDate > start.date && item.exDate <= end.date)
  // A same-day split/dividend requires official ordering and per-share basis.
  requireValue(!dividends.some(item => splits.some(split => split.date === item.exDate || split.date === item.recordDate)), '分红与拆分同日，需核验金额及份额口径')
  const eligible = dividends.filter(item => item.recordDate >= start.date).map(item => ({ ...item,
    shares: splits.filter(split => split.date <= item.recordDate).reduce((value, split) => value * split.ratio, 1) }))
  let shares = 1, splitIndex = 0, dividendIndex = 0, cash = 0
  const points = history.map(row => {
    while (splitIndex < splits.length && splits[splitIndex].date <= row.date) shares *= splits[splitIndex++].ratio
    while (dividendIndex < eligible.length && eligible[dividendIndex].exDate <= row.date) {
      const item = eligible[dividendIndex++]; cash += item.cashPerShare * item.shares
    }
    const marketValue = shares * row.close
    requireValue(Number.isFinite(marketValue + cash), '收益计算超出有效范围')
    return { date: row.date, close: row.close, shares, cash, priceReturn: marketValue / start.close - 1, cashReturn: cash / start.close, totalReturn: (marketValue + cash) / start.close - 1 }
  })
  const received = eligible.filter(item => item.payDate <= end.date).reduce((sum, item) => sum + item.cashPerShare * item.shares, 0)
  return { ruleVersion: ETF_RETURN_RULE, startDate: start.date, endDate: end.date, basePrice: start.close,
    points, current: points.at(-1), received, receivable: Math.max(0, cash - received), count: eligible.length, splits: splits.length }
}
