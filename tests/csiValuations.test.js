import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCsiHistory, validateCsiStatus, csiChartHistory, getCsiValuationHistory, getCsiValuationStatus, CSI_VALUATION_SOURCE } from '../src/api/csiValuations.js'
import { valuationStats } from '../src/utils/valuationStats.js'

const payload = JSON.parse(await readFile(new URL('../public/data/valuation-history-csi-h30269.json', import.meta.url), 'utf8'))

test('CSI history maps each basis separately and has no invented PB', () => {
  validateCsiHistory(payload)
  const total = csiChartHistory(payload)
  const calculation = csiChartHistory(payload, 'calculation')
  assert.equal(total.at(-1).pe, payload.history.at(-1).peTotal)
  assert.equal(calculation.at(-1).pe, payload.history.at(-1).peCalculation)
  assert.equal(total[0].pb, undefined)
  assert.equal(valuationStats(total, 'pe', 'all').count, payload.history.length)
  assert.throws(() => csiChartHistory(payload, 'ttm'))
})

test('CSI validates metadata, all four values, ordering and dates', () => {
  for (const change of [{ provider: 'Eastmoney' }, { basis: 'ttm' }, { source: 'other' }, { history: [] },
    { date: '2020-01-01' }, { history: [payload.history[0], payload.history[0]] },
    { history: [{ ...payload.history[0], date: '2026-02-30' }] },
    { history: [{ ...payload.history[0], peCalculation: '7.76' }] },
    { history: [{ ...payload.history[0], dividendCalculation: -1 }] }]) {
    assert.throws(() => validateCsiHistory({ ...payload, ...change }))
  }
})

test('history and status load independently, invalid or unavailable data rejects', async () => {
  const status = { code: 'H30269', provider: 'CSI', source: CSI_VALUATION_SOURCE, status: 'error', lastAttemptAt: '2026-09-27T01:00:00Z', lastSuccessAt: null }
  assert.deepEqual(await getCsiValuationStatus({ fetcher: async () => Response.json(status) }), status)
  assert.deepEqual(await getCsiValuationHistory({ fetcher: async () => Response.json(payload) }), payload)
  assert.throws(() => validateCsiStatus({ ...status, status: 'ok' }))
  assert.throws(() => validateCsiStatus({ ...status, lastSuccessAt: 'bad' }))
  await assert.rejects(getCsiValuationHistory({ fetcher: async () => new Response('', { status: 404 }) }))
  await assert.rejects(getCsiValuationStatus({ fetcher: async () => new Response('', { status: 503 }) }))
})
