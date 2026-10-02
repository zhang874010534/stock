import { ledgerAccounting, ledgerDocument, localDate } from './portfolioLedger.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { dateTimestamp, isSession, tradingSessions } from './priceRisk.js'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const covered = (date, calendar) => date >= calendar.start && date <= calendar.end

// Replay the same accounting rows as the ledger. No personal cash account is
// inferred: sale proceeds leave the security, and dividends require real entries.
export function calculatePortfolioHistory(entries, market, { now = new Date(), calendar = tradingCalendar } = {}) {
  const accounting = ledgerAccounting(ledgerDocument(entries, { now }).entries)
  if (!accounting.rows.length) return { points: [], warnings: [], startDate: null, endDate: null, missingCount: 0 }
  const warnings = [], today = localDate(now)
  const closedToday = new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16) >= '15:00'
  let quotes = []
  try {
    requireValue(market?.code === '512890' && market.source === 'eastmoney' && market.interval === '1d', '暂无有效的 512890 日线行情')
    requireValue(Array.isArray(market.history) && market.history.length > 0, '暂无日线历史')
    let previous = ''
    for (const row of market.history) {
      dateTimestamp(row.date)
      requireValue(row.date > previous && row.date <= today, '行情日期重复、乱序或晚于今天')
      requireValue(Number.isFinite(row.close) && row.close > 0 && row.close <= 1000000, '历史收盘价无效')
      requireValue(!covered(row.date, calendar) || isSession(row.date, calendar), '历史行情含非交易日')
      previous = row.date
    }
    const latest = market.history.at(-1)
    requireValue(market.latest?.date === latest.date && market.latest.close === latest.close, '最新行情与历史末条不一致')
    quotes = market.history.filter(row => row.date < today || closedToday)
    if (quotes.length !== market.history.length) warnings.push('当日尚未收盘，历史曲线不使用当日价格。')
  } catch (error) { warnings.push(`${error.message}；仍展示可核算的记账数据，持仓期间暂停估值。`) }

  const startDate = accounting.rows[0].date
  const quoteEnd = quotes.at(-1)?.date ?? null
  const endDate = [accounting.rows.at(-1).date, quoteEnd].filter(Boolean).sort().at(-1)
  const dates = new Set(accounting.rows.map(row => row.date))
  for (const row of quotes) if (row.date >= startDate) dates.add(row.date)
  // Add known missing sessions inside the observed market window. Outside that
  // window only actual ledger dates are available, never a carried-forward price.
  if (quotes.length) {
    const sessionStart = [startDate, quotes[0].date, calendar.start].sort().at(-1)
    const sessionEnd = [quoteEnd, calendar.end].sort()[0]
    if (sessionStart <= sessionEnd) for (const date of tradingSessions(sessionStart, sessionEnd, calendar)) dates.add(date)
    if (startDate < quotes[0].date) warnings.push(`行情历史从 ${quotes[0].date} 开始；此前仅列实际记账日期，持仓市值与盈亏不能补算。`)
  }
  if (quoteEnd && accounting.rows.at(-1).date > quoteEnd) warnings.push(`有记录晚于最后已收盘行情 ${quoteEnd}；后续仅列实际记账日期，持仓期间等待行情更新。`)
  if (startDate < calendar.start || endDate > calendar.end) warnings.push('交易日历未覆盖部分历史；覆盖外仅使用真实行情与记账日期，无法核验缺失交易日。')

  const prices = new Map(quotes.map(row => [row.date, row.close]))
  let cursor = 0, state = { shares: 0, cost: 0, realized: 0, dividends: 0, otherFees: 0, fees: 0, invested: 0, proceeds: 0 }
  const points = [...dates].sort().map(date => {
    let entryCount = 0
    while (cursor < accounting.rows.length && accounting.rows[cursor].date <= date) {
      state = accounting.rows[cursor++]; entryCount++
    }
    const close = prices.get(date) ?? null
    const marketValue = state.shares === 0 ? 0 : close === null ? null : state.shares * close
    const unrealized = marketValue === null ? null : marketValue - state.cost
    const totalProfit = unrealized === null ? null : state.realized + unrealized + state.dividends - state.otherFees
    return { date, close, shares: state.shares, cost: state.cost, realized: state.realized,
      unrealized, marketValue, totalProfit, invested: state.invested, dividends: state.dividends,
      fees: state.fees, feeImpact: -state.fees, proceeds: state.proceeds, otherFees: state.otherFees, entryCount,
      valuationReason: marketValue === null ? (date === today && !closedToday ? '当日尚未收盘' : '缺少当日收盘价') : '' }
  })
  const missingCount = points.filter(point => point.marketValue === null).length
  if (missingCount) warnings.push(`${missingCount} 个日期持仓期间缺少已收盘行情，市值与累计盈亏保留断点，不沿用前日价格。`)
  return { points, warnings, startDate, endDate, quoteEnd, missingCount }
}

export function selectPortfolioHistory(stats, range = 'all') {
  requireValue(['all', 'year', 'ytd'].includes(range), '个人收益区间无效')
  if (!stats.points.length || range === 'all') return stats
  let start = `${stats.endDate.slice(0, 4)}-01-01`
  if (range === 'year') {
    const date = new Date(`${stats.endDate}T00:00:00Z`), month = date.getUTCMonth()
    date.setUTCFullYear(date.getUTCFullYear() - 1)
    if (date.getUTCMonth() !== month) date.setUTCDate(0)
    start = date.toISOString().slice(0, 10)
  }
  const points = stats.points.filter(point => point.date >= start)
  return { ...stats, points, startDate: points[0]?.date ?? null, missingCount: points.filter(point => point.marketValue === null).length }
}

export function portfolioHistoryCsv(stats) {
  const fields = ['date', 'close', 'shares', 'cost', 'marketValue', 'invested', 'realized', 'unrealized', 'totalProfit', 'dividends', 'fees', 'feeImpact', 'proceeds', 'entryCount', 'valuationReason']
  const headings = ['日期', '收盘价（元）', '持有份额', '持仓成本（元）', '持仓市值（元）', '累计买入支出含买入费（元）', '已实现交易盈亏（元）', '浮动盈亏（元）', '累计盈亏（元）', '到账分红扣费后（元）', '累计已录入费用（元）', '费用影响已计入盈亏（元）', '累计卖出净回款（元）', '当日记录数', '估值说明']
  const cell = value => value == null ? '' : typeof value === 'number' ? String(Number(value.toFixed(6))) : `"${String(value).replaceAll('"', '""')}"`
  return '\uFEFF' + [headings.join(','), ...stats.points.map(point => fields.map(key => cell(point[key])).join(','))].join('\r\n')
}
