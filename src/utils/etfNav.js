import { chinaDate } from './etfDistributions.js'
import { dateTimestamp } from './priceRisk.js'

export const ETF_NAV_SOURCE = 'https://fundf10.eastmoney.com/jjjz_512890.html'
export const ETF_NAV_DATA_SOURCE = 'https://fund.eastmoney.com/pingzhongdata/512890.js'
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
export function validateEtfNav(data, { now = new Date() } = {}) {
  requireValue(data?.schemaVersion === 1 && data.code === '512890' && data.provider === 'Eastmoney' && data.source === ETF_NAV_SOURCE && data.dataSource === ETF_NAV_DATA_SOURCE && data.unit === 'CNY_per_share' && data.basis === 'unit_nav', 'ETF 净值身份、来源或单位异常')
  requireValue(['ok', 'stale', 'unavailable'].includes(data.status) && Array.isArray(data.history) && data.history.length <= 20000, 'ETF 净值状态或历史格式异常')
  requireValue(validTime(data.lastAttemptAt) && Date.parse(data.lastAttemptAt) <= now.getTime(), 'ETF 净值尝试时间异常')
  requireValue(data.status === 'ok' ? data.reason === null : typeof data.reason === 'string' && data.reason.trim(), 'ETF 净值失败原因缺失')
  if (data.status === 'unavailable') {
    requireValue(data.date === null && data.lastSuccessAt === null && data.history.length === 0, '不可用净值不能带有效记录')
    return data
  }
  requireValue(validTime(data.lastSuccessAt) && Date.parse(data.lastSuccessAt) <= Date.parse(data.lastAttemptAt) && (data.status !== 'ok' || data.lastAttemptAt === data.lastSuccessAt), 'ETF 净值成功时间异常')
  requireValue(data.history.length >= 2, 'ETF 净值历史不足两个样本')
  let previous = ''
  for (const row of data.history) {
    dateTimestamp(row?.date)
    requireValue(row.date >= '2018-12-19' && row.date > previous && row.date <= chinaDate(new Date(data.lastSuccessAt)) && row.date <= chinaDate(now), 'ETF 净值日期重复、乱序或未来日期')
    requireValue(Number.isFinite(row.nav) && row.nav > 0 && Number.isFinite(row.accumulatedNav) && row.accumulatedNav > 0, 'ETF 净值数值异常')
    previous = row.date
  }
  requireValue(data.date === previous, 'ETF 净值最新日期与历史不一致')
  return data
}
