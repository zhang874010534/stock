import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateFeeSensitivity, calculateInvestmentSimulation, simulatorDefaults, validateSimulatorConfig } from '../src/utils/investmentSimulator.js'
import { createInvestmentPlans, INVESTMENT_PLANS_KEY, MAX_INVESTMENT_PLANS, validateInvestmentPlans } from '../src/composables/useInvestmentPlans.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { investmentSimulatorOption } from '../src/charts/investmentSimulator.js'

const now = new Date('2026-10-02T08:00:00Z')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`)
function market(start = '2026-01-05', end = '2026-03-31', price = () => 10, code = '512890') {
  const history = tradingSessions(start, end, tradingCalendar).map((date, i) => { const close = price(date, i); return { date, close, open: close, high: close, low: close } })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = (dividends = [], splits = []) => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-10-02' }, checkedAt: now.toISOString(), status: 'ok', reason: null, dividends, splits })
const config = (m, overrides = {}) => ({ ...simulatorDefaults(m), start: m.history[0].date, end: m.latest.date, budget: 1000, quantityMode: 'fractional', ...overrides })
const simulate = (m, overrides = {}, events = distribution()) => calculateInvestmentSimulation(m, config(m, overrides), { distribution: events, now })
const memoryStorage = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } }

test('monthly deposits conserve wealth, identical funding for all strategies, no future spending and cash ledger reconciles', () => {
  const m = market(), result = simulate(m, { fundingMode: 'monthly', monthlyAmount: 500, contributionDay: 5, monthDay: 1, batchCount: 2, batchInterval: 7 })
  assert.deepEqual(result.deposits.map(item => item.date), ['2026-01-05', '2026-02-05', '2026-03-05'])
  for (const s of result.series) {
    near(s.current.contributed, 2500); near(s.current.assets, 2500); near(s.profit, 0); near(s.maxDrawdown, 0); near(s.xirr.value, 0)
    near(s.cashFlows.reduce((sum, flow) => sum + flow.amount, 0), s.current.cash)
    for (const point of s.points) { near(point.assets, point.contributed); assert.ok(point.spent + point.fees <= point.contributed + 1e-7) }
    for (const flow of s.cashFlows.filter(flow => flow.type !== 'pending')) assert.ok(flow.cash >= 0)
  }
  const lump = result.series[0], monthly = result.series[2], batches = result.series[3]
  near(lump.current.shares, 250); near(batches.current.cash, 1000)
  near(monthly.points.find(p => p.date === '2026-01-30').shares, 0)
  near(monthly.orders.find(order => order.date === '2026-02-02').value, 1000)
  const chart = investmentSimulatorOption(result)
  assert.deepEqual(chart.series.at(-1).data, lump.points.map(p => p.contributed))
})

test('zero initial capital, missed first month, holiday deposits roll forward and terminal deposits remain unexecuted', () => {
  const m = market('2026-01-06', '2026-02-27')
  const result = simulate(m, { budget: 0, fundingMode: 'monthly', monthlyAmount: 1000, contributionDay: 16 })
  assert.deepEqual(result.deposits.map(item => [item.plannedDate, item.date]), [['2026-01-16', '2026-01-16'], ['2026-02-16', '2026-02-24']])
  for (const s of result.series) { near(s.current.contributed, 2000); near(s.current.assets, 2000); near(s.profit, 0); near(s.maxDrawdown, 0) }
  const ending = simulate(m, { end: '2026-02-22', fundingMode: 'monthly', monthlyAmount: 700, contributionDay: 16 })
  assert.equal(ending.deposits[1].date, null)
  near(ending.series[0].current.contributed, 1700); assert.equal(ending.series[0].cashFlows.at(-1).type, 'pending')
  assert.equal(ending.series[0].cashFlows.at(-1).amount, 0)
  const missed = simulate(m, { fundingMode: 'monthly', contributionDay: 5 })
  assert.equal(missed.deposits.length, 1); assert.equal(missed.deposits[0].date, '2026-02-05')
  const none = simulate(m, { budget: 0, end: '2026-01-09', fundingMode: 'monthly', contributionDay: 16 })
  assert.equal(none.series[0].returnRate, null); assert.equal(none.series[0].xirr.value, null)
})

test('external deposits do not erase drawdown, profit excludes capital and XIRR uses deposit dates', () => {
  const m = market('2026-01-05', '2026-02-06', (_, i) => i ? 5 : 10)
  const s = simulate(m, { fundingMode: 'monthly', monthlyAmount: 1000, contributionDay: 6 }).series[0]
  // January deposit occurs after the first day's purchase. The loss on that
  // purchase remains 500; later capital arrives at the already lower price.
  near(s.current.contributed, 3000); near(s.current.assets, 2500); near(s.profit, -500)
  near(s.returnRate, -500 / 3000); near(s.maxDrawdown, .25)
  const flows = [{ date: '2026-01-05', amount: -1000 }, { date: '2026-01-06', amount: -1000 }, { date: '2026-02-06', amount: -1000 }, { date: '2026-02-06', amount: 2500 }]
  const npv = flows.reduce((sum, flow) => sum + flow.amount / (1 + s.xirr.value) ** ((Date.parse(flow.date) - Date.parse(flows[0].date)) / 86400000 / 365), 0)
  near(npv, 0)
  const afterLoss = simulate(market('2026-01-06', '2026-02-06', (_, i) => i ? 5 : 10), { fundingMode: 'monthly', monthlyAmount: 1000, contributionDay: 5 }).series[0]
  near(afterLoss.current.assets, 1500); near(afterLoss.maxDrawdown, .5); near(afterLoss.current.nav, .5)
})

test('reinvestment waits for payment and next session, includes fees, and does not spend receivables or initial cash twice', () => {
  const m = market('2026-01-05', '2026-01-13', date => date >= '2026-01-13' ? 18 : date >= '2026-01-07' ? 9 : 10)
  const events = distribution([{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-10', cashPerShare: 1 }])
  const result = simulate(m, { basis: 'reinvest' }, events), s = result.series[0]
  near(s.points.find(p => p.date === '2026-01-09').receivable, 100)
  assert.equal(s.cashFlows.find(flow => flow.type === 'dividend').date, '2026-01-10')
  assert.equal(s.cashFlows.find(flow => flow.type === 'reinvest').date, '2026-01-12')
  near(s.current.shares, 100 + 100 / 9); near(s.current.assets, 2000); near(s.current.reinvested, 100); near(s.current.cash, 0)
  near(s.current.contributed, 1000); near(s.profit, 1000)
  near(s.cashFlows.reduce((sum, flow) => sum + flow.amount, 0), s.current.cash)
  const fee = simulate(m, { basis: 'reinvest', minFee: 5 }, events).series[0]
  near(fee.current.shares, 99.5 + 94.5 / 9); near(fee.current.fees, 10); near(fee.current.reinvestFees, 5)
  const unpaid = distribution([{ ...events.dividends[0], payDate: '2026-01-14' }])
  const u = simulate(m, { basis: 'reinvest' }, unpaid).series[0]
  near(u.current.receivable, 100); near(u.current.reinvested, 0); assert.ok(!u.cashFlows.some(flow => flow.type === 'reinvest'))
  near(simulate(m, { basis: 'cash' }, events).series[0].current.assets, 1900)
})

test('lot reinvestment carries residuals, split keeps cash unchanged and next record date includes reinvested shares', () => {
  const m = market('2026-01-05', '2026-01-16', date => date >= '2026-01-13' ? .05 : 10)
  const e = distribution([{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: .1 }])
  const s = simulate(m, { basis: 'reinvest', quantityMode: 'lots' }, e).series[0]
  const trades = s.cashFlows.filter(flow => flow.type === 'reinvest')
  assert.equal(trades.length, 1); assert.equal(trades[0].date, '2026-01-13'); near(trades[0].quantity, 200)
  near(s.current.shares, 300); near(s.current.cash, 0)
  const fm = market('2026-01-05', '2026-01-16', date => date >= '2026-01-07' ? 9 : 10)
  const two = distribution([{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: 1 }, { recordDate: '2026-01-12', exDate: '2026-01-13', payDate: '2026-01-16', cashPerShare: .1 }])
  const double = simulate(fm, { basis: 'reinvest' }, two).series[0]
  near(double.current.income, 100 + (100 + 100 / 9) * .1)
  const split = simulate(fm, { basis: 'reinvest' }, distribution([], [{ date: '2026-01-07', ratio: 2 }])).series[0]
  assert.equal(split.cashFlows.find(flow => flow.type === 'split').amount, 0); near(split.current.shares, 200)
})

test('fee sensitivity reruns buys and reinvestment, rather than just subtracting fees from wealth', () => {
  const m = market(), c = config(m, { quantityMode: 'lots', feePercent: .01, minFee: 1, comparisonFeePercent: 1, comparisonMinFee: 5 })
  const options = { distribution: distribution(), now }, base = calculateInvestmentSimulation(m, c, options)
  const scenarios = calculateFeeSensitivity(m, c, options, base)
  assert.equal(scenarios.length, 3); assert.equal(scenarios[1].series, base.series)
  near(scenarios[0].series[0].current.shares, 100); near(scenarios[1].series[0].current.shares, 0)
  for (const scenario of scenarios) for (const s of scenario.series) {
    near(s.current.assets, s.current.contributed - s.current.fees)
    near(s.cashFlows.reduce((sum, flow) => sum + flow.amount, 0), s.current.cash)
  }
  const e = distribution([{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: 1 }])
  const rs = calculateFeeSensitivity(m, config(m, { basis: 'reinvest' }), { distribution: e, now })
  assert.equal(rs[0].series[0].current.reinvestFees, 0); assert.ok(rs[2].series[0].current.reinvestFees > 0)
})

test('new parameter validation, legacy config defaults, source coverage and index restrictions remain enforced', () => {
  const m = market(), legacy = config(m)
  for (const key of ['fundingMode', 'monthlyAmount', 'contributionDay', 'comparisonFeePercent', 'comparisonMinFee']) delete legacy[key]
  assert.equal(validateSimulatorConfig(legacy, '512890').fundingMode, 'upfront')
  for (const overrides of [{ fundingMode: 'bad' }, { fundingMode: 'monthly', monthlyAmount: 0 }, { monthlyAmount: NaN }, { contributionDay: 29 }, { comparisonFeePercent: -1 }, { comparisonMinFee: 10001 }]) assert.throws(() => simulate(m, overrides))
  const index = market(undefined, undefined, undefined, 'H30269')
  assert.throws(() => simulate(index, { basis: 'reinvest' }), /口径/)
  const result = simulate(index, { basis: 'price', fundingMode: 'monthly' })
  assert.equal(result.series[0].current.income, 0)
  assert.throws(() => simulate(m, { basis: 'reinvest' }, { ...distribution(), status: 'unavailable', reason: 'missing', coverage: null, checkedAt: null }), /不可用/)
})

test('named plans preserve independent configs and instrument identity, reload, same-name versions, deletion and undo', () => {
  const storage = memoryStorage(); let serial = 0
  const store = createInvestmentPlans({ storage, now: () => now, id: () => `plan-${++serial}` }), m = market()
  const c = config(m, { fundingMode: 'monthly', basis: 'reinvest' })
  store.save({ instrument: '512890', name: '<测试方案>', strategy: 'weekly', config: c }); c.budget = 9000
  near(store.plans.value[0].config.budget, 1000)
  store.save({ instrument: '512890', name: '<测试方案>', strategy: 'monthly', config: c })
  store.save({ instrument: 'H30269', name: '指数', strategy: 'lump', config: config(market(undefined, undefined, undefined, 'H30269')) })
  const restored = createInvestmentPlans({ storage }); assert.equal(restored.plans.value.length, 3)
  restored.remove('plan-1'); assert.equal(restored.plans.value.length, 2); restored.undoRemove(); assert.equal(restored.plans.value.length, 3)
  assert.equal(validateInvestmentPlans(JSON.parse(storage.getItem(INVESTMENT_PLANS_KEY))).length, 3)
})

test('corrupt storage is never overwritten, quota failure keeps plans, invalid entries reject atomically and cap is enforced', () => {
  const m = market(), input = { instrument: '512890', name: '方案', strategy: 'weekly', config: config(m) }
  let writes = 0
  const broken = createInvestmentPlans({ storage: { getItem: () => '{bad', setItem: () => { writes++ } }, now: () => now, id: () => 'p' })
  broken.save(input); assert.equal(writes, 0); assert.ok(broken.hasWarning.value)
  let serial = 0
  const denied = createInvestmentPlans({ storage: { getItem: () => null, setItem() { throw new Error('quota') } }, now: () => now, id: () => `p-${++serial}` })
  for (let i = 0; i < MAX_INVESTMENT_PLANS; i++) denied.save(input)
  assert.match(denied.message.value, /保存失败/); assert.throws(() => denied.save(input), /最多保存/)
  const doc = { schemaVersion: 1, plans: [denied.plans.value[0]] }
  for (const change of [{ name: '' }, { strategy: 'bad' }, { instrument: '000300' }, { config: { ...config(m), basis: 'bad' } }]) assert.throws(() => validateInvestmentPlans({ ...doc, plans: [{ ...doc.plans[0], ...change }] }))
  assert.throws(() => validateInvestmentPlans({ ...doc, plans: [doc.plans[0], doc.plans[0]] }), /重复/)
})
