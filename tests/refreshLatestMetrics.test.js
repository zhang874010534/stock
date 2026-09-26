import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { refreshLatestMetrics } from '../scripts/update-latest-metrics.mjs'
import { generateLatestMetrics } from '../scripts/build-latest-metrics.mjs'
import { DIVIDEND_SOURCE } from '../src/utils/latestMetrics.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'

const now = new Date('2026-09-26T08:00:00Z')
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'stock-refresh-test-'))
  const history = [{ date: '2026-09-21', close: 100 }, { date: '2026-09-22', close: 110 }, { date: '2026-09-23', close: 105 }]
  const market = { code: 'H30269', source: 'eastmoney', interval: '1d', history, latest: history.at(-1) }
  try {
    for (const [name, data] of Object.entries({
      h30269: market,
      'valuation-h30269': { code: 'H30269', source: VALUATION_SOURCE, provider: 'Eastmoney', basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-18', pe: 8, pb: 0.8 },
      'dividend-h30269': { code: 'H30269', source: DIVIDEND_SOURCE, basis: 'total_share_capital', unit: 'percent', date: '2026-09-18', value: 4.3 },
    })) await writeFile(join(directory, `${name}.json`), JSON.stringify(data))
    const initial = await generateLatestMetrics({ directory, now })
    await run({ directory, initial, market, refresh: options => refreshLatestMetrics({ directory, now, ...options }) })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('source failure survives unrelated schedule and manual generation; only recovery clears it', async () => fixture(async ({ refresh, directory, initial }) => {
  const failed = await refresh({ mode: 'indicators', indicatorUpdater: async () => ({ failed: true, sources: { valuation: null, dividend: '股息率更新失败', bond: null } }) })
  assert.equal(failed.failed, true)
  assert.equal(failed.data.metrics.dividendYield.status, 'stale')
  assert.equal(failed.data.metrics.dividendYield.value, initial.data.metrics.dividendYield.value)
  assert.equal(failed.data.metrics.dividendYield.asOf, '2026-09-18')
  assert.equal(failed.data.metrics.pe.status, 'ok')
  const market = await refresh({ mode: 'market', marketUpdater: async () => ({ failed: false, sources: { H30269: null } }) })
  assert.equal(market.failed, true)
  assert.equal(market.changed, false)
  const manual = await generateLatestMetrics({ directory, now })
  assert.equal(manual.data.metrics.dividendYield.status, 'stale')
  const recovered = await refresh({ mode: 'indicators', indicatorUpdater: async () => ({ failed: false, sources: { valuation: null, dividend: null, bond: null } }) })
  assert.equal(recovered.failed, false)
  assert.equal(recovered.data.metrics.dividendYield.status, 'ok')
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'latest-metrics-source-status.json'), 'utf8')).errors, {})
}))

test('market failure retains original group even when disk data changed; ETF failure is independent', async () => fixture(async ({ refresh, directory, market, initial }) => {
  market.history.push({ date: '2026-09-24', close: 120 }); market.latest = market.history.at(-1)
  await writeFile(join(directory, 'h30269.json'), JSON.stringify(market))
  const failed = await refresh({ mode: 'market', marketUpdater: async () => ({ failed: true, sources: { H30269: '行情失败', '512890': null } }) })
  assert.deepEqual(failed.data.calculation, initial.data.calculation)
  assert.equal(failed.data.metrics.annualReturn.status, 'stale')
  const other = await refresh({ mode: 'indicators', indicatorUpdater: async () => ({ failed: false, sources: { valuation: null, dividend: null } }) })
  assert.equal(other.data.metrics.sharpe.status, 'stale')
  const recovered = await refresh({ mode: 'market', marketUpdater: async () => ({ failed: true, sources: { H30269: null, '512890': 'ETF failure' } }) })
  assert.equal(recovered.failed, true)
  assert.equal(recovered.data.metrics.annualReturn.status, 'ok')
  assert.equal(recovered.data.calculation.windowEnd, '2026-09-24')
}))

test('missing collector report fails closed, bond-only failure does not mark six metrics stale', async () => fixture(async ({ refresh }) => {
  const missing = await refresh({ mode: 'indicators', indicatorUpdater: async () => { throw new Error('python unavailable') } })
  assert.equal(missing.data.metrics.pe.status, 'stale')
  assert.equal(missing.data.metrics.dividendYield.status, 'stale')
  const bondOnly = await refresh({ mode: 'indicators', indicatorUpdater: async () => ({ failed: true, sources: { valuation: null, dividend: null, bond: '国债失败' } }) })
  assert.equal(bondOnly.failed, true)
  assert.ok(Object.values(bondOnly.data.metrics).every(item => item.status === 'ok'))
}))
