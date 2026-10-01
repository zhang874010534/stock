import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeYieldSpread, emptyYieldHistory, formatSpread, mergeYieldHistory, validateYieldHistory, YIELD_SERIES } from '../src/utils/yieldSpread.js'
import { generateYieldHistory } from '../scripts/build-yield-history.mjs'
import { getYieldHistory } from '../src/api/yieldHistory.js'
import { yieldSpreadOption } from '../src/charts/yieldSpread.js'
import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, TitleComponent, LegendComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

const now = new Date('2026-10-01T08:00:00Z')
const snapshot = (kind, date, value) => ({ ...YIELD_SERIES[kind], date, value, unit: 'percent' })
function sample() {
  let data = emptyYieldHistory()
  for (const [date, dividend, treasury] of [['2026-09-08', 4.27, 1.6815], ['2026-09-09', 0, 1], ['2026-09-10', 2, 2], ['2026-09-14', 5, 1]]) {
    data = mergeYieldHistory(data, { dividend: snapshot('dividend', date, dividend), treasury: snapshot('treasury', date, treasury) }, { now })
  }
  return mergeYieldHistory(data, { dividend: snapshot('dividend', '2026-09-11', 4) }, { now })
}
test('same-date differences use percentage points, preserve zero and negatives, and compare previous saved pair', () => {
  const a = analyzeYieldSpread(sample(), { now })
  assert.equal(a.count, 4); assert.equal(a.unpairedCount, 1)
  assert.equal(a.points[3].spread, null); assert.equal(a.points[1].spread, -1); assert.equal(a.points[2].spread, 0)
  assert.equal(a.latest.date, '2026-09-14'); assert.equal(a.previous.date, '2026-09-10'); assert.equal(a.change, 4)
  assert.equal(a.min.date, '2026-09-09'); assert.equal(a.max.date, '2026-09-14')
  assert.ok(Math.abs(a.mean - (2.5885 - 1 + 0 + 4) / 4) < 1e-12)
  assert.equal(formatSpread(4.39 - 1.6822, { signed: true }), '+2.7078 个百分点')
  assert.equal(formatSpread(-0.000001), '0.0000 个百分点'); assert.equal(formatSpread(null), '—')
})
test('date mismatch, empty and single pair never fabricate spread or change; ranges filter observations', () => {
  const data = mergeYieldHistory(emptyYieldHistory(), { dividend: snapshot('dividend', '2026-09-10', 4), treasury: snapshot('treasury', '2026-09-09', 2) }, { now })
  const a = analyzeYieldSpread(data, { now }); assert.equal(a.count, 0); assert.equal(a.latest, null); assert.equal(a.mean, null); assert.equal(a.change, null)
  assert.equal(a.latestDividend.date, '2026-09-10'); assert.equal(a.latestTreasury.date, '2026-09-09')
  const b = analyzeYieldSpread(sample(), { start: '2026-09-11', end: '2026-09-14', now })
  assert.equal(b.count, 1); assert.equal(b.change, null); assert.equal(b.unpairedCount, 1)
  assert.equal(analyzeYieldSpread(emptyYieldHistory(), { now }).points.length, 0)
})
test('history validation rejects wrong identity, sources, units, dates, duplicate and invalid numbers; corrections replace', () => {
  const data = sample()
  for (const modify of [d => { d.unit = 'ratio' }, d => { d.series.dividend.code = '512890' }, d => { d.series.treasury.source = 'other' }, d => { d.series.dividend.basis = 'calculation' }, d => { d.series.dividend.history[0].date = '2026-02-30' }, d => { d.series.dividend.history[0].date = '2999-01-01' }, d => { d.series.dividend.history[0].value = null }, d => { d.series.dividend.history[0].value = true }, d => { d.series.dividend.history[0].value = Infinity }, d => { d.series.dividend.history[0].value = -1 }, d => { d.series.dividend.history.push(d.series.dividend.history[0]) }]) {
    const bad = structuredClone(data); modify(bad); assert.throws(() => validateYieldHistory(bad, { now }))
  }
  const corrected = mergeYieldHistory(data, { dividend: snapshot('dividend', '2026-09-08', 4.3) }, { now })
  assert.equal(corrected.series.dividend.history.length, 5); assert.equal(corrected.series.dividend.history[0].value, 4.3)
  assert.equal(data.series.dividend.history[0].value, 4.27)
})
test('history generator accumulates independent successful inputs, preserves rejected dates and refuses corrupt output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stock-yield-test-'))
  const target = join(directory, 'yield-history-h30269-cn10y.json')
  try {
    const save = (kind, date, value) => writeFile(join(directory, YIELD_SERIES[kind].filename), JSON.stringify(snapshot(kind, date, value)))
    await save('dividend', '2026-09-08', 4.27); await save('treasury', '2026-09-08', 1.68)
    const first = await generateYieldHistory({ directory, now }); assert.equal(first.failed, false)
    const raw = await readFile(target, 'utf8'); assert.equal((await generateYieldHistory({ directory, now })).changed, false)
    assert.equal(await readFile(target, 'utf8'), raw)
    await save('dividend', '2026-09-09', 4.3); await save('treasury', '2026-09-07', 1.7)
    const partial = await generateYieldHistory({ directory, now }); assert.equal(partial.failed, true)
    assert.equal(partial.data.series.dividend.history.at(-1).date, '2026-09-09'); assert.equal(partial.data.series.treasury.history.at(-1).date, '2026-09-08')
    await save('treasury', '2026-09-09', 1.7)
    const skipped = await generateYieldHistory({ directory, now, inputErrors: { treasury: 'offline' } }); assert.equal(skipped.failed, true)
    assert.equal(skipped.data.series.treasury.history.length, 1)
    const recovery = await generateYieldHistory({ directory, now }); assert.equal(recovery.failed, false); assert.equal(recovery.data.series.treasury.history.length, 2)
    await save('dividend', '2026-09-09', 4.4)
    const revision = await generateYieldHistory({ directory, now }); assert.equal(revision.data.series.dividend.history.length, 2); assert.equal(revision.data.series.dividend.history.at(-1).value, 4.4)
    await writeFile(target, '{broken'); await assert.rejects(generateYieldHistory({ directory, now }), /停止覆盖/); assert.equal(await readFile(target, 'utf8'), '{broken')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('API rejects unavailable or malformed files and chart preserves missing observations as gaps on shared axes', async () => {
  assert.deepEqual(await getYieldHistory({ now, fetcher: async () => Response.json(sample()) }), sample())
  await assert.rejects(getYieldHistory({ now, fetcher: async () => new Response('', { status: 404 }) }))
  await assert.rejects(getYieldHistory({ now, fetcher: async () => Response.json({}) }))
  const a = analyzeYieldSpread(sample(), { now }), option = yieldSpreadOption(a)
  assert.equal(option.series[2].data[3], null); assert.equal(option.series[2].connectNulls, false)
  assert.deepEqual(option.dataZoom[0].xAxisIndex, [0, 1]); assert.equal(option.series[2].yAxisIndex, 1)
  assert.match(option.tooltip.formatter([{ dataIndex: 3 }]), /缺少同日数据/)
  use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, TitleComponent, LegendComponent, SVGRenderer])
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 490 })
  try { chart.setOption(option); assert.match(chart.renderToSVGString(), /<svg/) } finally { chart.dispose() }
})
test('saved real snapshots give exactly the latest spread and previous observation change', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/yield-history-h30269-cn10y.json', import.meta.url), 'utf8'))
  const a = analyzeYieldSpread(data, { now: new Date('2100-01-01T00:00:00Z') })
  const d = data.series.dividend.history.find(point => point.date === a.latest.date)
  const t = data.series.treasury.history.find(point => point.date === a.latest.date)
  assert.equal(a.latest.spread, d.value - t.value)
  assert.equal(a.change, a.latest.spread - a.previous.spread)
})
