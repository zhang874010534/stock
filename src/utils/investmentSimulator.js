import { tradingCalendar } from '../data/tradingCalendar.js'
import { validateMarketData } from './kline.js'
import { validateEtfDistributions, chinaDate } from './etfDistributions.js'
import { anniversary, dateTimestamp, shiftDay, tradingDate, validatedWindow } from './priceRisk.js'
import { calculateXirr } from './portfolioLedger.js'

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
    feePercent: 0, minFee: 0, fundingMode: 'upfront', monthlyAmount: 1000, contributionDay: 5, comparisonFeePercent: .03, comparisonMinFee: 5,
    quantityMode: market.code === '512890' ? 'lots' : 'fractional', basis: market.code === '512890' ? 'cash' : 'price' }
}

export function validateSimulatorConfig(input, instrument) {
  requireValue(input && ['H30269', '512890'].includes(instrument), '模拟证券或参数无效')
  const config = { fundingMode: 'upfront', monthlyAmount: 1000, contributionDay: 5, comparisonFeePercent: .03, comparisonMinFee: 5, ...input }
  dateTimestamp(config.start); dateTimestamp(config.end)
  requireValue(config.start < config.end, '开始日期必须早于结束日期')
  requireValue(['upfront', 'monthly'].includes(config.fundingMode), '资金来源模式无效')
  requireValue(Number.isFinite(config.budget) && config.budget >= (config.fundingMode === 'monthly' ? 0 : 1) && config.budget <= 1e9, '总预算须为 1–10 亿之间的金额；按月新增模式初始资金可为零')
  requireValue(Number.isFinite(config.monthlyAmount) && config.monthlyAmount >= 0 && config.monthlyAmount <= 1e9 && (config.fundingMode !== 'monthly' || config.monthlyAmount >= 1), '每月新增资金须为 1–10 亿之间的金额')
  requireValue(integer(config.contributionDay, 1, 28), '每月资金到账日须为 1–28 日')
  requireValue(integer(config.weekday, 1, 5) && integer(config.monthDay, 1, 28), '每周／每月投入日期无效')
  requireValue(integer(config.batchCount, 1, 60) && integer(config.batchInterval, 1, 365), '分批次数须为 1–60，间隔须为 1–365 天')
  for (const [rate, minimum] of [['feePercent', 'minFee'], ['comparisonFeePercent', 'comparisonMinFee']]) requireValue(Number.isFinite(config[rate]) && config[rate] >= 0 && config[rate] <= 5 && Number.isFinite(config[minimum]) && config[minimum] >= 0 && config[minimum] <= 10000, '费用参数超出范围')
  requireValue(['lots', 'fractional'].includes(config.quantityMode) && (instrument === '512890' || config.quantityMode === 'fractional'), '指数只能按理论份额模拟')
  requireValue(['cash', 'price', 'reinvest'].includes(config.basis) && (instrument === '512890' || config.basis === 'price'), '收益口径无效')
  const keys = ['start', 'end', 'budget', 'weekday', 'monthDay', 'batchCount', 'batchInterval', 'feePercent', 'minFee', 'quantityMode', 'basis', 'fundingMode', 'monthlyAmount', 'contributionDay', 'comparisonFeePercent', 'comparisonMinFee']
  return Object.fromEntries(keys.map(key => [key, config[key]]))
}

function contributionSchedule(config, rows) {
  const deposits = []
  if (config.fundingMode === 'monthly') for (let day = config.start; day <= config.end; day = shiftDay(day, 1)) {
    if (Number(day.slice(8)) === config.contributionDay) deposits.push({ plannedDate: day, date: rows.find(row => row.date >= day)?.date ?? null, amount: config.monthlyAmount })
  }
  return deposits
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

function simulateStrategy(definition, plannedOrders, rows, config, distribution, deposits) {
  let shares = 0, spent = 0, fees = 0, released = 0, income = 0, paid = 0, contributed = config.budget
  let principalSpent = 0, principalFees = 0, reinvested = 0, reinvestFees = 0, nav = 1, peak = 1, maxDrawdown = 0, previousAssets = config.budget
  const points = [], ledger = [], cashFlows = [], rights = new Map(), entitlements = new Map()
  const orders = [...plannedOrders]
  if (definition.key === 'lump') for (const deposit of deposits.filter(item => item.date)) {
    if (!orders.some(order => order.date === deposit.date)) orders.push({ plannedDate: deposit.plannedDate, date: deposit.date, allocation: 0, status: 'scheduled', reason: '新增资金买入' })
  }
  const dividends = distribution?.dividends ?? [], splits = distribution?.splits ?? []
  const quotes = new Map(rows.map(row => [row.date, row]))
  const lot = config.quantityMode === 'lots' ? 100 : 0
  const rate = config.feePercent / 100
  const balances = () => ({ cash: Math.max(0, contributed - principalSpent - principalFees) + Math.max(0, paid - reinvested - reinvestFees), receivable: Math.max(0, income - paid), shares })
  const flow = (date, type, amount, detail, extra = {}) => cashFlows.push({ date, type, amount, detail, ...balances(), ...extra })
  function purchase(available, price) {
    const maxValue = Math.max(0, Math.min(available / (1 + rate), available - config.minFee))
    let quantity = lot ? Math.floor(maxValue / price / lot + 1e-10) * lot : maxValue / price
    let value = quantity * price, fee = quantity > 0 ? Math.max(value * rate, config.minFee) : 0
    if (value + fee > available + Math.max(1, available) * 1e-12 && lot) { quantity = Math.max(0, quantity - lot); value = quantity * price; fee = quantity ? Math.max(value * rate, config.minFee) : 0 }
    if (!lot && value + fee > available) { value = Math.max(0, available - fee); quantity = value / price }
    return { quantity, value, fee }
  }
  flow(rows[0].date, 'initial', config.budget, '初始资金到账（外部入金）')
  for (let day = rows[0].date; day <= rows.at(-1).date; day = shiftDay(day, 1)) {
    let added = 0, newlyPaid = 0
    for (const deposit of deposits.filter(item => item.date === day)) {
      contributed += deposit.amount; released += deposit.amount; added += deposit.amount
      flow(day, 'contribution', deposit.amount, `每月新增资金（计划 ${deposit.plannedDate}，外部入金）`, { plannedDate: deposit.plannedDate })
    }
    for (const split of splits) if (split.date === day) { shares *= split.ratio; flow(day, 'split', 0, `份额按 ${split.ratio} 倍调整，不产生现金`) }
    for (const dividend of dividends) {
      if (dividend.exDate === day) {
        const amount = (rights.get(dividend.exDate) ?? 0) * dividend.cashPerShare
        entitlements.set(dividend.exDate, amount); income += amount
        if (amount) flow(day, 'entitlement', 0, `确认应收分红 ${amount.toFixed(2)} 元；权益按 ${dividend.recordDate} 收盘持仓`)
      }
      if (dividend.payDate === day) {
        const amount = entitlements.get(dividend.exDate) ?? 0
        paid += amount; newlyPaid += amount
        if (amount) flow(day, 'dividend', amount, '分红发放，应收转现金（内部现金流）')
      }
    }
    const row = quotes.get(day)
    if (row) {
      for (const order of orders.filter(item => item.date === day)) {
        released += order.allocation
        const available = Math.max(0, released - principalSpent - principalFees)
        const { quantity, value, fee } = purchase(available, row.close)
        shares += quantity; spent += value; fees += fee
        principalSpent += value; principalFees += fee
        ledger.push({ ...order, close: row.close, quantity, value, fee, shares, budgetCash: Math.max(0, contributed - principalSpent - principalFees), status: quantity > 0 ? 'bought' : 'insufficient' })
        flow(day, quantity ? 'buy' : 'skipped', -(value + fee), quantity ? order.reason ?? '计划买入（含买入费用）' : '计划买入余额不足，保留现金', { quantity, value, fee, close: row.close, plannedDate: order.plannedDate })
      }
      if (config.basis === 'reinvest' && paid - reinvested - reinvestFees > 1e-9) {
        const { quantity, value, fee } = purchase(Math.max(0, paid - reinvested - reinvestFees), row.close)
        if (quantity) {
          shares += quantity; spent += value; fees += fee; reinvested += value; reinvestFees += fee
          flow(day, 'reinvest', -(value + fee), '已付分红再投资（含费用），仅使用分红现金', { quantity, value, fee, close: row.close })
        } else if (newlyPaid) flow(day, 'skipped', 0, '分红不足一手或费用，保留现金，后续交易日继续尝试', { quantity: 0, value: 0, fee: 0 })
      }
    }
    // Close-of-record-date holdings include that day's purchases. Ex-date
    // purchases cannot receive a dividend with an earlier record date.
    for (const dividend of dividends) if (dividend.recordDate === day) rights.set(dividend.exDate, shares)
    if (row) {
      const marketValue = shares * row.close, budgetCash = Math.max(0, contributed - principalSpent - principalFees)
      const { cash, receivable } = balances(), assets = marketValue + cash + receivable
      requireValue([shares, spent, fees, assets, income].every(Number.isFinite), '模拟结果超出数值范围')
      // Contributions arrive before this session's price return; normalize
      // wealth so deposits cannot create a new performance high or recovery.
      if (previousAssets + added > 0) nav *= assets / (previousAssets + added)
      peak = Math.max(peak, nav); maxDrawdown = Math.max(maxDrawdown, 1 - nav / peak); previousAssets = assets
      points.push({ date: day, assets, marketValue, cash, receivable, shares, spent, fees, income, budgetCash, contributed, reinvested, reinvestFees, nav })
    }
  }
  ledger.push(...orders.filter(item => !item.date).map(item => ({ ...item, quantity: 0, value: 0, fee: 0 })))
  for (const deposit of deposits.filter(item => !item.date)) flow(deposit.plannedDate, 'pending', 0, '到账日顺延后超出区间，未计入投入资金', { plannedAmount: deposit.amount })
  const current = points.at(-1), profit = current.assets - contributed
  const xirr = calculateXirr([...cashFlows.filter(item => ['initial', 'contribution'].includes(item.type)).map(item => ({ date: item.date, amount: -item.amount })), { date: current.date, amount: current.assets }])
  return { ...definition, points, orders: ledger, cashFlows, current, profit, returnRate: contributed ? profit / contributed : null, maxDrawdown, xirr,
    plannedCount: orders.length, executedCount: ledger.filter(item => item.status === 'bought').length,
    skippedCount: ledger.filter(item => item.status === 'insufficient').length, outsideCount: ledger.filter(item => item.status === 'outside').length,
    averageCost: shares > 0 ? (spent + fees) / shares : null }
}

export function calculateInvestmentSimulation(market, config, { distribution, calendar = tradingCalendar, now = new Date() } = {}) {
  requireValue(['H30269', '512890'].includes(market?.code), '模拟证券不受支持')
  validateMarketData(market, market.code)
  requireValue(market.source === 'eastmoney', '行情来源异常')
  requireValue(market.latest.date <= chinaDate(now), '行情文件含未来日期')
  config = validateSimulatorConfig(config, market.code)
  requireValue(config.start >= market.history[0].date && config.end <= market.latest.date, '所选区间超出已同步行情范围')
  requireValue(config.start >= calendar.start && config.end <= calendar.end, '交易日历未覆盖所选区间')
  requireValue(config.end <= chinaDate(now), '不能模拟未来行情')
  const localTime = new Date(now.getTime() + 8 * 3600000).toISOString()
  requireValue(config.end !== localTime.slice(0, 10) || localTime.slice(11, 16) >= '15:00', '当日行情尚未收盘')
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
    events = { dividends: config.basis !== 'price' ? dividends : [], splits }
  }
  const orders = schedules(config, start, end, rows)
  const deposits = contributionSchedule(config, rows)
  const series = INVESTMENT_STRATEGIES.map(strategy => simulateStrategy(strategy, orders[strategy.key], rows, config, events, deposits))
  return { code: market.code, config: { ...config }, startDate: start, endDate: end, count: rows.length,
    distributionStatus: distribution?.status, distributionCoverage: market.code === '512890' ? distribution.coverage : null,
    backfillCompleted: market.backfill.completed, deposits, series }
}

export function calculateFeeSensitivity(market, config, options = {}, baseline) {
  const normalized = validateSimulatorConfig(config, market.code)
  return [
    { key: 'zero', name: '零买入费用', feePercent: 0, minFee: 0 },
    { key: 'current', name: '当前方案费用', feePercent: normalized.feePercent, minFee: normalized.minFee },
    { key: 'comparison', name: '对照费用', feePercent: normalized.comparisonFeePercent, minFee: normalized.comparisonMinFee },
  ].map(scenario => ({ ...scenario, series: scenario.key === 'current' && baseline ? baseline.series : calculateInvestmentSimulation(market, { ...normalized, feePercent: scenario.feePercent, minFee: scenario.minFee }, options).series }))
}
