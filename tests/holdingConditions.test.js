import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { holdingEntryEnvironments, filterHoldingWindows, normalizeHoldingFilters, emptyHoldingFilters, classifyHoldingEntry } from '../src/utils/holdingConditions.js'
import { calculateHoldingPeriods, summarizeHoldingWindows } from '../src/utils/holdingPeriods.js'
import { holdingPeriodOption } from '../src/charts/holdingPeriods.js'
import { tradingSessions, shiftDay, tradingDate } from '../src/utils/priceRisk.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'

const now = new Date('2026-10-02T08:00:00.000Z')
function market(code = 'H30269') {
  const history = tradingSessions('2023-01-03', '2026-09-30', tradingCalendar).map((date, index) => {
    const close = 100 + 20 * Math.cos(index / 20) + index / 10
    return { date, close, open: close, low: close, high: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
function valuations(history = [{ date: '2024-02-29', pe: 1, pb: .1 }, { date: '2024-03-01', pe: 8, pb: .8 }, { date: '2024-03-04', pe: 20, pb: 2 }]) {
  return { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, unit: 'multiple', basis: 'provider_unspecified', date: history.at(-1).date, history }
}
function setup(m = market(), valuation = valuations()) {
  const stats = calculateHoldingPeriods(m, { now })
  return { m, stats, environments: holdingEntryEnvironments(m, stats, valuation) }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const filters = changes => normalizeHoldingFilters({ ...emptyHoldingFilters(), ...changes })

test('买入环境只使用前一交易日，回撤和60日波动率匹配独立核算，休市不当成缺价', () => {
  const { m, environments } = setup(), buyDate = '2024-03-04', point = environments.observations.get(buyDate)
  assert.equal(point.referenceDate, '2024-03-01')
  const before = m.history.filter(row => row.date <= point.referenceDate)
  near(point.drawdown, (1 - before.at(-1).close / Math.max(...before.map(row => row.close))) * 100)
  const closes = before.slice(-61).map(row => row.close), returns = closes.slice(1).map((close, index) => close / closes[index] - 1)
  const average = returns.reduce((sum, value) => sum + value, 0) / 60
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / 59
  near(point.volatility, Math.sqrt(variance * 252) * 100)
  assert.equal(point.pe, 8); assert.equal(point.pb, .8); assert.equal(point.valuationDate, point.referenceDate)
  const holiday = environments.observations.get('2024-02-19')
  assert.equal(holiday.referenceDate, '2024-02-08'); assert.ok(Number.isFinite(holiday.volatility))
})

test('买入当天、未来高点和未来估值变化不能改变买入环境，不进行估值插值或沿用', () => {
  const { m, environments } = setup(), before = environments.observations.get('2024-03-04')
  for (const row of m.history.filter(row => row.date >= '2024-03-04')) row.close = row.open = row.low = row.high = row.close * 10
  const changed = setup(m, valuations([{ date: '2024-02-29', pe: 1, pb: .1 }, { date: '2024-03-01', pe: 8, pb: .8 }, { date: '2024-03-04', pe: 999, pb: 99 }]))
  assert.deepEqual(changed.environments.observations.get('2024-03-04'), before)
  const missing = setup(m, valuations([{ date: '2024-02-29', pe: 1, pb: .1 }, { date: '2024-03-04', pe: 20, pb: 2 }])).environments.observations.get('2024-03-04')
  assert.equal(missing.pe, null); assert.equal(missing.pb, null); assert.match(missing.reasons.pe, /不沿用/)
  const bad = valuations(); bad.provider = 'CSI'
  const invalid = setup(m, bad).environments
  assert.match(invalid.valuation.reason, /格式异常/); assert.equal(invalid.observations.get('2024-03-04').pe, null)
  near(invalid.observations.get('2024-03-04').volatility, before.volatility)
})

test('缺买入前价格和历史回撤高点、波动率热身不足保留未知，缺口后的波动率仅在完整61日后恢复', () => {
  const { m, environments } = setup()
  const first = environments.observations.get(m.history[0].date)
  assert.equal(first.drawdown, null); assert.equal(first.volatility, null)
  assert.equal(environments.observations.get(m.history[60].date).volatility, null)
  assert.ok(Number.isFinite(environments.observations.get(m.history[61].date).volatility))
  const gapDate = m.history[200].date, buyAfter = m.history[201].date, recoveryBuy = m.history[262].date
  m.history = m.history.filter(row => row.date !== gapDate)
  const broken = setup(m).environments
  assert.equal(broken.observations.get(buyAfter).drawdown, null); assert.equal(broken.observations.get(buyAfter).volatility, null)
  assert.equal(broken.observations.get(recoveryBuy).drawdown, null)
  assert.ok(Number.isFinite(broken.observations.get(recoveryBuy).volatility))
  assert.match(broken.observations.get(recoveryBuy).reasons.drawdown, /历史有行情缺口/)
})

test('条件AND且包含上下界；缺失窗口单列，不因另一条件为假归入不符合组；独立算例统计与分母正确', () => {
  const dates = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08']
  const points = dates.map((buyDate, index) => ({ status: 'complete', buyDate, targetDate: '2025-01-02', exitDate: '2025-01-02', returnRate: [.1, -.2, .3, -.4, .5][index] }))
  const environments = { observations: new Map(dates.map((date, index) => [date, { drawdown: [10, 20, 3, null, 15][index], volatility: [15, 20, 10, 15, null][index], pe: [8, 9, null, 8, 8][index], pb: 1 }])) }
  const series = summarizeHoldingWindows(1, points, { immatureCount: 3, missingCount: 2, candidateCount: 10 })
  const input = filters({ drawdown: { min: 10, max: 20 }, volatility: { min: null, max: 15 } })
  const study = filterHoldingWindows(series, environments, input)
  assert.equal(study.matched.count, 1); assert.equal(study.excluded.count, 2); assert.equal(study.unknownCount, 2)
  assert.equal(study.knownCount, 3); near(study.matched.mean, .1); near(study.excluded.mean, .05)
  assert.equal(study.excluded.positiveRate, .5); assert.equal(study.baseline.positiveRate, .6)
  assert.equal(study.matched.immatureCount, 3); assert.equal(study.matched.missingCount, 2)
  assert.equal(study.unknownByCondition.drawdown, 1); assert.equal(study.unknownByCondition.volatility, 1)
  assert.equal(study.matched.bins.reduce((sum, bin) => sum + bin.count, 0), 1)
  assert.equal(classifyHoldingEntry({ drawdown: 0, volatility: null }, input).status, 'unknown')
  assert.equal(classifyHoldingEntry({ drawdown: 20, volatility: 15 }, input).status, 'complete')
  assert.equal(classifyHoldingEntry({ drawdown: 20.0001, volatility: 15 }, input).status, 'excluded')
  const none = filterHoldingWindows(series, environments, filters({ drawdown: { min: 90, max: 100 } }))
  assert.equal(none.matched.count, 0); assert.equal(none.matched.positiveRate, null); assert.equal(none.matched.mean, null)
  assert.equal(none.matched.best, null); assert.ok(none.matched.bins.every(bin => bin.count === 0))
})

test('清除条件恢复全部完整窗口，不删除价格缺失或条件不符处的曲线空点，输入统计不被修改', () => {
  const { stats, environments } = setup(), series = stats.series[0], original = structuredClone(series)
  const active = filterHoldingWindows(series, environments, filters({ drawdown: { min: 10, max: null } }))
  assert.ok(active.matched.count > 0 && active.excluded.count > 0 && active.unknownCount > 0)
  assert.equal(active.matched.points.length, series.points.length)
  const option = holdingPeriodOption(active.matched)
  assert.equal(option.series[0].connectNulls, false)
  const index = active.matched.points.findIndex(point => point.status === 'excluded')
  assert.equal(option.series[0].data[index], null); assert.match(option.tooltip.formatter([{ seriesId: 'holding-returns', dataIndex: index }]), /不符合条件/)
  const unknownIndex = active.matched.points.findIndex(point => point.status === 'unknown')
  assert.match(option.tooltip.formatter([{ seriesId: 'holding-returns', dataIndex: unknownIndex }]), /条件缺失/)
  assert.match(option.title[0].text, /符合条件/)
  const cleared = filterHoldingWindows(series, environments, emptyHoldingFilters())
  assert.equal(cleared.active, false); assert.equal(cleared.matched.count, series.count); assert.equal(cleared.unknownCount, 0)
  near(cleared.matched.mean, series.mean); assert.deepEqual(series, original)
})

test('零回撤与零波动率是有效值，空条件不排除缺失估值；倒置、负数、无穷或坏条件明确拒绝', () => {
  const m = market(); for (const row of m.history) row.close = row.open = row.low = row.high = 100
  const { stats, environments } = setup(m, null)
  const study = filterHoldingWindows(stats.series[0], environments, filters({ drawdown: { min: 0, max: 0 }, volatility: { min: 0, max: 0 } }))
  assert.ok(study.matched.count > 0); assert.equal(study.excluded.count, 0); assert.equal(study.matched.flat, study.matched.count)
  assert.equal(study.unknownCount, 61)
  for (const range of [{ min: 11, max: 10 }, { min: -1, max: '' }, { min: Infinity, max: '' }, { min: 'bad', max: '' }, { min: true, max: '' }, { min: 101, max: '' }]) assert.throws(() => filters({ drawdown: range }))
  assert.throws(() => normalizeHoldingFilters(null), /格式异常/)
})

test('ETF收益口径改变结果但不改变买入环境组，核验交集之前的已知价格仍可用于热身', () => {
  const m = market('512890')
  const distribution = { schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', status: 'ok', reason: null,
    checkedAt: now.toISOString(), coverage: { start: '2018-12-19', end: '2026-10-02' }, splits: [],
    dividends: [{ recordDate: '2024-06-03', exDate: '2024-06-04', payDate: '2024-06-05', cashPerShare: 1 }] }
  const cash = calculateHoldingPeriods(m, { basis: 'cash', distribution, now }), price = calculateHoldingPeriods(m, { basis: 'price', distribution, now })
  const environments = holdingEntryEnvironments(m, cash, null)
  const subset = holdingEntryEnvironments(m, { ...cash, startDate: '2024-01-02' }, null)
  assert.ok(Number.isFinite(subset.observations.get('2024-01-02').volatility))
  assert.ok(Number.isFinite(subset.observations.get('2024-01-02').drawdown))
  const input = filters({ drawdown: { min: 5, max: null } })
  const cashGroup = filterHoldingWindows(cash.series[0], environments, input), priceGroup = filterHoldingWindows(price.series[0], environments, input)
  assert.deepEqual(cashGroup.matched.windows.map(point => point.buyDate), priceGroup.matched.windows.map(point => point.buyDate))
  assert.ok(cashGroup.matched.mean > priceGroup.matched.mean)
})

test('收益窗口缺价先排除，环境筛选不把缺收益窗口放入任一比较分母或恢复曲线', () => {
  const m = market(); m.history = m.history.filter(row => row.date !== '2024-06-03')
  const { stats, environments } = setup(m), series = stats.series[0]
  assert.ok(series.missingCount > 0)
  const study = filterHoldingWindows(series, environments, filters({ volatility: { min: 0, max: 100 } }))
  assert.equal(study.matched.count + study.excluded.count + study.unknownCount, series.count)
  const index = study.matched.points.findIndex(point => point.status === 'missing')
  assert.ok(index >= 0); assert.equal(holdingPeriodOption(study.matched).series[0].data[index], null)
  assert.equal(study.matched.missingCount, series.missingCount)
})

test('真实ETF和指数已有估值覆盖不足已到期窗口，不凭最新PE回填；回撤条件仍可分组，未到期计数不变', async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url)))
  const valuation = await load('valuation-history-h30269.json'), distribution = await load('distributions-512890.json')
  for (const name of ['512890', 'h30269']) {
    const m = await load(`${name}.json`), stats = calculateHoldingPeriods(m, { now, distribution })
    const environments = holdingEntryEnvironments(m, stats, valuation)
    for (const series of stats.series) {
      const byPe = filterHoldingWindows(series, environments, filters({ pe: { min: 0, max: 10 } }))
      assert.equal(byPe.unknownCount, series.count); assert.equal(byPe.matched.count, 0); assert.equal(byPe.excluded.count, 0)
      const byDraw = filterHoldingWindows(series, environments, filters({ drawdown: { min: 5, max: null } }))
      assert.ok(byDraw.matched.count > 0); assert.equal(byDraw.matched.immatureCount, series.immatureCount)
      assert.equal(byDraw.matched.count + byDraw.excluded.count + byDraw.unknownCount, series.count)
      const one = byDraw.matched.windows[0], day = tradingDate(shiftDay(one.buyDate, -1), -1, tradingCalendar)
      assert.equal(one.environment.referenceDate, day); assert.ok(day < one.buyDate)
    }
  }
})
