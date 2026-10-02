export const LEDGER_KEY = 'stock:portfolio-ledger:v1'
export const MAX_LEDGER_ENTRIES = 2000
export const MAX_LEDGER_BACKUP_BYTES = 4 * 1024 * 1024
export const LEDGER_TYPES = { buy: '买入', sell: '卖出', dividend: '现金分红', fee: '其他费用', split: '份额调整' }
const DAY = 86400000
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export const localDate = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
function timestamp(date) {
  const time = Date.parse(`${date}T00:00:00Z`)
  requireValue(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date, '请选择真实有效的日期')
  return time
}
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const positive = (value, max) => Number.isFinite(value) && value > 0 && value <= max
const money = value => Math.round(value * 100) / 100
// Decimal multiplication avoids binary 1.005 * 101 rounding down at half a cent.
function tradeAmount(quantity, price) {
  const [mantissa, exponent = '0'] = String(price).toLowerCase().split('e')
  const decimals = (mantissa.split('.')[1] ?? '').length - Number(exponent)
  let numerator = BigInt(mantissa.replace('.', '')) * BigInt(quantity) * 100n
  if (decimals <= 0) return Number(numerator * 10n ** BigInt(-decimals)) / 100
  const divisor = 10n ** BigInt(decimals)
  return Number((numerator + divisor / 2n) / divisor) / 100
}
export const sortLedger = entries => [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence)

export function validateLedgerEntry(entry, { now = new Date() } = {}) {
  requireValue(entry && /^[\w-]{1,80}$/.test(entry.id) && typeof entry.id === 'string', '交易编号异常')
  requireValue(entry.instrument === '512890' && Object.hasOwn(LEDGER_TYPES, entry.type), '账本仅支持 512890 及已定义的交易类型')
  timestamp(entry.date)
  requireValue(entry.date <= localDate(now), '不能录入未来交易')
  requireValue(Number.isSafeInteger(entry.sequence) && entry.sequence >= 1 && entry.sequence <= 1000000, '同日顺序须为 1–1000000 的整数')
  requireValue(Number.isFinite(entry.fee) && entry.fee >= 0 && entry.fee <= 1000000000 && money(entry.fee) === entry.fee, '费用须为非负金额，最多两位小数')
  const trade = ['buy', 'sell'].includes(entry.type)
  requireValue(trade ? positive(entry.quantity, 1000000000) && Number.isInteger(entry.quantity) && positive(entry.price, 1000000) : entry.quantity === null && entry.price === null, '买卖须填写正整数份额和正数成交价；非买卖记录不填份额和价格')
  requireValue(trade ? tradeAmount(entry.quantity, entry.price) > 0 && entry.quantity * entry.price <= 1000000000000 : true, '成交金额超出范围或不足一分')
  requireValue(['dividend', 'fee'].includes(entry.type) ? positive(entry.amount, 1000000000000) && money(entry.amount) === entry.amount : entry.amount === null, '现金金额须为正数，最多两位小数')
  requireValue(entry.type !== 'fee' || entry.fee === 0, '其他费用记录只填写费用金额，不能重复附加费用')
  requireValue(entry.type !== 'dividend' || entry.fee <= entry.amount, '分红扣费不能超过分红金额')
  requireValue(entry.type === 'split' ? positive(entry.ratio, 10000) && entry.fee === 0 : entry.ratio === null, '份额调整须填写正数倍率且不产生现金费用')
  requireValue(typeof entry.note === 'string' && entry.note.length <= 500, '备注不能超过 500 个字符')
  requireValue(validTime(entry.createdAt) && validTime(entry.updatedAt) && entry.updatedAt >= entry.createdAt, '记录时间异常')
  return { id: entry.id, instrument: entry.instrument, type: entry.type, date: entry.date, sequence: entry.sequence,
    quantity: entry.quantity, price: entry.price, amount: entry.amount, fee: entry.fee, ratio: entry.ratio,
    note: entry.note.trim(), createdAt: entry.createdAt, updatedAt: entry.updatedAt }
}

// Moving weighted-average cost. Income is recorded only when explicitly entered;
// the public ETF distribution snapshot is never credited to a personal account.
export function ledgerAccounting(entries) {
  let shares = 0, cost = 0, realized = 0, dividends = 0, otherFees = 0, fees = 0, invested = 0, proceeds = 0
  const rows = [], flows = []
  for (const entry of sortLedger(entries)) {
    const grossAmount = ['buy', 'sell'].includes(entry.type) ? tradeAmount(entry.quantity, entry.price) : entry.amount
    let cashFlow = 0, profit = null
    if (entry.type === 'buy') {
      cashFlow = -money(grossAmount + entry.fee); cost -= cashFlow; invested -= cashFlow; shares += entry.quantity
    } else if (entry.type === 'sell') {
      requireValue(entry.quantity <= shares + 1e-8, `${entry.date} 第 ${entry.sequence} 笔卖出超过当时持仓（${Number(shares.toFixed(6))} 份）`)
      const removedCost = cost * Math.min(1, entry.quantity / shares)
      cashFlow = money(grossAmount - entry.fee)
      profit = cashFlow - removedCost; realized += profit; proceeds += cashFlow
      cost -= removedCost; shares -= entry.quantity
      if (Math.abs(shares) < 1e-8) { shares = 0; cost = 0 }
    } else if (entry.type === 'dividend') {
      cashFlow = money(entry.amount - entry.fee); dividends += cashFlow
    } else if (entry.type === 'fee') {
      cashFlow = -entry.amount; otherFees += entry.amount
    } else if (entry.type === 'split') {
      requireValue(shares > 0, `${entry.date} 没有持仓，不能调整份额`)
      shares *= entry.ratio
      requireValue(Number.isSafeInteger(shares), '份额调整后须为整数份额，请核对实际份额倍率')
    }
    fees += entry.fee + (entry.type === 'fee' ? entry.amount : 0)
    requireValue([shares, cost, realized, dividends, otherFees, invested, proceeds].every(Number.isFinite), '账本结果超出数值范围')
    if (cashFlow !== 0) flows.push({ date: entry.date, amount: cashFlow })
    rows.push({ ...entry, grossAmount, cashFlow, profit, shares, cost,
      realized, dividends, otherFees, fees, invested, proceeds })
  }
  return { shares, cost, averageCost: shares > 0 ? cost / shares : null, realized, dividends, otherFees,
    fees, invested, proceeds, bookedProfit: realized + dividends - otherFees, rows, flows }
}

export function validateLedgerDocument(document, options) {
  requireValue(document?.schemaVersion === 1 && document.kind === 'stock-portfolio-ledger' && document.costMethod === 'moving_average', '账本格式、版本或成本口径异常')
  requireValue(Array.isArray(document.entries) && document.entries.length <= MAX_LEDGER_ENTRIES, `最多保存 ${MAX_LEDGER_ENTRIES} 条记录`)
  const entries = document.entries.map(entry => validateLedgerEntry(entry, options))
  requireValue(new Set(entries.map(entry => entry.id)).size === entries.length, '交易编号重复')
  requireValue(new Set(entries.map(entry => `${entry.date}:${entry.sequence}`)).size === entries.length, '同一天的交易顺序不能重复')
  ledgerAccounting(entries)
  return sortLedger(entries)
}
export function ledgerDocument(entries, options) {
  const document = { schemaVersion: 1, kind: 'stock-portfolio-ledger', costMethod: 'moving_average', entries }
  return { ...document, entries: validateLedgerDocument(document, options) }
}

// Solve in log(1+r), aggregate same-day flows, and decline ambiguous roots.
// Return reasons instead of manufacturing a percentage for invalid cash flows.
export function calculateXirr(cashFlows) {
  const amounts = new Map()
  for (const flow of cashFlows) {
    timestamp(flow.date)
    requireValue(Number.isFinite(flow.amount), 'XIRR 现金流无效')
    amounts.set(flow.date, (amounts.get(flow.date) ?? 0) + flow.amount)
  }
  const flows = [...amounts].filter(([, amount]) => Math.abs(amount) > 1e-8).sort(([a], [b]) => a.localeCompare(b))
  if (!flows.some(([, amount]) => amount < 0) || !flows.some(([, amount]) => amount > 0)) return { value: null, reason: '需要同时存在投入和收回现金流' }
  if (flows.length < 2 || flows[0][0] === flows.at(-1)[0]) return { value: null, reason: '现金流必须跨越不同日期' }
  const start = timestamp(flows[0][0]), scale = Math.max(...flows.map(([, amount]) => Math.abs(amount)))
  const terms = flows.map(([date, amount]) => ({ years: (timestamp(date) - start) / DAY / 365, amount: amount / scale }))
  const variations = terms => terms.slice(1).filter((term, i) => Math.sign(term.amount) !== Math.sign(terms[i].amount)).length
  const npv = (terms, x) => {
    const exponents = terms.map(term => -x * term.years), offset = Math.max(...exponents)
    const weighted = terms.map((term, i) => term.amount * Math.exp(exponents[i] - offset))
    return weighted.reduce((sum, amount) => sum + amount, 0) / weighted.reduce((sum, amount) => sum + Math.abs(amount), 0)
  }
  function bisect(terms, low, high) {
    let left = npv(terms, low), middle = 0
    for (let i = 0; i < 200; i++) {
      middle = (low + high) / 2
      const value = npv(terms, middle)
      if (value === 0 || high - low < 1e-12) break
      if (left * value <= 0) high = middle
      else { low = middle; left = value }
    }
    return middle
  }
  // Dividing by the first exponential preserves roots. Its derivative has
  // one fewer term; stationary points partition the original into monotone
  // intervals, detecting both multiple roots and tangencies without grid scans.
  function isolate(terms) {
    const changes = variations(terms)
    if (!changes) return []
    if (changes === 1) return npv(terms, -32) * npv(terms, 32) <= 0 ? [bisect(terms, -32, 32)] : []
    const derivative = terms.slice(1).map(term => ({ years: term.years - terms[1].years, amount: -term.years * term.amount }))
    const derivativeScale = Math.max(...derivative.map(term => Math.abs(term.amount)))
    for (const term of derivative) term.amount /= derivativeScale
    const stationary = isolate(derivative), boundaries = [-32, ...stationary, 32], roots = []
    for (const x of stationary) if (Math.abs(npv(terms, x)) < 1e-12) roots.push(x)
    for (let i = 1; i < boundaries.length; i++) {
      const a = boundaries[i - 1], b = boundaries[i]
      if (npv(terms, a) * npv(terms, b) < 0) roots.push(bisect(terms, a, b))
    }
    return roots.sort((a, b) => a - b).filter((root, i, all) => !i || Math.abs(root - all[i - 1]) > 1e-7)
  }
  if (variations(terms) > 1 && terms.length > 256) return { value: null, reason: '多次变号的现金流超过 256 个日期，暂不计算 XIRR' }
  const roots = isolate(terms)
  if (roots.length > 1) return { value: null, reason: '现金流存在多个 XIRR 解，不显示单一结果' }
  if (!roots.length) return { value: null, reason: 'XIRR 在支持的求解范围内没有解' }
  const value = Math.expm1(roots[0])
  return Number.isFinite(value) && value > -1 ? { value, reason: '' } : { value: null, reason: 'XIRR 超出可计算范围' }
}

export function portfolioSummary(entries, quote, { now = new Date() } = {}) {
  const accounting = ledgerAccounting(entries)
  const lastDate = accounting.rows.at(-1)?.date
  let valuationReason = '', asOf = null, marketValue = null
  if (!entries.length) valuationReason = '录入交易后展示持仓收益'
  else if (accounting.shares === 0) { marketValue = 0; asOf = lastDate }
  else if (!quote || !positive(quote.close, 1000000)) valuationReason = '暂无有效行情，持仓成本与已记账收益仍可查看'
  else {
    try {
      timestamp(quote.date)
      requireValue(quote.date <= localDate(now), '行情日期晚于今天')
      requireValue(quote.date >= lastDate, '最新记录晚于行情日期，等待行情更新后计算市值与 XIRR')
      const localTime = new Date(now.getTime() + 8 * 3600000).toISOString()
      requireValue(quote.date !== localTime.slice(0, 10) || localTime.slice(11, 16) >= '15:00', '当日行情尚未收盘')
      marketValue = accounting.shares * quote.close; asOf = quote.date
    } catch (error) { valuationReason = error.message }
  }
  const unrealized = marketValue === null ? null : marketValue - accounting.cost
  const totalProfit = unrealized === null ? null : accounting.bookedProfit + unrealized
  const flows = [...accounting.flows]
  if (marketValue > 0) flows.push({ date: asOf, amount: marketValue })
  const xirr = marketValue === null ? { value: null, reason: valuationReason } : calculateXirr(flows)
  return { ...accounting, asOf, marketValue, unrealized, totalProfit, xirr, valuationReason,
    totalReturn: totalProfit !== null && accounting.invested > 0 ? totalProfit / accounting.invested : null }
}

// Real fills are grouped by their observed bar; aggregate periods never shift
// a missing daily date to a fabricated trading day. Tooltip retains every fill.
export function projectLedgerTrades(entries, dailyHistory, bars) {
  const dates = new Set(dailyHistory.map(row => row.date)), groups = new Map()
  for (const entry of sortLedger(entries)) {
    if (!['buy', 'sell'].includes(entry.type) || !dates.has(entry.date)) continue
    const bar = bars.find(row => (row.startDate ?? row.date) <= entry.date && (row.endDate ?? row.date) >= entry.date)
    if (!bar) continue
    const key = `${bar.date}:${entry.type}`
    if (!groups.has(key)) groups.set(key, { id: key, type: entry.type, entries: [], point: { date: bar.date, price: entry.type === 'buy' ? bar.low : bar.high } })
    groups.get(key).entries.push(entry)
  }
  return [...groups.values()].map(group => ({ ...group, label: `${group.type === 'buy' ? '买' : '卖'}${group.entries.length > 1 ? `×${group.entries.length}` : ''}`,
    title: group.entries.map(entry => `${entry.date} 第${entry.sequence}笔 ${LEDGER_TYPES[entry.type]} ${entry.quantity}份 × ${entry.price}元；费用 ${entry.fee}元${entry.note ? `；${entry.note}` : ''}`).join('\n') }))
}
