import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLatestMetrics, calculatePerformance, dateTimestamp, DIVIDEND_SOURCE, formatLatestMetric, isTradingDay, performanceWindow, validateLatestMetrics } from '../src/utils/latestMetrics.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'
import { getLatestMetrics } from '../src/api/latestMetrics.js'
import { generateLatestMetrics } from '../scripts/build-latest-metrics.mjs'

const NOW = new Date('2026-09-26T04:00:00Z')
const fixtureCalendar = { id: 'synthetic-test-only', start: '2022-01-01', end: '2026-12-31', sources: ['test-fixture'], closures: [] }
function marketFixture({ start = '2025-09-24', end = '2026-09-24', calendar, close = i => 100 + i / 10 + Math.sin(i) } = {}) {
  const history = []
  for (let time = dateTimestamp(start), i = 0; time <= dateTimestamp(end); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10)
    if (isTradingDay(date, calendar)) history.push({ date, close: close(i++) })
  }
  return { code: 'H30269', source: 'eastmoney', interval: '1d', history, latest: { ...history.at(-1) }, updatedAt: '2026-09-24T08:00:00Z' }
}
const valuation = { code: 'H30269', source: VALUATION_SOURCE, provider: 'Eastmoney', unit: 'multiple', basis: 'provider_unspecified', date: '2026-09-18', pe: 8.37889046, pb: 0.777 }
const dividend = { code: 'H30269', source: DIVIDEND_SOURCE, unit: 'percent', basis: 'total_share_capital', date: '2026-09-18', value: 4.31 }
const build = (patch = {}) => buildLatestMetrics({ market: marketFixture(), valuation, dividend, now: NOW, ...patch })
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

test('official calendar closes holidays and make-up weekends, rejects unknown years', () => {
  assert.equal(isTradingDay('2026-09-25'), false)
  assert.equal(isTradingDay('2026-02-28'), false)
  assert.equal(isTradingDay('2026-02-24'), true)
  assert.equal(isTradingDay('2023-05-03'), false)
  assert.equal(isTradingDay('2023-05-04'), true)
  assert.equal(isTradingDay('2024-02-09'), false)
  assert.equal(isTradingDay('2024-02-18'), false)
  assert.equal(isTradingDay('2024-02-19'), true)
  assert.throws(() => isTradingDay('2022-12-30'), /日历待核验/)
  assert.throws(() => isTradingDay('2027-01-04'), /日历待核验/)
})

test('all-history window keeps supplied endpoints and rejects non-session boundaries', () => {
  assert.deepEqual(performanceWindow('2023-03-01', '2026-09-24'), { start: '2023-03-01', end: '2026-09-24' })
  assert.throws(() => performanceWindow('2024-02-09', '2026-09-24'), /首条行情日期不是交易日/)
  assert.throws(() => performanceWindow('2023-03-01', '2026-09-25'), /最新行情日期不是交易日/)
})

test('ACT/365 leap interval includes newly added early history and its peak', () => {
  const market = marketFixture({ start: '2023-02-28', end: '2024-02-29', calendar: fixtureCalendar })
  const original = calculatePerformance(market, { calendar: fixtureCalendar, now: NOW })
  assert.equal(original.calculation.calendarDays, 366)
  near(original.values.annualReturn, (market.latest.close / market.history[0].close) ** (365 / 366) - 1)
  market.history.unshift({ date: '2023-02-27', close: 100000 })
  const expanded = calculatePerformance(market, { calendar: fixtureCalendar, now: NOW })
  assert.equal(expanded.calculation.windowStart, '2023-02-27')
  assert.equal(expanded.calculation.priceCount, market.history.length)
  near(expanded.values.annualReturn, (market.latest.close / 100000) ** (365 / 367) - 1)
  near(expanded.values.maxDrawdown, 1 - Math.min(...market.history.map(row => row.close)) / 100000)
  assert.notEqual(expanded.values.sharpe, original.values.sharpe)
  market.history.reverse()
  assert.deepEqual(calculatePerformance(market, { calendar: fixtureCalendar, now: NOW }), expanded)
})

test('drawdown uses first tied peak and earliest maximum trough; no intraday lows', () => {
  const market = marketFixture({ close: i => [100, 120, 120, 90, 90][i] ?? 110 })
  market.history[0].low = 1
  const result = calculatePerformance(market, { now: NOW })
  near(result.values.maxDrawdown, 0.25)
  assert.equal(result.calculation.drawdownPeakDate, market.history[1].date)
  assert.equal(result.calculation.drawdownTroughDate, market.history[3].date)
})

test('flat and constant-return series have no Sharpe; valid other metrics survive', () => {
  for (const close of [() => 100, i => 100 * 1.001 ** i]) {
    const output = build({ market: marketFixture({ close }) })
    assert.equal(output.metrics.sharpe.value, null)
    assert.equal(output.metrics.sharpe.status, 'unavailable')
    assert.equal(output.metrics.maxDrawdown.value, 0)
    assert.equal(output.metrics.annualReturn.status, 'ok')
  }
})

test('negative returns and dimensionless Sharpe, ratio conversion and negative zero', () => {
  const data = build({ market: marketFixture({ close: i => 100 - i / 10 + Math.sin(i) / 2 }) })
  assert.ok(data.metrics.annualReturn.value < 0)
  assert.ok(data.metrics.sharpe.value < 0)
  assert.equal(data.metrics.dividendYield.value, 0.0431)
  assert.equal(formatLatestMetric(data.metrics.dividendYield), '4.31%')
  assert.equal(formatLatestMetric({ value: -0.17, unit: 'dimensionless' }), '-0.17')
  assert.equal(formatLatestMetric({ value: -0.000001, unit: 'ratio' }), '0.00%')
  assert.equal(formatLatestMetric({ value: null }), '—')
  assert.equal(build({ dividend: { ...dividend, value: 0 } }).metrics.dividendYield.value, 0)
})

test('alternating known returns verify arithmetic Sharpe with sample standard deviation', () => {
  const market = marketFixture({ close: i => 100 * (1.01 * 0.98) ** Math.floor(i / 2) * (i % 2 ? 1.01 : 1) })
  const result = calculatePerformance(market, { now: NOW })
  assert.equal(result.calculation.returnCount, 242)
  near(result.calculation.dailyMean, -0.005)
  near(result.calculation.dailySampleStd, 0.015 * Math.sqrt(242 / 241))
  near(result.values.sharpe, Math.sqrt(252) * -0.005 / (0.015 * Math.sqrt(242 / 241)))
  near(result.values.annualReturn, (1.01 * 0.98) ** 121 - 1)
})

test('reject gaps, duplicated dates, malformed values and wrong instrument; no silent cleaning', () => {
  const cases = [
    m => m.history.splice(10, 1),
    m => m.history.push({ ...m.history[0] }),
    m => { m.history[10].close = null },
    m => { m.history[10].close = true },
    m => { m.history[10].date = '2026-02-30' },
    m => { m.code = '512890' },
    m => { m.latest.close = 1 },
    m => m.history.push({ date: '2026-09-20', close: 100 }),
  ]
  for (const change of cases) {
    const market = marketFixture(); change(market)
    assert.throws(() => calculatePerformance(market, { now: NOW }))
    const result = build({ market })
    assert.equal(result.metrics.annualReturn.status, 'unavailable')
    assert.equal(result.metrics.pe.status, 'ok')
  }
})

test('short histories use actual elapsed days; one point has no performance results', () => {
  const market = marketFixture({ start: '2026-09-21', close: i => [100, 110, 99, 108][i] })
  const result = build({ market })
  assert.equal(result.calculation.calendarDays, 3)
  near(result.metrics.annualReturn.value, 1.08 ** (365 / 3) - 1)
  near(result.metrics.maxDrawdown.value, 0.1)
  assert.equal(result.calculation.returnCount, 3)
  const pair = build({ market: marketFixture({ start: '2026-09-23' }) })
  assert.equal(pair.metrics.annualReturn.status, 'ok')
  assert.equal(pair.metrics.sharpe.value, null)
  const single = build({ market: marketFixture({ start: '2026-09-24' }) })
  assert.equal(single.calculation, null)
  assert.match(single.metrics.annualReturn.reason, /收益样本不足/)
})

test('interior gaps are rejected; calendar coverage and close time enforced', () => {
  const market = marketFixture()
  market.history.unshift({ date: '2025-09-23', close: 100 })
  market.history.splice(1, 1)
  assert.throws(() => calculatePerformance(market, { now: NOW }), /缺失/)
  assert.throws(() => calculatePerformance(marketFixture(), { now: '2026-09-24T06:59:59Z' }), /尚未收盘/)
  assert.throws(() => calculatePerformance(marketFixture(), { now: '2026-09-23T08:00:00Z' }), /晚于今天/)
  assert.doesNotThrow(() => calculatePerformance(marketFixture(), { now: '2026-09-24T07:00:00Z' }))
  assert.throws(() => calculatePerformance(marketFixture(), { calendar: { ...fixtureCalendar, start: '2026-01-01' }, now: NOW }), /日历待核验/)
})

test('failures retain original calculation window, source dates and good independent metrics', () => {
  const previous = build()
  const market = marketFixture({ end: '2026-09-28' }); market.history.splice(10, 1)
  const data = build({ previous, market, now: '2026-09-28T08:00:00Z', inputErrors: { valuation: '上游失败' } })
  assert.equal(data.metrics.pe.status, 'stale')
  assert.equal(data.metrics.pe.asOf, '2026-09-18')
  assert.equal(data.metrics.dividendYield.status, 'ok')
  assert.deepEqual(data.calculation, previous.calculation)
  for (const key of ['annualReturn', 'maxDrawdown', 'sharpe']) {
    assert.equal(data.metrics[key].status, 'stale')
    assert.equal(data.metrics[key].asOf, '2026-09-24')
  }
  const staleAgain = build({ previous: data, inputErrors: { market: '再次失败' } })
  assert.equal(staleAgain.calculation.windowEnd, '2026-09-24')
  const recovered = build({ previous: data })
  assert.equal(recovered.metrics.annualReturn.status, 'ok')
})

test('snapshot dates do not imply failure; bad values, sources and date regression do', () => {
  const previous = build()
  assert.equal(previous.metrics.pe.status, 'ok')
  for (const patch of [{ pe: null }, { pe: true }, { pe: 0 }, { date: '2026-09-17' }, { date: '2026-09-27' }, { source: 'other' }]) {
    const data = build({ previous, valuation: { ...valuation, ...patch } })
    assert.equal(data.metrics.pe.status, 'stale')
    assert.equal(data.metrics.pe.value, valuation.pe)
  }
  const data = build({ valuation: { ...valuation, pe: null } })
  assert.equal(data.metrics.pb.status, 'ok')
  assert.equal(data.metrics.pe.value, null)
  const oldVersion = { ...previous, ruleVersion: 'old' }
  assert.equal(build({ previous: oldVersion, inputErrors: { market: '失败' } }).calculation, null)
})

test('zero-volatility stale group retains null Sharpe and recovers; regressed market is rejected', () => {
  const previous = build({ market: marketFixture({ close: () => 100 }) })
  const failed = build({ previous, inputErrors: { market: '行情更新失败' } })
  assert.equal(failed.metrics.sharpe.status, 'stale')
  assert.equal(failed.metrics.sharpe.value, null)
  assert.deepEqual(failed.calculation, previous.calculation)
  assert.equal(build({ previous: failed }).metrics.sharpe.status, 'ok')
  const regressed = build({ previous, market: marketFixture({ end: '2026-09-23' }) })
  assert.equal(regressed.metrics.annualReturn.status, 'stale')
  assert.equal(regressed.metrics.annualReturn.reason, '行情日期倒退')
  assert.equal(regressed.calculation.windowEnd, '2026-09-24')
})

test('legacy one-year sample still agrees with independent reference when unchanged', async t => {
  const reference = JSON.parse(await readFile(new URL('../docs/research/latest-metrics-stage2-reference-2026-09-26.json', import.meta.url), 'utf8'))
  const raw = await readFile(new URL('../public/data/h30269.json', import.meta.url), 'utf8')
  const { createHash } = await import('node:crypto')
  if (createHash('sha256').update(raw).digest('hex') !== reference.sourceSha256) return t.skip('市场文件已更新；固定公式测试仍独立运行')
  const market = JSON.parse(raw)
  market.history = market.history.filter(row => row.date >= '2025-09-24' && row.date <= '2026-09-24')
  market.latest = { ...market.history.at(-1) }
  const result = calculatePerformance(market, { now: NOW })
  near(result.values.annualReturn, reference.annualReturn)
  near(result.values.maxDrawdown, reference.maxDrawdown)
  near(result.values.sharpe, reference.sharpe)
  assert.equal(result.calculation.priceCount, 243)
})

test('file generator preserves unchanged timestamp and retains data on unreadable source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'latest-metrics-'))
  try {
    for (const [name, data] of Object.entries({ h30269: marketFixture(), 'valuation-h30269': valuation, 'dividend-h30269': dividend })) await writeFile(join(directory, `${name}.json`), JSON.stringify(data))
    const first = await generateLatestMetrics({ directory, now: NOW })
    assert.equal(first.failed, false)
    assert.equal(first.changed, true)
    assert.match(first.data.calculation.inputSummary.sha256, /^[a-f0-9]{64}$/)
    const second = await generateLatestMetrics({ directory, now: new Date(NOW.getTime() + 1000) })
    assert.equal(second.changed, false)
    assert.equal(second.data.generatedAt, first.data.generatedAt)
    await writeFile(join(directory, 'h30269.json'), '{bad')
    const failed = await generateLatestMetrics({ directory, now: NOW })
    assert.equal(failed.failed, true)
    assert.equal(failed.data.metrics.annualReturn.status, 'stale')
    assert.deepEqual(failed.data.calculation, first.data.calculation)
    const file = JSON.parse(await readFile(join(directory, 'latest-metrics-h30269.json'), 'utf8'))
    assert.deepEqual(validateLatestMetrics(file), failed.data)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('API always reads H30269 output and rejects incompatible metadata', async () => {
  const data = build()
  const fetched = await getLatestMetrics({ cacheKey: 123, fetcher: async (url, options) => {
    assert.equal(url, '/data/latest-metrics-h30269.json?t=123')
    assert.equal(options.cache, 'no-store')
    return Response.json(data)
  } })
  assert.deepEqual(fetched, data)
  for (const change of [d => { d.code = '512890' }, d => { d.ruleVersion = 'latest-metrics-v1' }, d => { d.calculation.windowMode = 'trailing_year' }, d => { d.calculation.inputSummary.historyCount += 1 }, d => { d.metrics.dividendYield.unit = 'percent' }, d => { d.metrics.sharpe.value = '0.2' }, d => { d.calculation.windowEnd = '2026-09-23' }]) {
    const bad = structuredClone(data); change(bad)
    await assert.rejects(getLatestMetrics({ fetcher: async () => Response.json(bad) }))
  }
  await assert.rejects(getLatestMetrics({ fetcher: async () => new Response('', { status: 503 }) }), /无法读取/)
})
