import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { calculateInvestmentSimulation, simulatorDefaults } from '../src/utils/investmentSimulator.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { tradingSessions } from '../src/utils/priceRisk.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { investmentSimulatorOption } from '../src/charts/investmentSimulator.js'

const now = new Date('2026-10-01T08:00:00Z')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`)
function market(start = '2026-01-05', end = '2026-03-31', close = () => 10, code = '512890') {
  const history = tradingSessions(start, end, tradingCalendar).map((date, i) => ({ date, close: close(date, i), open: close(date, i), high: close(date, i), low: close(date, i) }))
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = (overrides = {}) => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share',
  coverage: { start: '2018-12-19', end: '2026-10-01' }, checkedAt: now.toISOString(), status: 'ok', reason: null, dividends: [], splits: [], ...overrides })
const config = (m, overrides = {}) => ({ ...simulatorDefaults(m), start: m.history[0].date, end: m.latest.date, budget: 1000, quantityMode: 'fractional', ...overrides })
const calculate = (m, overrides = {}, events = distribution()) => calculateInvestmentSimulation(m, config(m, overrides), { distribution: events, now })

test('four strategies share the budget and constant prices conserve all assets without fees', () => {
  const m = market(), stats = calculate(m)
  assert.equal(stats.series.length, 4)
  for (const series of stats.series) {
    near(series.current.assets, 1000); near(series.profit, 0); near(series.returnRate, 0); near(series.maxDrawdown, 0)
    near(series.current.spent + series.current.fees + series.current.budgetCash, 1000)
    near(series.orders.reduce((sum, order) => sum + order.allocation, 0), 1000)
  }
  assert.equal(stats.series[0].executedCount, 1)
  assert.equal(stats.series[2].plannedCount, 3)
  assert.equal(stats.series[3].plannedCount, 6)
  assert.equal(stats.series[3].outsideCount, 3)
  near(stats.series[3].current.budgetCash, 500)
})

test('declining prices have independently known shares, profit and drawdown', () => {
  const m = market('2026-01-05', '2026-01-06', (_, i) => i ? 5 : 10)
  const stats = calculate(m, { batchCount: 2, batchInterval: 1 })
  const lump = stats.series[0], batch = stats.series[3]
  near(lump.current.shares, 100); near(lump.current.assets, 500); near(lump.returnRate, -.5); near(lump.maxDrawdown, .5)
  near(batch.current.shares, 150); near(batch.current.assets, 750); near(batch.returnRate, -.25); near(batch.averageCost, 1000 / 150)
  near(batch.maxDrawdown, .25)
})

test('holidays roll forward, end rolls back, colliding plans stay separate and unexecutable allocations remain cash', () => {
  const m = market('2026-02-13', '2026-02-27')
  const stats = calculate(m, { start: '2026-02-14', end: '2026-02-27', weekday: 1, monthDay: 16, batchCount: 3, batchInterval: 7, minFee: 1 })
  assert.equal(stats.startDate, '2026-02-24')
  const weekly = stats.series[1]
  assert.deepEqual(weekly.orders.map(order => [order.plannedDate, order.date]), [['2026-02-16', '2026-02-24'], ['2026-02-23', '2026-02-24']])
  near(weekly.current.fees, 2)
  const terminal = calculate(m, { end: '2026-02-27', weekday: 1, monthDay: 28 })
  assert.equal(terminal.series[2].plannedCount, 0); near(terminal.series[2].current.budgetCash, 1000)
  assert.throws(() => calculateInvestmentSimulation(m, config(m, { start: '2026-02-13', end: '2026-02-22', weekday: 1 }), { distribution: distribution(), now }), /两个交易日/)
})

test('end-of-window holiday targets are not redistributed or executed early', () => {
  const m = market('2026-01-05', '2026-01-12')
  const stats = calculate(m, { end: '2026-01-11', batchCount: 3, batchInterval: 3, monthDay: 10 })
  assert.equal(stats.endDate, '2026-01-09')
  assert.equal(stats.series[3].outsideCount, 1)
  near(stats.series[3].current.budgetCash, 1000 / 3)
  assert.equal(stats.series[2].outsideCount, 1); near(stats.series[2].current.assets, 1000)
})

test('lots carry unused allocations and skip fees when no purchase; exact binary lot boundaries work', () => {
  const m = market('2026-01-05', '2026-01-07', () => 1.1)
  const stats = calculate(m, { budget: 1100, quantityMode: 'lots', batchCount: 3, batchInterval: 1 })
  assert.equal(stats.series[0].current.shares, 1000)
  assert.deepEqual(stats.series[3].orders.map(order => order.quantity), [300, 300, 400])
  const tooSmall = calculate(m, { budget: 100, quantityMode: 'lots', minFee: 5 })
  for (const s of tooSmall.series) { near(s.current.assets, 100); near(s.current.fees, 0); assert.equal(s.executedCount, 0) }
  const fee = calculate(m, { budget: 1000, feePercent: 1, minFee: 5, batchCount: 2, batchInterval: 1 })
  near(fee.series[0].current.spent, 1000 / 1.01); near(fee.series[0].current.fees, 1000 - 1000 / 1.01)
  near(fee.series[3].current.fees, 10)
  for (const s of fee.series) for (const p of s.points) {
    assert.ok(p.cash >= 0); near(p.marketValue + p.cash + p.receivable, p.assets); assert.ok(p.spent + p.fees <= 1000 + 1e-7)
  }
})

test('dividend rights use record-date holdings, ex-date recognizes receivable, paid cash never funds another purchase', () => {
  const m = market('2026-01-05', '2026-01-09', date => date >= '2026-01-07' ? 9 : 10)
  const events = distribution({ dividends: [{ recordDate: '2026-01-06', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: 1 }] })
  const stats = calculate(m, { batchCount: 2, batchInterval: 2 }, events)
  const lump = stats.series[0], batch = stats.series[3]
  near(lump.current.assets, 1000); near(lump.current.income, 100); near(lump.current.cash, 100); near(lump.current.receivable, 0)
  near(lump.points.find(p => p.date === '2026-01-07').receivable, 100)
  near(batch.current.income, 50); near(batch.orders[1].value, 500); near(batch.current.assets, 1000)
  const unpaid = distribution({ dividends: [{ ...events.dividends[0], payDate: '2026-01-12' }] })
  near(calculate(m, {}, unpaid).series[0].current.receivable, 100)
  near(calculate(m, { basis: 'price' }, events).series[0].current.assets, 900)
  const before = distribution({ dividends: [{ recordDate: '2026-01-02', exDate: '2026-01-07', payDate: '2026-01-09', cashPerShare: 1 }] })
  near(calculate(m, {}, before).series[0].current.income, 0)
})

test('record-date close purchases receive rights, splits adjust holdings and average cost, ambiguity blocks results', () => {
  const m = market('2026-01-05', '2026-01-09', date => date >= '2026-01-07' ? 5 : 10)
  const events = distribution({ splits: [{ date: '2026-01-07', ratio: 2 }] })
  const lump = calculate(m, {}, events).series[0]
  near(lump.current.shares, 200); near(lump.current.assets, 1000); near(lump.averageCost, 5)
  const dividend = { recordDate: '2026-01-05', exDate: '2026-01-06', payDate: '2026-01-09', cashPerShare: 1 }
  near(calculate(m, {}, distribution({ dividends: [dividend] })).series[0].current.income, 100)
  assert.throws(() => calculate(m, {}, distribution({ ...events, dividends: [{ ...dividend, exDate: '2026-01-07' }] })), /同日/)
})

test('rejects bad parameters, dates, calendar gaps, future/partial days and wrong identities', () => {
  const m = market()
  for (const overrides of [{ budget: 0 }, { budget: Infinity }, { budget: '100' }, { weekday: 0 }, { monthDay: 31 }, { batchCount: 1.5 }, { batchInterval: 0 }, { feePercent: -1 }, { minFee: -1 }, { quantityMode: 'bad' }, { basis: 'bad' }, { start: '2026-02-30' }, { end: '2026-01-05' }, { end: '2026-04-01' }, { start: '2022-01-01' }]) assert.throws(() => calculate(m, overrides))
  const missing = structuredClone(m); missing.history.splice(2, 1); assert.throws(() => calculate(missing), /缺少/)
  const sunday = structuredClone(m); sunday.history.splice(5, 0, { ...sunday.history[0], date: '2026-01-11' }); assert.throws(() => calculate(sunday), /非交易日/)
  assert.throws(() => calculate({ ...m, source: 'unknown' }), /来源/)
  assert.throws(() => calculate({ ...m, code: '000300' }), /不受支持/)
  assert.throws(() => calculate(m, {}, distribution({ status: 'unavailable', reason: 'failed', coverage: null, checkedAt: null })), /不可用/)
  assert.throws(() => calculate(m, {}, distribution({ coverage: { start: '2018-12-19', end: '2026-01-31' }, checkedAt: '2026-01-31T08:00:00.000Z' })), /未覆盖/)
  const short = market('2026-01-05', '2026-01-06')
  assert.throws(() => calculate(short, { end: '2026-01-05' }), /开始日期/)
  assert.throws(() => calculateInvestmentSimulation(short, config(short), { distribution: distribution({ coverage: { start: '2018-12-19', end: '2026-01-06' }, checkedAt: '2026-01-06T08:00:00.000Z' }), now: new Date('2026-01-06T06:00:00Z') }), /尚未收盘/)
})

test('index is theoretical price-only; published snapshots simulate with defaults and chart uses equal wealth axes', async () => {
  const index = market(undefined, undefined, () => 100, 'H30269')
  const stats = calculateInvestmentSimulation(index, config(index), { now })
  assert.equal(stats.distributionCoverage, null)
  assert.throws(() => calculateInvestmentSimulation(index, config(index, { quantityMode: 'lots' }), { now }), /理论份额/)
  assert.throws(() => calculateInvestmentSimulation(index, config(index, { basis: 'cash' }), { now }), /口径/)
  for (const code of ['512890', 'h30269']) {
    const m = JSON.parse(await readFile(new URL(`../public/data/${code}.json`, import.meta.url)))
    const events = JSON.parse(await readFile(new URL('../public/data/distributions-512890.json', import.meta.url)))
    const result = calculateInvestmentSimulation(m, simulatorDefaults(m), { distribution: events, now })
    assert.ok(result.count > 200); assert.ok(result.series.every(s => Number.isFinite(s.current.assets)))
    const option = investmentSimulatorOption(result)
    assert.equal(option.series.length, 5); assert.equal(option.series[0].data.length, result.count)
    assert.match(option.tooltip.formatter([{ dataIndex: 0 }]), /剩余现金/)
  }
})
