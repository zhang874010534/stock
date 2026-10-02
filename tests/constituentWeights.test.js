import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateConstituentWeights, validateEtfHoldings, weightSummary, weightedIndustries, compareWeights } from '../src/utils/constituentWeights.js'
import { getConstituentWeights, getEtfHoldings } from '../src/api/constituentWeights.js'
import { createDashboardData } from '../src/composables/useDashboardData.js'

const index = JSON.parse(await readFile(new URL('../public/data/weights-h30269.json', import.meta.url), 'utf8'))
const etf = JSON.parse(await readFile(new URL('../public/data/holdings-512890.json', import.meta.url), 'utf8'))
const history = JSON.parse(await readFile(new URL('../public/data/constituents-history-h30269.json', import.meta.url), 'utf8'))
test('official full snapshots reconcile; exact ETF values preserve small active holdings', () => {
  validateConstituentWeights(index); validateEtfHoldings(etf)
  assert.equal(index.members.length, 50); assert.equal(etf.members.length, 74)
  assert.ok(Math.abs(weightSummary(index).topTen - .25436) < 1e-12)
  assert.ok(Math.abs(weightSummary(etf).topTen - .25015343791539096) < 1e-12)
  const small = weightSummary(etf).rows.find(row => row.code === '001220')
  assert.equal(small.reportedWeight, 0); assert.ok(small.weight > 0)
  assert.ok(Math.abs(weightSummary(etf).total - etf.equityValue / etf.netAssets) < 1e-12)
})
test('weights must be a complete set; reject duplicate, unit, source, future date and totals', () => {
  for (const mutate of [data => data.members.pop(), data => data.members[1].code = data.members[0].code, data => data.members[0].weight = 50, data => data.unit = 'percent', data => data.source = 'https://example.com/', data => data.date = '2099-01-01', data => data.members[0].exchange = 'SSE']) {
    const data = structuredClone(index); mutate(data); assert.throws(() => validateConstituentWeights(data))
  }
})
test('ETF full scope and market value sum are required before treating absent rows as zero', () => {
  for (const mutate of [data => data.members.pop(), data => data.scope = 'top_ten', data => data.members[0].reportedWeight = 0, data => data.netAssets = 0, data => data.source = data.source.replace('512890', '159547'), data => data.publishedDate = '2026-01-01', data => data.members[0].shares = 1.5, data => data.members[0].marketValue = NaN]) {
    const data = structuredClone(etf); mutate(data); assert.throws(() => validateEtfHoldings(data))
  }
})
test('industry distribution sums true weights, preserves unknown mass and stale classifications', () => {
  const data = { ...index, members: [{ code: '000001', exchange: 'SZSE', weight: .8 }, { code: '000002', exchange: 'SZSE', weight: .1 }, { code: '600001', exchange: 'SSE', weight: .1 }] }
  const classification = { members: [{ code: '000001', exchange: 'SZSE', industry: '金融', industryStatus: 'stale' }, { code: '000002', exchange: 'SZSE', industry: '工业' }] }
  const distribution = weightedIndustries(data, classification)
  assert.equal(distribution.groups[0].weight, .8); assert.equal(distribution.groups[0].count, 1)
  assert.equal(distribution.unknownWeight, .1); assert.equal(distribution.classifiedWeight, .9); assert.equal(distribution.staleWeight, .8)
  const real = weightedIndustries(index, history.snapshots.at(-1))
  assert.ok(real.unknownWeight > 0); assert.ok(Math.abs(real.groups.reduce((total, row) => total + row.weight, 0) - weightSummary(index).total) < 1e-12)
})
test('comparison preserves disclosure dates, active-only rows and missing input semantics', () => {
  const comparison = compareWeights(index, etf)
  assert.equal(comparison.sameDate, false); assert.equal(comparison.matched, 50); assert.equal(comparison.etfOnly, 24)
  const active = comparison.rows.find(row => row.code === '001248')
  assert.equal(active.indexWeight, 0); assert.ok(active.etfWeight > 0); assert.equal(active.presence, 'etf')
  assert.equal(compareWeights(index, null), null)
  assert.equal(compareWeights({ ...index, status: 'unavailable', members: [] }, etf), null)
})
test('API validates downloaded data; refresh groups keep comparison and industry reference together', async () => {
  assert.equal((await getConstituentWeights({ fetcher: async () => Response.json(index) })).date, index.date)
  await assert.rejects(getEtfHoldings({ fetcher: async () => Response.json({ ...etf, scope: 'top_ten' }) }))
  await assert.rejects(getEtfHoldings({ fetcher: async () => new Response('', { status: 503 }) }))
  const calls = [], keys = ['constituentWeights', 'etfHoldings', 'constituents', 'constituentHistory']
  const dashboard = createDashboardData(Object.fromEntries(keys.map(key => [key, () => { calls.push(key); return {} }])))
  await Promise.all(keys.map(key => dashboard.ensure(key))); calls.length = 0
  await dashboard.refresh(['constituents']); assert.deepEqual(calls.sort(), keys.sort())
})
