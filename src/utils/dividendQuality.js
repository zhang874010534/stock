import { CONSTITUENTS_SOURCE } from '../api/constituents.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS, INDUSTRIES } from './constituentStructure.js'
import { chinaDate } from './etfDistributions.js'
import { dateTimestamp } from './priceRisk.js'

export const FUNDAMENTALS_SOURCE = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
export const DIVIDEND_REPORT = 'RPT_F10_DIVIDEND_HISTOGRAM'
export const FINANCIAL_REPORT = 'RPT_F10_FINANCE_MAINFINADATA'
export const FUNDAMENTALS_BASIS = 'fiscal_year_implemented_company_cash'
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const valueOrNull = value => value === null || Number.isFinite(value)
const canonicalTime = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && Date.parse(value) <= now.getTime()
export const fundamentalYears = (now = new Date()) => { const end = Number(chinaDate(now).slice(0, 4)) - 1; return Array.from({ length: 5 }, (_, i) => end - 4 + i) }
function validateSource(data, years, kind, now) {
  requireValue(data && ['ok', 'stale', 'unavailable'].includes(data.status) && Array.isArray(data.history) && data.history.length <= years.length, '基本面来源状态或历史异常')
  requireValue(canonicalTime(data.lastAttemptAt, now), '基本面来源尝试时间异常')
  requireValue(data.status === 'ok' ? data.reason === null : typeof data.reason === 'string' && Boolean(data.reason.trim()), '基本面来源失败原因缺失')
  if (data.status === 'unavailable') { requireValue(data.lastSuccessAt === null && !data.history.length, '不可用基本面不能带成功记录'); return }
  requireValue(canonicalTime(data.lastSuccessAt, now) && data.lastSuccessAt <= data.lastAttemptAt && (data.status !== 'ok' || data.lastSuccessAt === data.lastAttemptAt), '基本面来源成功时间异常')
  let previous = 0
  for (const row of data.history) {
    requireValue(years.includes(row.year) && row.year > previous && row.reportDate === `${row.year}-12-31` && row.reportDate <= chinaDate(new Date(data.lastSuccessAt)), '基本面报告年度、顺序或未来日期异常')
    if (kind === 'dividends') {
      requireValue([row.cashDividend, row.plannedDividend].every(v => valueOrNull(v) && (v === null || v >= 0)), '分红金额异常')
    } else {
      requireValue([row.parentProfit, row.operatingCashFlow, row.roe].every(valueOrNull) && typeof row.orgType === 'string' && row.orgType.length > 0 && row.orgType.length <= 40, '基本面财务字段异常')
      for (const day of [row.noticeDate, row.updatedDate]) { if (day !== null) { dateTimestamp(day); requireValue(day >= row.reportDate && day <= chinaDate(new Date(data.lastSuccessAt)), '基本面公告或修订日期异常') } }
    }
    previous = row.year
  }
}
export function validateFundamentals(data, { now = new Date() } = {}) {
  requireValue(data?.schemaVersion === 1 && data.code === 'H30269' && data.provider === 'Eastmoney' && data.source === FUNDAMENTALS_SOURCE && data.dividendReport === DIVIDEND_REPORT && data.financialReport === FINANCIAL_REPORT && data.basis === FUNDAMENTALS_BASIS && data.currency === 'CNY' && data.unit === 'CNY', '分红基本面身份、来源或单位异常')
  requireValue(canonicalTime(data.lastAttemptAt, now) && ['ok', 'partial', 'stale', 'unavailable'].includes(data.status), '分红基本面状态或时间异常')
  requireValue(data.status === 'ok' ? data.reason === null : typeof data.reason === 'string' && Boolean(data.reason.trim()), '分红基本面失败原因缺失')
  requireValue(Array.isArray(data.years) && data.years.length === 5 && data.years.every((year, i) => Number.isInteger(year) && year >= 2000 && year < Number(chinaDate(now).slice(0, 4)) && (!i || year === data.years[i - 1] + 1)), '分红基本面年度范围异常')
  requireValue(data.membershipSource === CONSTITUENTS_SOURCE && data.industrySource === INDUSTRY_SOURCE && data.industryBasis === INDUSTRY_BASIS && Array.isArray(data.members), '基本面成分与行业来源异常')
  requireValue(['ok', 'stale', 'unavailable'].includes(data.membershipStatus), '基本面名单状态异常')
  requireValue(data.membershipStatus === 'ok' ? data.membershipReason === null : typeof data.membershipReason === 'string' && Boolean(data.membershipReason.trim()), '基本面名单失败原因缺失')
  if (data.status === 'unavailable') { requireValue(!data.members.length && data.membershipDate === null && data.membershipStatus === 'unavailable', '不可用基本面不能带名单'); return data }
  dateTimestamp(data.membershipDate)
  requireValue(data.members.length === 50 && data.membershipDate <= chinaDate(new Date(data.lastAttemptAt)) && data.membershipStatus !== 'unavailable', '基本面名单数量或日期异常')
  const codes = new Set()
  for (const member of data.members) {
    requireValue(/^\d{6}$/.test(member.code) && ['SSE', 'SZSE'].includes(member.exchange) && !codes.has(member.code) && typeof member.name === 'string' && Boolean(member.name.trim()), '基本面成分股身份重复或异常')
    codes.add(member.code)
    if (member.industry === null) requireValue(member.industryStatus === 'unavailable' && member.industryDate === null && member.industrySourceIndex === null, '未分类股票不能带行业依据')
    else { requireValue(INDUSTRIES[member.industrySourceIndex] === member.industry && ['ok', 'stale'].includes(member.industryStatus), '基本面行业身份异常'); dateTimestamp(member.industryDate); requireValue(member.industryDate <= chinaDate(new Date(data.lastAttemptAt)), '基本面行业日期异常') }
    for (const kind of ['dividends', 'financials']) { validateSource(member[kind], data.years, kind, now); requireValue(member[kind].lastAttemptAt <= data.lastAttemptAt, '个股尝试时间晚于快照') }
  }
  requireValue(data.status !== 'ok' || data.membershipStatus === 'ok' && data.members.every(member => member.dividends.status === 'ok' && member.financials.status === 'ok'), '基本面成功状态与来源不一致')
  return data
}
const sum = (rows, key) => { const values = rows.map(row => row[key]).filter(Number.isFinite); const total = values.reduce((a, b) => a + b, 0); requireValue(Number.isFinite(total), '基本面汇总超出数值范围'); return values.length ? total : null }
const ratio = (a, b) => { if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null; const r = a / b; requireValue(Number.isFinite(r), '基本面比率超出数值范围'); return r }
const financialCompany = (member, financial) => member.industry === '金融' || /银行|证券|保险|金融|信托/.test(financial?.orgType ?? '')
function annual(member, year) {
  const dividend = member.dividends.history.find(row => row.year === year), financial = member.financials.history.find(row => row.year === year)
  const cashDividend = dividend?.cashDividend ?? null, plannedDividend = dividend?.plannedDividend ?? null
  const parentProfit = financial?.parentProfit ?? null, operatingCashFlow = financial?.operatingCashFlow ?? null
  const isFinancial = financialCompany(member, financial)
  const pending = Number.isFinite(cashDividend) && Number.isFinite(plannedDividend) && plannedDividend - cashDividend > Math.max(1, plannedDividend * 1e-8)
  const profitCoverage = ratio(parentProfit, cashDividend), payoutRatio = parentProfit > 0 ? ratio(cashDividend, parentProfit) : null
  const cashCoverage = isFinancial ? null : ratio(operatingCashFlow, cashDividend)
  const coverageReason = cashDividend === null ? '分红金额缺失' : cashDividend === 0 ? '已实施分红为零，无覆盖倍数' : parentProfit === null ? '归母净利润缺失' : parentProfit <= 0 ? '归母净利润非正，支付率不可解释' : ''
  const cashReason = cashDividend === null ? '分红金额缺失' : cashDividend === 0 ? '已实施分红为零，无覆盖倍数' : isFinancial ? '金融企业，现金流覆盖不作通用比较' : operatingCashFlow === null ? '经营现金流缺失' : ''
  return { year, reportDate: `${year}-12-31`, cashDividend, plannedDividend, pending, parentProfit, operatingCashFlow, roe: financial?.roe ?? null, noticeDate: financial?.noticeDate ?? null, updatedDate: financial?.updatedDate ?? null, isFinancial, profitCoverage, payoutRatio, cashCoverage, coverageReason, cashReason }
}
function individual(member, years, year) {
  const history = years.filter(y => y <= year).map(y => annual(member, y)), current = history.at(-1), previous = history.at(-2)
  const missing = history.filter(row => row.cashDividend === null).length
  let streak = 0, streakUnknown = false
  for (const row of [...history].reverse()) { if (row.cashDividend === null) { streakUnknown = true; break } if (row.cashDividend === 0) break; streak++ }
  const change = current.cashDividend === null || previous?.cashDividend == null ? null : current.cashDividend - previous.cashDividend
  const growth = ratio(change, previous?.cashDividend)
  const tolerance = Math.max(1, (previous?.cashDividend ?? 0) * 1e-8)
  const changeKind = change === null ? 'unknown' : current.pending || previous.pending ? 'pending' : previous.cashDividend === 0 ? current.cashDividend > 0 ? 'resumed' : 'zero' : Math.abs(change) <= tolerance ? 'flat' : change > 0 ? 'increase' : 'decrease'
  return { ...member, history, current, change, growth, changeKind, streak, streakUnknown, knownYears: history.length - missing, windowYears: history.length, continuous: missing ? null : history.every(row => row.cashDividend > 0), dividendShare: null }
}
export function analyzeDividendQuality(data, year = data?.years?.at(-1), options = {}) {
  validateFundamentals(data, options)
  requireValue(data.status !== 'unavailable' && data.years.includes(year), '所选分红基本面年度不可用')
  const rows = data.members.map(member => individual(member, data.years, year))
  const known = rows.filter(row => row.current.cashDividend !== null), totalDividend = sum(known.map(row => row.current), 'cashDividend')
  for (const row of rows) row.dividendShare = ratio(row.current.cashDividend, totalDividend)
  const groups = [...new Set(rows.map(row => row.industry))].map(industry => {
    const members = rows.filter(row => row.industry === industry), known = members.filter(row => row.current.cashDividend !== null)
    const dividend = sum(known.map(row => row.current), 'cashDividend')
    return { industry, label: industry ?? '未分类', count: members.length, covered: known.length, dividend, share: ratio(dividend, totalDividend), change: sum(members, 'change'), comparable: members.filter(row => row.change !== null).length, continuous: members.filter(row => row.continuous === true).length }
  }).sort((a, b) => (b.dividend ?? -1) - (a.dividend ?? -1) || a.label.localeCompare(b.label, 'zh-CN'))
  const pairs = rows.filter(row => row.change !== null && row.changeKind !== 'pending')
  const comparableDividend = sum(pairs.map(row => row.current), 'cashDividend'), comparablePrevious = sum(pairs.map(row => row.history.at(-2)), 'cashDividend')
  return { year, startYear: data.years[0], membershipDate: data.membershipDate, rows, groups, total: rows.length, covered: known.length, totalDividend,
    changeCounts: Object.fromEntries(['increase', 'decrease', 'flat', 'resumed', 'zero', 'pending', 'unknown'].map(kind => [kind, rows.filter(row => row.changeKind === kind).length])),
    comparable: pairs.length, comparableGrowth: ratio(comparableDividend === null || comparablePrevious === null ? null : comparableDividend - comparablePrevious, comparablePrevious),
    continuous: rows.filter(row => row.continuous === true).length, continuityKnown: rows.filter(row => row.continuous !== null).length,
    profitKnown: rows.filter(row => row.current.profitCoverage !== null).length, profitCovered: rows.filter(row => row.current.profitCoverage >= 1).length,
    cashKnown: rows.filter(row => row.current.cashCoverage !== null).length, cashCovered: rows.filter(row => row.current.cashCoverage >= 1).length,
    financialCount: rows.filter(row => row.current.isFinancial).length,
    staleSources: rows.reduce((n, row) => n + [row.dividends, row.financials].filter(source => source.status !== 'ok').length, 0),
  }
}
