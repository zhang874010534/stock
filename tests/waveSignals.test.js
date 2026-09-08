import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateWaveSignals, zigzag, crossValues, smooth, filterSignals } from '../src/utils/waveSignals.js'
import { ETF512890, parseEastmoneyKline } from '../scripts/lib/market-data.mjs'
import { updateH30269 } from '../scripts/fetch-h30269.mjs'
import { getMarketData } from '../src/api/h30269.js'
import { aggregateKlines } from '../src/utils/kline.js'
import { buildSubIndicator } from '../src/charts/kline/subIndicators.js'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'
import { createKlineSeries } from '../src/charts/kline/series.js'

test('公式原语：小数周期SMA、上穿、FILTER跳过随后10根', () => {
  const values = smooth([0, 41, 0], 4.1)
  assert.equal(values[1], 10)
  assert.ok(Math.abs(values[2] - 10 * 3.1 / 4.1) < 1e-12)
  assert.deepEqual(crossValues([null, 1, 2, 2, 3], [1, 1, 1, 2, 2]), [false, false, true, false, true])
  assert.deepEqual(filterSignals(Array(13).fill(true), 10).flatMap((x, i) => x ? [i] : []), [0, 11])
})

test('ZIG按百分比确认极值并线性插值，追加数据会重绘历史', () => {
  const result = zigzag([100, 110, 120, 115, 100, 110, 120], 10)
  assert.deepEqual(result.values, [100, 110, 120, 110, 100, 110, 120])
  assert.ok(result.troughs.includes(4))
  const before = zigzag([100, 108, 105], 10).values
  const after = zigzag([100, 108, 105, 120], 10).values
  assert.notDeepEqual(before, after.slice(0, 3))
  assert.deepEqual(zigzag([], 10), { values: [], troughs: [] })
})

test('512890更新使用独立文件和相同30天刷新、90天回补规则，保留换手率', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'etf-data-'))
  const filePath = join(directory, '512890.json')
  const requests = []
  const point = '2026-09-07,1.206,1.195,1.209,1.190,6293117,753142642,1.59,-0.91,-0.011,2.40'
  assert.equal(parseEastmoneyKline(point).turnover, 2.4)
  assert.equal(parseEastmoneyKline(point.replace('2.40', '-')).turnover, undefined)
  try {
    const result = await updateH30269({ instrument: ETF512890, filePath, now: new Date('2026-09-07T08:30:00Z'), requestDelayMs: 0,
      logger: { log() {}, warn() {} }, fetcher: async url => {
        requests.push(new URL(url))
        return Response.json({ rc: 0, data: { code: '512890', market: 1, klines: requests.length === 1 ? [point] : [] } })
      } })
    assert.equal(result.errors.length, 0)
    assert.equal(requests[0].searchParams.get('secid'), '1.512890')
    assert.equal(requests[0].searchParams.get('beg'), '20260809')
    assert.equal(requests[0].searchParams.get('end'), '20260907')
    assert.equal(requests[1].searchParams.get('beg'), '20260609')
    assert.equal(requests[1].searchParams.get('end'), '20260906')
    const stored = JSON.parse(await readFile(filePath, 'utf8'))
    assert.equal(stored.code, '512890')
    assert.equal(stored.latest.turnover, 2.4)
    let requestedUrl
    await getMarketData('512890', { cacheKey: 1, fetcher: async url => { requestedUrl = url; return Response.json(stored) } })
    assert.equal(requestedUrl, '/data/512890.json?t=1')
    await assert.rejects(getMarketData('H30269', { fetcher: async () => Response.json(stored) }), /格式异常/)
  } finally {
    // Only delete the directory directly returned by mkdtemp under the OS temp root.
    assert.ok(directory.startsWith(join(tmpdir(), 'etf-data-')))
    await rm(directory, { recursive: true, force: true })
  }
})

test('真实ETF历史在各周期可计算，缺换手率不伪造短买点，平价输入无NaN', async () => {
  const { history } = JSON.parse(await readFile(new URL('../public/data/512890.json', import.meta.url), 'utf8'))
  for (const period of ['day', 'week', 'month', 'quarter']) {
    const bars = aggregateKlines(history, period)
    const values = calculateWaveSignals(bars)
    assert.equal(values.events.length, bars.length)
    assert.ok(values.saturation.every(x => x === null || (Number.isFinite(x) && x >= 0 && x <= 100)))
    assert.ok(values.events.flat().every(x => Number.isFinite(x.price)))
  }
  const noTurnover = history.map(({ turnover, ...p }) => p)
  const missing = calculateWaveSignals(noTurnover)
  assert.equal(missing.missingTurnover, true)
  assert.ok(missing.events.flat().every(x => x.name !== '短买点'))
  const flat = calculateWaveSignals(Array.from({ length: 160 }, () => ({ open: 1, high: 1, low: 1, close: 1, volume: 0, amount: 0 })))
  assert.equal(flat.events.flat().length, 0)
  assert.ok(flat.buy.every(x => x === 1))
  assert.equal(calculateWaveSignals([]).events.length, 0)
})

test('波段副图可实际渲染，切回KDJ清除自定义标记并保留缩放', async () => {
  const { history } = JSON.parse(await readFile(new URL('../public/data/512890.json', import.meta.url), 'utf8'))
  const chart = initIndexTrend(null, { ssr: true, width: 1200, height: 650 })
  try {
    const wave = buildSubIndicator(history, 'wave')
    chart.setOption(createIndexTrendOption(history, { startIndex: 100, endIndex: history.length - 1 }, { height: 650, subIndicator: wave }))
    assert.match(chart.renderToSVGString(), /<svg/)
    assert.ok(chart.getOption().series.some(s => s.id === 'wave-signals'))
    const zoom = chart.getOption().dataZoom[0]
    chart.setOption({ series: createKlineSeries(history, [], [], buildSubIndicator(history)) }, { replaceMerge: ['series'] })
    assert.ok(chart.getOption().series.every(s => !s.id.startsWith('wave-')))
    assert.equal(chart.getOption().dataZoom[0].startValue, zoom.startValue)
  } finally { chart.dispose() }
})
