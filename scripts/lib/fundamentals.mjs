import { FUNDAMENTALS_SOURCE, DIVIDEND_REPORT, FINANCIAL_REPORT } from '../../src/utils/dividendQuality.js'
import { chinaDate } from '../../src/utils/etfDistributions.js'
import { dateTimestamp } from '../../src/utils/priceRisk.js'

export function fundamentalUrl(member, kind, years) {
  if (!/^\d{6}$/.test(member.code) || !['SSE', 'SZSE'].includes(member.exchange) || !['dividends', 'financials'].includes(kind)) throw new Error('基本面请求身份异常')
  const url = new URL(FUNDAMENTALS_SOURCE)
  url.search = new URLSearchParams({ reportName: kind === 'dividends' ? DIVIDEND_REPORT : FINANCIAL_REPORT,
    columns: kind === 'dividends' ? 'SECUCODE,SECURITY_CODE,REPORT_DATE,DIVIDEND_IMPLE,DIVIDEND_PLAN' : 'SECUCODE,SECURITY_CODE,ORG_TYPE,REPORT_DATE,NOTICE_DATE,UPDATE_DATE,CURRENCY,PARENTNETPROFIT,NETCASH_OPERATE_PK,ROEJQ',
    filter: `(SECUCODE="${member.code}.${member.exchange === 'SSE' ? 'SH' : 'SZ'}")(REPORT_DATE>='${years[0]}-01-01')(REPORT_DATE<='${years.at(-1)}-12-31')`,
    pageSize: '100', pageNumber: '1', sortColumns: 'REPORT_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB' })
  return url
}
function day(value, label, now, nullable = false) {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/.test(value)) throw new Error(`${label}格式异常`)
  const date = value.slice(0, 10); dateTimestamp(date)
  if (date > chinaDate(now)) throw new Error(`${label}为未来日期`)
  return date
}
function number(value, name, nonnegative = false) {
  if (value === null) return null
  if (!Number.isFinite(value) || (nonnegative && value < 0)) throw new Error(`${name}数值异常`)
  return value
}
export function parseFundamentalReport(payload, member, kind, years, now = new Date()) {
  const result = payload?.result
  if (payload?.success !== true || payload.code !== 0 || !result || !Array.isArray(result.data) || result.data.length > 100 || result.pages > 1 || result.count !== result.data.length) throw new Error('基本面来源失败、结构变化或返回不完整')
  const history = [], seen = new Set()
  for (const row of result.data) {
    if (row.SECURITY_CODE !== member.code || row.SECUCODE !== `${member.code}.${member.exchange === 'SSE' ? 'SH' : 'SZ'}`) throw new Error('基本面来源证券或交易所不匹配')
    const reportDate = day(row.REPORT_DATE, '报告日期', now)
    const year = Number(reportDate.slice(0, 4))
    if (!years.includes(year)) throw new Error('基本面来源超出请求年度')
    if (!reportDate.endsWith('-12-31')) continue
    if (seen.has(year)) throw new Error('基本面来源年度重复')
    seen.add(year)
    if (kind === 'dividends') history.push({ year, reportDate, cashDividend: number(row.DIVIDEND_IMPLE, '已实施分红', true), plannedDividend: number(row.DIVIDEND_PLAN, '计划分红', true) })
    else {
      if (row.CURRENCY !== 'CNY' || typeof row.ORG_TYPE !== 'string' || !row.ORG_TYPE.trim() || row.ORG_TYPE.length > 40) throw new Error('财务币种或企业类型异常')
      const noticeDate = day(row.NOTICE_DATE, '公告日期', now, true), updatedDate = day(row.UPDATE_DATE, '修订日期', now, true)
      if ([noticeDate, updatedDate].some(date => date !== null && date < reportDate)) throw new Error('公告或修订早于报告期')
      history.push({ year, reportDate, noticeDate, updatedDate,
        parentProfit: number(row.PARENTNETPROFIT, '归母净利润'), operatingCashFlow: number(row.NETCASH_OPERATE_PK, '经营现金流'), roe: number(row.ROEJQ, '净资产收益率'), orgType: row.ORG_TYPE })
    }
  }
  return history.sort((a, b) => a.year - b.year)
}
