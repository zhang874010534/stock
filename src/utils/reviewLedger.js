import { ledgerDocument, ledgerAccounting, LEDGER_TYPES, localDate } from './portfolioLedger.js'
import { validateMarketData } from './kline.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { shiftDay, tradingDate } from './priceRisk.js'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export const reviewMoney = value => value === null ? '—' : `${Math.abs(value) < .005 ? '0.00' : value.toFixed(2)} 元`
function endpointDates(period, now) {
  const local = new Date(now.getTime() + 8 * 3600_000).toISOString()
  const cutoff = period.asOf === localDate(now) && local.slice(11, 16) < '15:00' ? shiftDay(period.asOf, -1) : period.asOf
  return [shiftDay(period.start, -1), cutoff].map(day => {
    try { return tradingDate(day, -1, tradingCalendar) } catch { return null }
  })
}
export function buildReviewLedger(entries, market, period, { now = new Date(), notice = '' } = {}) {
  const normalized = ledgerDocument(entries, { now }).entries.filter(entry => entry.date <= period.asOf)
  let error = ''
  try {
    validateMarketData(market, '512890')
    requireValue(market.source === 'eastmoney' && market.latest.date <= localDate(now), '行情来源或未来日期校验失败')
  } catch (reason) { error = reason.message }
  const quotes = endpointDates(period, now).map(date => {
    const row = !error && date ? market.history.find(row => row.date === date) : null
    return { date, close: row?.close ?? null, reason: row ? '' : error || (date ? `缺少 ${date} 收盘价` : '交易日历未覆盖估值日期') }
  })
  return validateReviewLedger({ entries: normalized, quotes, notice }, period, now)
}
// Keep the accounting inputs and endpoint prices in the snapshot. Derive all
// totals again on read, so saved numerical fields cannot disagree with trades.
export function validateReviewLedger(snapshot, period, now) {
  requireValue(snapshot && typeof snapshot.notice === 'string' && snapshot.notice.length <= 2000, '复盘账本状态异常')
  const entries = ledgerDocument(snapshot.entries, { now }).entries
  requireValue(entries.every(entry => entry.date <= period.asOf), '复盘账本含区间之后的记录')
  const dates = endpointDates(period, now)
  requireValue(Array.isArray(snapshot.quotes) && snapshot.quotes.length === 2, '复盘账本估值端点异常')
  const quotes = snapshot.quotes.map((quote, index) => {
    requireValue(quote && quote.date === dates[index] && (quote.close === null || Number.isFinite(quote.close) && quote.close > 0 && quote.close <= 1e6 && quote.date !== null) && typeof quote.reason === 'string' && quote.reason.length <= 2000 && (quote.close === null ? Boolean(quote.reason) : quote.reason === ''), '复盘账本估值格式异常')
    return { date: quote.date, close: quote.close, reason: quote.reason }
  })
  return { entries, quotes, notice: snapshot.notice }
}
export function reviewLedgerDetails(snapshot, period, notes = []) {
  const before = snapshot.entries.filter(entry => entry.date < period.start)
  const opening = ledgerAccounting(before), closing = ledgerAccounting(snapshot.entries)
  const value = (accounting, entries, quote) => {
    const afterClose = entries.some(entry => ['buy', 'sell', 'split'].includes(entry.type) && (!quote.date || entry.date > quote.date))
    const reason = accounting.shares === 0 ? '' : quote.close === null ? quote.reason : afterClose ? '持仓记录晚于估值收盘日，不能用旧价格估值新持仓' : ''
    const marketValue = reason ? null : accounting.shares === 0 ? 0 : accounting.shares * quote.close
    const unrealized = marketValue === null ? null : marketValue - accounting.cost
    return { shares: accounting.shares, marketValue, unrealized, totalProfit: unrealized === null ? null : accounting.bookedProfit + unrealized, reason, date: quote.date }
  }
  const start = value(opening, before, snapshot.quotes[0]), end = value(closing, snapshot.entries, snapshot.quotes[1])
  const delta = (a, b) => a === null || b === null ? null : b - a
  const transactions = closing.rows.filter(row => row.date >= period.start).map(row => ({ ...row,
    notes: ['buy', 'sell'].includes(row.type) ? notes.filter(note => note.instrument === row.instrument && note.date === row.date) : [],
  }))
  const buys = transactions.filter(row => row.type === 'buy'), sells = transactions.filter(row => row.type === 'sell')
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)
  const cards = [
    { label: `买入支出（${buys.length} 笔，含费）`, value: -sum(buys, 'cashFlow') },
    { label: `卖出回款（${sells.length} 笔，扣费后）`, value: sum(sells, 'cashFlow') },
    { label: '本期全部费用', value: closing.fees - opening.fees },
    { label: '到账分红（扣费后）', value: closing.dividends - opening.dividends },
    { label: '已实现交易盈亏变化', value: closing.realized - opening.realized },
    { label: '浮动盈亏变化', value: delta(start.unrealized, end.unrealized) },
    { label: '其他费用', value: closing.otherFees - opening.otherFees },
    { label: '个人累计盈亏变化', value: delta(start.totalProfit, end.totalProfit) },
  ]
  const context = [
    ...(!snapshot.entries.length ? [] : [[start, '期初'], [end, '期末']].map(([point, label]) => `${label}持有 ${point.shares} 份；市值 ${reviewMoney(point.marketValue)}；累计盈亏 ${reviewMoney(point.totalProfit)}；${point.shares === 0 ? '无持仓，无需价格估值' : `${point.date ?? '日期不可核验'} 收盘估值`}${point.reason ? `；${point.reason}` : ''}。`)),
    '个人盈亏变化 = 已实现交易盈亏变化 + 浮动盈亏变化 + 扣费后分红 − 其他费用。买卖费用已计入成本或已实现盈亏，分红扣费已计入到账金额，费用不重复扣除。',
    '笔记按同证券、同日期关联，未记录成交时刻，不能确认笔记在成交前写下；缺失笔记不推测交易原因。账本、关联笔记及估值均为生成时快照。',
  ].filter(Boolean)
  const lines = [snapshot.notice,
    !snapshot.entries.length ? '截至本期末没有可用账本记录；录入自己的实际交易后重新生成。' : `本期 ${transactions.length} 笔账本记录；金额单位为元。`,
    ...(!snapshot.entries.length ? [] : cards.map(card => `${card.label}：${reviewMoney(card.value)}`)), ...context,
  ].filter(Boolean)
  return { start, end, cards, transactions, context, lines }
}
export function reviewTransactionLines(row) {
  return [
    `${row.date} / ${row.sequence} · ${LEDGER_TYPES[row.type]}${row.type === 'split' ? ` ×${row.ratio}` : ''}${row.quantity === null ? '' : ` · ${row.quantity} 份 × ${row.price} 元`}`,
    `成交／现金金额 ${reviewMoney(row.grossAmount)}；附加费用 ${reviewMoney(row.fee)}；现金流 ${reviewMoney(row.cashFlow)}；交易盈亏 ${reviewMoney(row.profit)}`,
    `账本备注：${row.note || '未填写'}`,
    ...(['buy', 'sell'].includes(row.type) && !row.notes.length ? ['同日观察：没有匹配的笔记。'] : []),
    ...row.notes.flatMap(note => [
      `同日观察 ${note.date}${note.price === null ? '' : ` · 记录价格 ${note.price}`} · 创建 ${note.createdAt} · 更新 ${note.updatedAt}${localDate(new Date(note.createdAt)) > row.date ? ' · 后来补记' : ''}${note.updatedAt !== note.createdAt ? ' · 已修改，原始判断未保存' : ''}`,
      note.text,
    ]),
  ]
}
