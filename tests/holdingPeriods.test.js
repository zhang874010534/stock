import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { calculateHoldingPeriods, holdingAnniversary, holdingReturnBins } from '../src/utils/holdingPeriods.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { tradingSessions, dateTimestamp } from '../src/utils/priceRisk.js'
import { calculateEtfReturn, ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { holdingPeriodOption } from '../src/charts/holdingPeriods.js'
import { initHoldingPeriod } from '../src/charts/holdingPeriodRuntime.js'

const now = new Date('2026-10-01T08:00:00Z')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
function market(start = '2023-01-03', end = '2026-09-30', price = () => 10, code = 'H30269', calendar = tradingCalendar) {
  const history = tradingSessions(start, end, calendar).map((date, i) => {
    const close = price(date, i); return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
const distribution = (overrides = {}) => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share',
  coverage: { start: '2018-12-19', end: '2026-10-01' }, checkedAt: now.toISOString(), status: 'ok', reason: null, dividends: [], splits: [], ...overrides })
const analyze = (m, options = {}) => calculateHoldingPeriods(m, { now, ...options })

test('anniversaries use calendar years and clamp leap days; holidays roll forward and immature buys never shorten', () => {
  assert.equal(holdingAnniversary('2024-02-29', 1), '2025-02-28')
  assert.equal(holdingAnniversary('2024-02-29', 3), '2027-02-28')
  assert.throws(() => holdingAnniversary('2024-02-30', 1), /日期/)
  assert.throws(() => holdingAnniversary('2024-02-29', 2), /一年或三年/)
  const m = market('2023-09-28', '2024-10-08')
  const result = analyze(m), series = result.series[0]
  const point = series.windows.find(item => item.buyDate === '2023-09-28')
  assert.equal(point.targetDate, '2024-09-28'); assert.equal(point.exitDate, '2024-09-30'); assert.equal(point.holdingDays, 368)
  assert.ok(series.windows.every(item => item.exitDate >= item.targetDate && item.exitDate <= result.endDate))
  assert.equal(series.candidateCount, series.count + series.immatureCount + series.missingCount)
  const edge = analyze(market('2023-10-09', '2024-10-08')).series[0]
  assert.equal(edge.count, 0); assert.equal(edge.immatureCount, edge.candidateCount)
  assert.equal(edge.positiveRate, null); assert.equal(edge.median, null); assert.equal(edge.best, null)
})

test('flat prices produce exact flat samples, null statistics when no three-year samples, and earliest tied extrema', () => {
  const result = analyze(market('2024-01-02', '2026-09-30'))
  const one = result.series[0], three = result.series[1]
  assert.ok(one.count > 300); assert.equal(one.positive, 0); assert.equal(one.negative, 0); assert.equal(one.flat, one.count)
  near(one.positiveRate, 0); near(one.median, 0); near(one.mean, 0)
  assert.equal(one.best.buyDate, one.firstBuyDate); assert.equal(one.worst.buyDate, one.firstBuyDate)
  assert.equal(one.bins[3].count, one.count)
  assert.equal(three.count, 0); assert.equal(three.mean, null); assert.equal(three.positiveRate, null)
  assert.equal(three.bins.reduce((n, bin) => n + bin.count, 0), 0)
})

test('known mixed returns verify raw classification, interpolated median/quantiles and cumulative three-year returns', () => {
  const m = market('2023-01-03', '2024-01-05', date => ({ '2024-01-03': 8, '2024-01-04': 10, '2024-01-05': 15 })[date] ?? 10)
  const one = analyze(m).series[0]
  assert.deepEqual(one.windows.map(p => p.buyDate), ['2023-01-03', '2023-01-04', '2023-01-05'])
  near(one.windows[0].returnRate, -.2); near(one.windows[1].returnRate, 0); near(one.windows[2].returnRate, .5)
  assert.equal(one.positive, 1); assert.equal(one.negative, 1); assert.equal(one.flat, 1); near(one.positiveRate, 1 / 3)
  near(one.mean, .1); near(one.median, 0); near(one.p10, -.16); near(one.p25, -.1); near(one.p75, .25); near(one.p90, .4)
  assert.equal(one.worst.buyDate, '2023-01-03'); assert.equal(one.best.buyDate, '2023-01-05')
  const three = analyze(market(undefined, undefined, day => day >= '2026-01-01' ? 20 : 10)).series[1]
  assert.ok(three.count > 100); near(three.windows[0].returnRate, 1)
})

test('bins classify every boundary once, including separate zero and tails', () => {
  const values = [-.8, -.2, -.1, -.00001, 0, .00001, .1, .2, .5, 1]
  assert.deepEqual(holdingReturnBins(values).map(bin => bin.count), [1, 1, 2, 1, 2, 1, 1, 1])
})

test('missing endpoints and interior sessions exclude only affected mature windows, with exact accounting and chart gaps', () => {
  const complete = market(), baseline = analyze(complete)
  const m = structuredClone(complete); m.history = m.history.filter(row => row.date !== '2024-06-03')
  const result = analyze(m)
  assert.equal(result.missingSessions, 1)
  for (let i = 0; i < 2; i++) {
    const affected = baseline.series[i].windows.filter(point => point.buyDate <= '2024-06-03' && point.exitDate >= '2024-06-03')
    const series = result.series[i]
    assert.equal(series.missingCount, affected.length); assert.equal(series.count, baseline.series[i].count - affected.length)
    assert.equal(series.immatureCount, baseline.series[i].immatureCount)
    assert.ok(series.points.filter(point => point.status === 'missing').every(point => point.returnRate === null))
    assert.equal(series.count + series.immatureCount + series.missingCount, series.candidateCount)
  }
})

test('calendar and stale ETF coverage restrict the scope without pretending later samples completed', () => {
  const fixtureCalendar = { ...tradingCalendar, id: 'fixture', start: '2022-01-01' }
  const result = analyze(market('2022-09-06', undefined, undefined, 'H30269', fixtureCalendar))
  assert.equal(result.startDate, '2023-01-03'); assert.ok(result.excludedBefore > 0)
  const m = market(undefined, undefined, undefined, '512890')
  const old = distribution({ status: 'stale', reason: 'offline', coverage: { start: '2018-12-19', end: '2025-09-30' }, checkedAt: '2025-09-30T08:00:00.000Z' })
  const limited = analyze(m, { distribution: old })
  assert.equal(limited.endDate, '2025-09-30'); assert.ok(limited.excludedAfter > 0)
  assert.equal(limited.series[1].count, 0)
  const expiredCalendar = { ...tradingCalendar, end: '2025-12-31' }
  const limitedIndex = analyze(market(), { calendar: expiredCalendar })
  assert.equal(limitedIndex.endDate, '2025-12-31'); assert.ok(limitedIndex.excludedAfter > 0)
})

test('ETF cash entitlement, payments and split shares agree with independently reused holding return for each buy date', () => {
  const m = market('2023-01-03', '2024-03-01', date => date >= '2023-10-09' ? 4 : 10, '512890')
  const events = distribution({ splits: [{ date: '2023-10-09', ratio: 2 }], dividends: [
    { recordDate: '2023-01-04', exDate: '2023-01-05', payDate: '2023-01-09', cashPerShare: 1 },
    { recordDate: '2024-01-02', exDate: '2024-01-03', payDate: '2024-01-08', cashPerShare: 1 },
  ] })
  const result = analyze(m, { distribution: events }), one = result.series[0]
  const first = one.windows[0]
  near(first.shares, 2); near(first.income, 3); near(first.received, 1); near(first.receivable, 2); near(first.returnRate, .1)
  near(one.windows.find(p => p.buyDate === '2023-01-04').income, 3)
  near(one.windows.find(p => p.buyDate === '2023-01-05').income, 2)
  for (const point of one.windows) {
    const rows = m.history.filter(row => row.date >= point.buyDate && row.date <= point.exitDate)
    const reference = calculateEtfReturn(rows, events, { now })
    near(point.returnRate, reference.current.totalReturn); near(point.received, reference.received); near(point.receivable, reference.receivable)
  }
  const price = analyze(m, { distribution: events, basis: 'price' }).series[0].windows[0]
  near(price.returnRate, -.2); near(price.income, 0)
})

test('invalid identities, future/partial days, malformed/unknown events and non-sessions never fabricate results', () => {
  const m = market()
  assert.throws(() => analyze({ ...m, source: 'unknown' }), /来源/)
  assert.throws(() => analyze({ ...m, code: '000300' }), /不受支持/)
  assert.throws(() => analyze(m, { basis: 'cash' }), /价格收益/)
  assert.throws(() => analyze(m, { now: new Date('2026-09-30T06:00:00Z') }), /尚未收盘/)
  assert.throws(() => analyze(m, { now: new Date('2026-09-29T08:00:00Z') }), /未来/)
  const weekend = structuredClone(m); weekend.history.splice(4, 0, { ...weekend.history[0], date: '2023-01-07' }); assert.throws(() => analyze(weekend), /非交易日/)
  const etf = market(undefined, undefined, undefined, '512890')
  assert.throws(() => analyze(etf), /身份或单位/)
  assert.throws(() => analyze(etf, { distribution: distribution({ status: 'unavailable', reason: 'no data', coverage: null, checkedAt: null }) }), /不可用/)
  assert.throws(() => analyze(etf, { distribution: distribution({ splits: [{ date: '2023-04-03', ratio: 2 }], dividends: [{ recordDate: '2023-04-03', exDate: '2023-04-04', payDate: '2023-04-06', cashPerShare: .1 }] }) }), /同日/)
  assert.throws(() => analyze(etf, { distribution: distribution({ dividends: [{ recordDate: '2023-04-03', exDate: '2023-04-03', payDate: '2023-04-06', cashPerShare: .1 }] }) }), /同日/)
})

test('real snapshots have complete one/three-year samples matching independent date lookup and ECharts renders both charts', async () => {
  for (const name of ['h30269', '512890']) {
    const m = JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url)))
    const events = JSON.parse(await readFile(new URL('../public/data/distributions-512890.json', import.meta.url)))
    // Real snapshots advance independently of the fixed formula-test clock.
    // Validate them at their recorded observation time and after market close.
    const snapshotNow = new Date(Math.max(now.getTime(), Date.parse(events.checkedAt), Date.parse(`${m.latest.date}T08:00:00Z`)))
    const result = analyze(m, { distribution: events, now: snapshotNow })
    assert.ok(result.series.every(series => series.count > 100 && series.missingCount === 0))
    for (const series of result.series) for (const point of series.windows) {
      const target = new Date(`${point.buyDate}T00:00:00Z`); target.setUTCFullYear(target.getUTCFullYear() + series.years)
      if (target.getUTCMonth() !== new Date(point.buyDate).getUTCMonth()) target.setUTCDate(0)
      const expectedExit = m.history.find(row => dateTimestamp(row.date) >= target.getTime())
      assert.equal(point.exitDate, expectedExit.date)
    }
    use([SVGRenderer])
    const chart = initHoldingPeriod(null, { renderer: 'svg', ssr: true, width: 800, height: 570 })
    try {
      const series = result.series[0], option = holdingPeriodOption(series)
      chart.setOption(option)
      assert.equal(chart.getOption().grid.length, 2); assert.equal(chart.getOption().series.length, 3)
      assert.ok(chart.renderToSVGString().includes('<svg'))
      assert.equal(option.dataZoom[1].xAxisIndex, 0)
      assert.equal(option.dataZoom[1].showDetail, false)
      assert.match(option.tooltip.formatter([{ seriesId: 'holding-returns', dataIndex: 0 }]), /买入.*目标周年.*到期.*持有收益/)
      assert.match(option.tooltip.formatter([{ seriesId: 'holding-distribution', dataIndex: 3 }]), /恰为 0%/)
    } finally { chart.dispose() }
  }
})
