import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { validateEtfDistributions, chinaDate } from './etfDistributions.js'
import { anniversary, dateTimestamp, shiftDay, tradingDate, validatedWindow } from './priceRisk.js'

export const INVESTMENT_STRATEGIES = [
  { key: 'lump', name: '一次性买入', color: '#69a9ff' },
  { key: 'weekly', name: '每周定投', color: '#63d0b0' },
  { key: 'monthly', name: '每月定投', color: '#e1bd69' },
  { key: 'batches', name: '分批投入', color: '#bd9aef' },
]
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

export function simulatorDefaults(market, calendar = tradingCalendar) {
  const end = [market.latest.date, calendar.end].sort()[0]
  const start = [anniversary(end, 1), market.history[0].date, calendar.start].sort().at(-1)
  return { start, end, budget: 50000, weekday: 1, monthDay: 5, batchCount: 6, batchInterval: 30,
    feePercent: 0, minFee: 0, quantityMode: market.code === '512890' ? 'lots' : 'fractional', basis: market.code === '512890' ? 'cash' : 'price' }
}

function schedules(config, start, end, rows) {
  const weekly = [], monthly = []
  for (let day = config.start; day <= config.end; day = shiftDay(day, 1)) {
    if (new Date(dateTimestamp(day)).getUTCDay() === config.weekday) weekly.push(day)
    if (Number(day.slice(8)) === config.monthDay) monthly.push(day)
  }
  const targets = { lump: [start], weekly, monthly,
    batches: Array.from({ length: config.batchCount }, (_, i) => shiftDay(config.start, i * config.batchInterval)) }
  return Object.fromEntries(Object.entries(targets).map(([key, days]) => [key, days.map((plannedDate, i) => {
    // Only use a known session inside the window. Targets beyond the window
    // retain their allocation as cash, without extrapolating the calendar.
    const date = plannedDate <= end ? rows.find(row => row.date >= plannedDate)?.date ?? null : null
    const allocation = i === days.length - 1 ? config.budget - config.budget / days.length * i : config.budget / days.length
    return { plannedDate, date, allocation, status: date ? 'scheduled' : 'outside' }
  })]))
}

function simulateStrategy(definition, orders, rows, config, distribution) {
  let shares = 0, spent = 0, fees = 0, released = 0, income = 0, paid = 0, peak = config.budget, maxDrawdown = 0
  const points = [], ledger = [], rights = new Map(), entitlements = new Map()
  const dividends = distribution?.dividends ?? [], splits = distribution?.splits ?? []
  const quotes = new Map(rows.map(row => [row.date, row]))
  const lot = config.quantityMode === 'lots' ? 100 : 0
  const rate = config.feePercent / 100
  for (let day = rows[0].date; day <= rows.at(-1).date; day = shiftDay(day, 1)) {
    for (const split of splits) if (split.date === day) shares *= split.ratio
    for (const dividend of dividends) {
      if (dividend.exDate === day) {
        const amount = (rights.get(dividend.exDate) ?? 0) * dividend.cashPerShare
        entitlements.set(dividend.exDate, amount); income += amount
      }
      if (dividend.payDate === day) paid += entitlements.get(dividend.exDate) ?? 0
    }
    const row = quotes.get(day)
    if (row) {
      for (const order of orders.filter(item => item.date === day)) {
        released += order.allocation
        const available = Math.max(0, released - spent - fees)
        const maxValue = Math.max(0, Math.min(available / (1 + rate), available - config.minFee))
        let quantity = lot ? Math.floor(maxValue / row.close / lot + 1e-10) * lot : maxValue / row.close
        let value = quantity * row.close, fee = quantity > 0 ? Math.max(value * rate, config.minFee) : 0
        // Account for binary floating-point noise at an exact lot boundary.
        if (value + fee > available + Math.max(1, available) * 1e-12 && lot) { quantity = Math.max(0, quantity - lot); value = quantity * row.close; fee = quantity ? Math.max(value * rate, config.minFee) : 0 }
        if (!lot && value + fee > available) { value = Math.max(0, available - fee); quantity = value / row.close }
        shares += quantity; spent += value; fees += fee
        ledger.push({ ...order, close: row.close, quantity, value, fee, shares, budgetCash: Math.max(0, config.budget - spent - fees), status: quantity > 0 ? 'bought' : 'insufficient' })
      }
    }
    // Close-of-record-date holdings include that day's purchases. Ex-date
    // purchases cannot receive a dividend with an earlier record date.
    for (const dividend of dividends) if (dividend.recordDate === day) rights.set(dividend.exDate, shares)
    if (row) {
      const marketValue = shares * row.close, budgetCash = Math.max(0, config.budget - spent - fees)
      const cash = budgetCash + paid, receivable = Math.max(0, income - paid), assets = marketValue + cash + receivable
      requireValue([shares, spent, fees, assets, income].every(Number.isFinite), '模拟结果超出数值范围')
      peak = Math.max(peak, assets); maxDrawdown = Math.max(maxDrawdown, 1 - assets / peak)
      points.push({ date: day, assets, marketValue, cash, receivable, shares, spent, fees, income, budgetCash })
    }
  }
  ledger.push(...orders.filter(item => !item.date).map(item => ({ ...item, quantity: 0, value: 0, fee: 0 })))
  const current = points.at(-1), profit = current.assets - config.budget
  return { ...definition, points, orders: ledger, current, profit, returnRate: profit / config.budget, maxDrawdown,
    plannedCount: orders.length, executedCount: ledger.filter(item => item.status === 'bought').length,
    skippedCount: ledger.filter(item => item.status === 'insufficient').length, outsideCount: ledger.filter(item => item.status === 'outside').length,
    averageCost: shares > 0 ? (spent + fees) / shares : null }
}

export function calculateInvestmentSimulation(market, config, { distribution, calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(['H30269', '512890'].includes(market?.code), '模拟证券不受支持')
  validateMarketData(market, market.code)
  requireValue(market.source === 'eastmoney', '行情来源异常')
  requireValue(market.latest.date <= chinaDate(now), '行情文件含未来日期')
  dateTimestamp(config.start); dateTimestamp(config.end)
  requireValue(config.start < config.end, '开始日期必须早于结束日期')
  requireValue(config.start >= market.history[0].date && config.end <= market.latest.date, '所选区间超出已同步行情范围')
  requireValue(config.start >= calendar.start && config.end <= calendar.end, '交易日历未覆盖所选区间')
  requireValue(config.end <= chinaDate(now), '不能模拟未来行情')
  const localTime = new Date(now.getTime() + 8 * 3600000).toISOString()
  requireValue(config.end !== localTime.slice(0, 10) || localTime.slice(11, 16) >= '15:00', '当日行情尚未收盘')
  requireValue(Number.isFinite(config.budget) && config.budget >= 1 && config.budget <= 1e9, '总预算须为 1–10 亿之间的金额')
  requireValue(integer(config.weekday, 1, 5) && integer(config.monthDay, 1, 28), '每周／每月投入日期无效')
  requireValue(integer(config.batchCount, 1, 60) && integer(config.batchInterval, 1, 365), '分批次数须为 1–60，间隔须为 1–365 天')
  requireValue(Number.isFinite(config.feePercent) && config.feePercent >= 0 && config.feePercent <= 5 && Number.isFinite(config.minFee) && config.minFee >= 0 && config.minFee <= 10000, '费用参数超出范围')
  requireValue(['lots', 'fractional'].includes(config.quantityMode) && (market.code === '512890' || config.quantityMode === 'fractional'), '指数只能按理论份额模拟')
  requireValue(['cash', 'price'].includes(config.basis) && (market.code === '512890' || config.basis === 'price'), '收益口径无效')
  const start = tradingDate(config.start, 1, calendar), end = tradingDate(config.end, -1, calendar)
  requireValue(start < end, '区间至少需要两个交易日收盘样本')
  const { rows } = validatedWindow(market.history, start, end, calendar, market.code)
  let events = null
  if (market.code === '512890') {
    validateEtfDistributions(distribution, { now })
    requireValue(distribution.status !== 'unavailable', 'ETF 分红／拆分档案不可用，不能假设为零')
    requireValue(start >= distribution.coverage.start && end <= distribution.coverage.end, 'ETF 分红／拆分核验范围未覆盖模拟区间')
    const dividends = distribution.dividends.filter(item => item.recordDate >= start && item.exDate <= end)
    const splits = distribution.splits.filter(item => item.date >= start && item.date <= end)
    requireValue(dividends.every(item => item.recordDate < item.exDate) && !dividends.some(item => splits.some(split => split.date === item.recordDate || split.date === item.exDate)), '分红与登记／拆分同日，须先核验权益口径')
    events = { dividends: config.basis === 'cash' ? dividends : [], splits }
  }
  const orders = schedules(config, start, end, rows)
  const series = INVESTMENT_STRATEGIES.map(strategy => simulateStrategy(strategy, orders[strategy.key], rows, config, events))
  return { code: market.code, config: { ...config }, startDate: start, endDate: end, count: rows.length,
    distributionStatus: distribution?.status, distributionCoverage: market.code === '512890' ? distribution.coverage : null,
    backfillCompleted: market.backfill.completed, series }
}
