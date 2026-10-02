import { validateMarketData } from './kline.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { anniversary, dateTimestamp, isSession, shiftDay, tradingDate, tradingSessions } from './priceRisk.js'
import { chinaDate } from './etfDistributions.js'

export const ETF_SIZE_SOURCE = 'https://fund.eastmoney.com/512890.html'
export const ETF_SIZE_DATA_SOURCE = 'https://fund.eastmoney.com/pingzhongdata/512890.js'
export const ETF_FEE_SOURCE = 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-18/512890_20260318_FNWM.pdf'
export const LIQUIDITY_RANGES = [{ key: '30d', label: '近30日' }, { key: 'year', label: '近1年' }, { key: 'ytd', label: '年初至今' }, { key: 'all', label: '全部可用历史' }, { key: 'custom', label: '自定义' }]
const requireValue = (value, message) => { if (!value) throw new Error(message) }
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export function validateEtfSize(data, { now = new Date() } = {}) {
  requireValue(data?.schemaVersion === 1 && data.code === '512890' && data.provider === 'Eastmoney' && data.source === ETF_SIZE_SOURCE && data.dataSource === ETF_SIZE_DATA_SOURCE && data.unit === 'CNY' && data.basis === 'reported_net_assets', 'ETF 规模身份、来源或单位异常')
  requireValue(['ok', 'stale', 'unavailable'].includes(data.status) && Array.isArray(data.history) && data.history.length <= 1000, 'ETF 规模状态或历史异常')
  requireValue(time(data.lastAttemptAt) && Date.parse(data.lastAttemptAt) <= now.getTime(), 'ETF 规模尝试时间异常')
  requireValue(data.status === 'ok' ? data.reason === null : typeof data.reason === 'string' && data.reason.trim(), 'ETF 规模失败原因缺失')
  if (data.status === 'unavailable') {
    requireValue(data.date === null && data.lastSuccessAt === null && !data.history.length, '不可用规模不能带有效记录')
    return data
  }
  requireValue(time(data.lastSuccessAt) && Date.parse(data.lastSuccessAt) <= Date.parse(data.lastAttemptAt) && (data.status !== 'ok' || data.lastAttemptAt === data.lastSuccessAt), 'ETF 规模成功时间异常')
  requireValue(data.history.length > 0, 'ETF 规模记录为空')
  let previous = ''
  for (const row of data.history) {
    dateTimestamp(row?.date)
    requireValue(row.date >= '2018-12-19' && row.date > previous && row.date <= chinaDate(new Date(data.lastSuccessAt)) && row.date <= chinaDate(now), 'ETF 规模日期乱序、重复或未来日期')
    requireValue(Number.isFinite(row.netAssets) && row.netAssets > 0 && row.netAssets <= 1e14, 'ETF 规模数值异常')
    previous = row.date
  }
  requireValue(data.date === previous, 'ETF 规模最新日期与历史不一致')
  return data
}
export function validateEtfFees(data, { now = new Date() } = {}) {
  requireValue(data?.schemaVersion === 1 && data.code === '512890' && data.source === ETF_FEE_SOURCE && data.unit === 'annual_fraction' && data.basis === 'disclosed_management_custody', 'ETF 费率身份、来源或单位异常')
  dateTimestamp(data.documentDate); dateTimestamp(data.verifiedDate)
  requireValue(data.documentDate >= '2018-12-19' && data.documentDate <= data.verifiedDate && data.verifiedDate <= chinaDate(now), 'ETF 费率资料或核验日期异常')
  requireValue([data.management, data.custody].every(value => Number.isFinite(value) && value >= 0 && value <= .05), 'ETF 运作费率异常')
  return data
}
export function calculateEtfLiquidity(market, { range = 'year', start, end, now = new Date(), calendar = tradingCalendar } = {}) {
  validateMarketData(market, '512890')
  requireValue(market.source === 'eastmoney' && market.latest.date <= chinaDate(now), 'ETF 行情来源或未来日期异常')
  requireValue(LIQUIDITY_RANGES.some(item => item.key === range), '流动性区间无效')
  const local = new Date(now.getTime() + 8 * 3600000).toISOString(), cutoff = local.slice(11, 16) < '15:00' ? shiftDay(local.slice(0, 10), -1) : local.slice(0, 10)
  const availableStart = [market.history[0].date, calendar.start].sort().at(-1)
  let endDate = tradingDate([market.latest.date, cutoff].sort()[0], -1, calendar), startDate
  if (range === 'custom') {
    dateTimestamp(start); dateTimestamp(end)
    requireValue(start <= end, '开始日期不能晚于结束日期')
    requireValue(end <= endDate, `结束日期不能晚于分析截止日 ${endDate}`)
    startDate = tradingDate(start, 1, calendar); endDate = tradingDate(end, -1, calendar)
    requireValue(startDate >= availableStart, `开始日期超出可用历史（最早 ${availableStart}）`)
  } else {
    const target = range === 'all' ? availableStart : range === 'ytd' ? `${endDate.slice(0, 4)}-01-01` : range === '30d' ? shiftDay(endDate, -30) : anniversary(endDate, 1)
    startDate = tradingDate([target, availableStart].sort().at(-1), 1, calendar)
  }
  requireValue(startDate <= endDate, '所选区间没有可用交易日')
  // Warm up using actual sessions. Missing sessions or fields leave a full
  // 20-session average blank; do not replace them with older observations.
  let warmup = startDate, remaining = 19
  while (remaining && warmup > calendar.start) { warmup = shiftDay(warmup, -1); if (isSession(warmup, calendar)) remaining-- }
  const dates = tradingSessions(warmup, endDate, calendar), sessions = new Set(dates), rows = new Map(market.history.map(row => [row.date, row]))
  requireValue(market.history.filter(row => row.date >= warmup && row.date <= endDate).every(row => sessions.has(row.date)), 'ETF 行情包含非交易日记录')
  const windows = { amount: [], turnover: [] }, all = dates.map(date => {
    const row = rows.get(date), point = { date, amount: row?.amount ?? null, turnover: row?.turnover ?? null }
    for (const key of ['amount', 'turnover']) {
      const window = windows[key]; window.push(point[key]); if (window.length > 20) window.shift()
      point[`${key}20`] = window.length === 20 && window.every(value => value !== null) ? window.reduce((a, b) => a + b, 0) / 20 : null
    }
    return point
  })
  const points = all.filter(point => point.date >= startDate)
  const amounts = points.filter(point => point.amount !== null), turnovers = points.filter(point => point.turnover !== null)
  const average = (items, key) => items.length ? items.reduce((sum, row) => sum + row[key], 0) / items.length : null
  const current = points.at(-1)
  return { startDate, endDate, points, current, count: points.length, amountCount: amounts.length, turnoverCount: turnovers.length,
    missingSessions: points.filter(point => !rows.has(point.date)).length, missingAmount: points.length - amounts.length, missingTurnover: points.length - turnovers.length,
    averageAmount: average(amounts, 'amount'), averageTurnover: average(turnovers, 'turnover'), totalAmount: amounts.length ? amounts.reduce((sum, row) => sum + row.amount, 0) : null,
    minimum: amounts.length ? amounts.reduce((a, b) => a.amount <= b.amount ? a : b) : null,
    maximum: amounts.length ? amounts.reduce((a, b) => a.amount >= b.amount ? a : b) : null,
    zeroAmountDays: amounts.filter(point => point.amount === 0).length,
    amountVs20: current.amount20 > 0 && current.amount !== null ? current.amount / current.amount20 : null,
    historyStart: market.history[0].date, clipped: range !== 'all' && range !== 'custom' && (range === 'year' ? anniversary(endDate, 1) : range === 'ytd' ? `${endDate.slice(0, 4)}-01-01` : shiftDay(endDate, -30)) < availableStart,
  }
}
export function estimateEtfCost({ amount, commissionBps, minimumCommission, days }, fees, averageAmount) {
  requireValue(Number.isFinite(amount) && amount > 0 && amount <= 1e12 && Number.isFinite(commissionBps) && commissionBps >= 0 && commissionBps <= 100 && Number.isFinite(minimumCommission) && minimumCommission >= 0 && minimumCommission <= 1e6 && Number.isInteger(days) && days >= 0 && days <= 36500, '成本假设无效，请填写有效金额、佣金、最低收费和持有天数')
  validateEtfFees(fees)
  const perOrder = Math.max(amount * commissionBps / 10000, minimumCommission)
  return { perOrder, equalRoundTrip: perOrder * 2, managementCustody: amount * (fees.management + fees.custody) * days / 365,
    participation: averageAmount > 0 ? amount / averageAmount : null }
}
