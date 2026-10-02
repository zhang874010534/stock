import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEtfNav } from '../scripts/lib/etf-nav.mjs'
import { refreshEtfNav } from '../scripts/fetch-etf-nav.mjs'
import { getEtfNav } from '../src/api/etfNav.js'
import { validateEtfNav } from '../src/utils/etfNav.js'
import { calculateEtfPremium, calculateNavTracking } from '../src/utils/etfNavAnalysis.js'
import { ETF_DISTRIBUTION_SOURCE } from '../src/utils/etfDistributions.js'
import { etfNavOption } from '../src/charts/etfNav.js'

const now = new Date('2026-09-30T12:00:00.000Z')
const calendar = { start: '2026-01-01', end: '2026-12-31', closures: [] }
const dates = ['2026-09-28', '2026-09-29', '2026-09-30']
const source = (values = [1, 1.1, 1.21], days = dates) => `var fS_code = "512890"; var Data_netWorthTrend = ${JSON.stringify(days.map((date, i) => ({ x: Date.parse(date + 'T00:00:00+08:00'), y: values[i] })))}; var Data_ACWorthTrend = ${JSON.stringify(days.map((date, i) => [Date.parse(date + 'T00:00:00+08:00'), values[i] * 2]))};`
const nav = (values, days) => parseEtfNav(source(values, days), now)
const market = (values = [1, 1.05, 1.1025], days = dates, code = '512890') => {
  const history = days.map((date, i) => ({ date, open: values[i], close: values[i], high: values[i], low: values[i] }))
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: true }, history, latest: history.at(-1) }
}
const events = changes => ({ schemaVersion: 1, code: '512890', source: ETF_DISTRIBUTION_SOURCE, unit: 'CNY_per_share', coverage: { start: '2018-12-19', end: '2026-09-30' }, checkedAt: now.toISOString(), status: 'ok', reason: null, dividends: [], splits: [], ...changes })
const options = { range: 'all', now, calendar }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('NAV parser reads identity-checked JSON without executing source JavaScript; preserves Beijing dates and both NAV fields', () => {
  globalThis.navSourceExecuted = false
  const parsed = parseEtfNav(source() + '; globalThis.navSourceExecuted = true;', now)
  assert.equal(globalThis.navSourceExecuted, false)
  delete globalThis.navSourceExecuted
  assert.deepEqual(parsed.history.map(row => row.date), dates)
  assert.equal(parsed.history[0].nav, 1)
  assert.equal(parsed.history[0].accumulatedNav, 2)
  assert.equal(parsed.lastSuccessAt, now.toISOString())
  for (const invalid of [source().replace('512890', '510300'), source() + 'var fS_code = "512890";', source().replace('"y":1', '"y":0'), source().replace('"y":1', '"y":"1"'), source([1, 2, 3], [dates[0], dates[0], dates[2]]), source([1, 2, 3], [dates[0], dates[2], dates[1]]), source([1, 2], ['2026-09-30', '2026-10-01']), source().replace('"x":1790524800000', '"x":0'), source().replace('var Data_ACWorthTrend', 'var Missing')]) assert.throws(() => parseEtfNav(invalid, now))
  const bad = structuredClone(parsed); bad.history[0].date = '2026-02-30'; assert.throws(() => validateEtfNav(bad, { now }), /日期/)
  assert.throws(() => validateEtfNav({ ...parsed, date: dates[0] }, { now }), /最新日期/)
  assert.throws(() => validateEtfNav({ ...parsed, status: 'stale' }, { now }), /原因/)
  assert.throws(() => validateEtfNav({ ...parsed, lastAttemptAt: '2026-10-01T12:00:00.000Z' }, { now }), /尝试时间/)
})

test('collector atomically saves valid NAV, retains history and original success on failure, rejects history regression and corrupt local files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stock-nav-')), output = join(dir, 'nav.json')
  try {
    const success = await refreshEtfNav({ output, now, fetcher: async () => new Response(source()) })
    assert.equal(success.ok, true)
    const later = new Date('2026-10-01T12:00:00.000Z')
    const failed = await refreshEtfNav({ output, now: later, fetcher: async () => new Response('', { status: 503 }) })
    assert.equal(failed.ok, false); assert.equal(failed.data.status, 'stale')
    assert.deepEqual(failed.data.history, success.data.history)
    assert.equal(failed.data.lastSuccessAt, now.toISOString()); assert.equal(failed.data.lastAttemptAt, later.toISOString())
    assert.equal(JSON.parse(await readFile(output, 'utf8')).status, 'stale')
    const regression = await refreshEtfNav({ output, now: later, fetcher: async () => new Response(source([1, 1.1], dates.slice(0, 2))) })
    assert.match(regression.error, /倒退|消失/); assert.deepEqual(regression.data.history, success.data.history)
    const corrected = await refreshEtfNav({ output, now: later, fetcher: async () => new Response(source([1, 1.1, 1.22])) })
    assert.equal(corrected.ok, true); assert.equal(corrected.data.history.at(-1).nav, 1.22)
    const unavailable = await refreshEtfNav({ output: join(dir, 'missing.json'), now, fetcher: async () => { throw new Error('offline') } })
    assert.equal(unavailable.data.status, 'unavailable'); assert.equal(unavailable.data.lastSuccessAt, null); assert.deepEqual(unavailable.data.history, [])
    await writeFile(output, '{broken')
    await assert.rejects(refreshEtfNav({ output, now: later, fetcher: async () => new Response(source()) }))
    assert.equal(await readFile(output, 'utf8'), '{broken')
  } finally { await rm(output, { force: true }); await rm(join(dir, 'missing.json'), { force: true }); await rmdir(dir) }
})

test('browser API rejects bad HTTP and mismatched NAV identities', async () => {
  const data = nav()
  const result = await getEtfNav({ fetcher: async (url, init) => { assert.match(url, /nav-512890.json\?t=/); assert.equal(init.cache, 'no-store'); return Response.json(data) } })
  assert.deepEqual(result, data)
  await assert.rejects(getEtfNav({ fetcher: async () => new Response('', { status: 503 }) }), /读取失败/)
  await assert.rejects(getEtfNav({ fetcher: async () => Response.json({ ...data, code: '510300' }) }), /身份/)
})

test('premium uses same-day UNIT NAV only; never interpolates or uses yesterday NAV for delayed publication', () => {
  const m = market([1.01, 1.089, 1.21]), n = nav()
  const stats = calculateEtfPremium(m, n, options)
  near(stats.points[0].premium, .01); near(stats.points[1].premium, -.01); near(stats.current.premium, 0)
  near(stats.average, 0); assert.equal(stats.maximum.date, dates[0]); assert.equal(stats.minimum.date, dates[1])
  const lagged = nav([1, 1.1], dates.slice(0, 2))
  const partial = calculateEtfPremium(m, lagged, options)
  assert.equal(partial.count, 3); assert.equal(partial.missingCount, 1); assert.equal(partial.current.date, dates[1])
  assert.deepEqual(partial.points[2], { date: dates[2], close: 1.21, nav: null, premium: null })
  const priceLag = calculateEtfPremium(market([1, 1.1], dates.slice(0, 2)), n, options)
  assert.equal(priceLag.points[2].close, null); assert.equal(priceLag.points[2].premium, null)
  const gap = calculateEtfPremium(m, nav([1, 1.21], [dates[0], dates[2]]), options)
  assert.equal(gap.points[1].premium, null)
  const chart = etfNavOption(partial, 'premium')
  assert.equal(chart.series[0].data[2], null); assert.equal(chart.series[0].connectNulls, false)
  assert.match(chart.tooltip.formatter([{ dataIndex: 2 }]), /不跨日期/)
  near(etfNavOption(stats, 'price').series[1].data[0], 1)
})

test('tracking compares split-adjusted NAV and price index with independent cumulative and daily difference oracles', () => {
  const stats = calculateNavTracking(nav([2, 1.1, 1.21]), market(undefined, undefined, 'H30269'), events({ splits: [{ date: dates[1], ratio: 2 }] }), options)
  near(stats.current.navReturn, .21); near(stats.current.indexReturn, .1025); near(stats.current.deviation, .1075)
  near(stats.meanDailyDifference, .05); near(stats.annualizedDifferenceVolatility, 0)
  assert.equal(stats.splitCount, 1); assert.equal(stats.points[0].dailyDifference, null)
  const varied = calculateNavTracking(nav([1, 1.1, 1.32]), market([1, 1.05, 1.1025], dates, 'H30269'), events(), options)
  near(varied.meanDailyDifference, .1); near(varied.annualizedDifferenceVolatility, Math.sqrt(.005 * 252))
  const withDividend = calculateNavTracking(nav(), market(undefined, undefined, 'H30269'), events({ dividends: [{ recordDate: dates[0], exDate: dates[1], payDate: dates[2], cashPerShare: .1 }] }), options)
  near(withDividend.current.navReturn, .21)
  const two = calculateNavTracking(nav([1, 1.1], dates.slice(0, 2)), market([1, 1.05], dates.slice(0, 2), 'H30269'), events(), options)
  assert.equal(two.annualizedDifferenceVolatility, null)
  const chart = etfNavOption(stats, 'tracking'); near(chart.series[2].data.at(-1), 10.75)
  assert.match(chart.tooltip.formatter([{ dataIndex: 2 }]), /个百分点/)
})

test('tracking rejects missing sessions, unavailable or short split coverage, wrong identity and incomplete requested ranges', () => {
  const index = market(undefined, undefined, 'H30269')
  assert.throws(() => calculateNavTracking(nav([1, 1.21], [dates[0], dates[2]]), index, events(), options), /净值 缺少 1 个交易日/)
  assert.throws(() => calculateNavTracking(nav(), market([1, 1.1], dates.slice(0, 2), 'H30269'), events(), options), /指数 缺少 1 个交易日/)
  assert.throws(() => calculateNavTracking(nav(), index, events({ status: 'unavailable', reason: 'offline', coverage: null, checkedAt: null }), options), /拆分档案不可用/)
  assert.throws(() => calculateNavTracking(nav(), index, events({ coverage: { start: '2018-12-19', end: '2026-09-29' }, checkedAt: '2026-09-29T12:00:00.000Z' }), options), /核验范围/)
  assert.throws(() => calculateNavTracking(nav(), market(), events(), options), /格式异常/)
  for (const range of ['year', '30d', 'ytd']) assert.throws(() => calculateEtfPremium(market(), nav(), { ...options, range }), /共同可用历史|日历/)
  assert.throws(() => calculateEtfPremium(market(), nav(), { ...options, range: 'custom', start: dates[2], end: dates[0] }), /开始日期/)
  assert.throws(() => calculateEtfPremium(market(), nav(), { ...options, range: 'custom', start: dates[0], end: '2026-10-01' }), /截止日/)
  const early = new Date('2026-09-30T06:00:00.000Z')
  const beforeClose = calculateEtfPremium(market(), parseEtfNav(source(), early), { ...options, now: early })
  assert.equal(beforeClose.endDate, dates[1])
})

test('non-trading reporting NAVs stay archived but do not enter exchange-session comparisons; custom weekends adjust inward', () => {
  const days = ['2026-09-25', '2026-09-27', ...dates], values = [1, 999, 1.1, 1.21, 1.331]
  const n = nav(values, days), m = market([1, 1.1, 1.21, 1.331], [days[0], ...dates])
  const p = calculateEtfPremium(m, n, options)
  assert.equal(p.points.length, 4); assert.equal(p.missingCount, 0); near(p.average, 0)
  const t = calculateNavTracking(n, { ...m, code: 'H30269' }, events(), options)
  near(t.current.deviation, 0)
  const adjusted = calculateEtfPremium(m, n, { ...options, range: 'custom', start: '2026-09-26', end: dates[2] })
  assert.equal(adjusted.startDate, dates[0]); assert.equal(n.history.length, 5)
})

test('actual saved NAV and exchange snapshots support all ranges and strict common dates', async () => {
  const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
  const [m, n, i, e] = await Promise.all(['512890', 'nav-512890', 'h30269', 'distributions-512890'].map(read))
  const clock = new Date(Math.max(Date.parse(n.lastAttemptAt), Date.parse(e.checkedAt), Date.parse(`${m.latest.date}T12:00:00Z`), Date.parse(`${i.latest.date}T12:00:00Z`)))
  for (const range of ['all', 'year', '30d', 'ytd']) {
    const p = calculateEtfPremium(m, n, { range, now: clock }), t = calculateNavTracking(n, i, e, { range, now: clock })
    assert.ok(p.alignedCount > 10); assert.equal(p.missingCount, 0); assert.ok(t.count > 10)
    const rawNav = n.history.find(row => row.date === p.current.date).nav
    const close = m.history.find(row => row.date === p.current.date).close
    near(p.current.premium, close / rawNav - 1)
  }
})
