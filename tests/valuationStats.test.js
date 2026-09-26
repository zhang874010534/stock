import test from 'node:test'
import assert from 'node:assert/strict'
import { quantile, valuationStats } from '../src/utils/valuationStats.js'
import { validateValuationHistory, getValuationHistory, VALUATION_SOURCE } from '../src/api/valuations.js'
import { valuationTrendOption } from '../src/charts/valuationTrend.js'

const history = Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, pe: i + 1, pb: 1 }))
const payload = { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: '2026-08-30', history }

test('quantiles interpolate and rank handles ties, without rounding inputs', () => {
  assert.equal(quantile([1, 2, 3, 4], .3), 1.9)
  const stats = valuationStats(history)
  assert.equal(stats.low, 9.7)
  assert.equal(stats.rank, 29.5 / 30 * 100)
  assert.equal(valuationStats(history, 'pb').rank, 50)
  assert.equal(valuationStats(history.slice(0, 19)).rank, null)
  assert.equal(valuationStats([]).count, 0)
})

test('range anchored to latest observation, with leap-year and actual coverage handling', () => {
  const rows = [{ date: '2023-02-27', pe: 3 }, { date: '2023-02-28', pe: 4 }, { date: '2024-02-29', pe: 5 }]
  assert.equal(valuationStats(rows).count, 2)
  assert.equal(valuationStats(rows).partial, false)
  assert.equal(valuationStats(rows, 'pe', 'all').count, 3)
  assert.equal(valuationStats(history).partial, true)
})

test('history reader rejects invalid points, duplicate dates, mixed sources and mismatched latest date', async () => {
  assert.deepEqual(await getValuationHistory({ fetcher: async () => Response.json(payload) }), payload)
  for (const patch of [{ source: 'other' }, { basis: 'ttm' }, { history: [] }, { date: '2026-08-29' },
    { history: [history[0], history[0]] }, { history: [{ ...history[0], pe: '8' }] },
    { history: [{ ...history[0], date: '2026-02-30' }] }, { history: [{ ...history[0], pb: -1 }] }]) {
    assert.throws(() => validateValuationHistory({ ...payload, ...patch }))
  }
  await assert.rejects(getValuationHistory({ fetcher: async () => new Response('', { status: 404 }) }))
})

test('small chart has no zoom, large chart has zoom and identical fixed quantile lines', () => {
  const stats = valuationStats(history)
  const small = valuationTrendOption(stats, 'pe')
  const large = valuationTrendOption(stats, 'pe', true)
  assert.equal(small.dataZoom.length, 0)
  assert.equal(large.dataZoom.length, 2)
  assert.deepEqual(small.series[0].markLine, large.series[0].markLine)
  assert.equal(valuationTrendOption(valuationStats(history.slice(0, 2)), 'pe').series[0].markLine, undefined)
})
