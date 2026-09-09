import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'
import { createKlineSeries } from '../src/charts/kline/series.js'
import { buildSubIndicator } from '../src/charts/kline/subIndicators.js'
import { aggregateKlines } from '../src/utils/kline.js'

test('K线与收盘折线互切清除旧主图，保留区间和副图；支持聚合周期', async () => {
  const { history } = JSON.parse(await readFile(new URL('../public/data/512890.json', import.meta.url), 'utf8'))
  for (const period of ['day', 'week', 'month', 'quarter']) {
    const bars = aggregateKlines(history, period)
    const indicator = buildSubIndicator(bars)
    const chart = initIndexTrend(null, { ssr: true, width: 1000, height: 600 })
    try {
      chart.setOption(createIndexTrendOption(bars, { startIndex: 1, endIndex: bars.length - 1 }, { height: 600, movingAverages: [], subIndicator: indicator }))
      const zoom = chart.getOption().dataZoom[0]
      chart.setOption({ series: createKlineSeries(bars, [], [], indicator, 'line') }, { replaceMerge: ['series'] })
      const series = chart.getOption().series
      assert.deepEqual(series.find(s => s.id === 'index-close').data, bars.map(p => p.close))
      assert.ok(!series.some(s => s.id === 'index-kline'))
      assert.ok(series.some(s => s.id === 'index-volume'))
      assert.equal(chart.getOption().dataZoom[0].startValue, zoom.startValue)
      assert.match(chart.renderToSVGString(), /<svg/)
      chart.setOption({ series: createKlineSeries(bars, [], [], indicator) }, { replaceMerge: ['series'] })
      assert.ok(!chart.getOption().series.some(s => s.id === 'index-close'))
      assert.equal(chart.getOption().series.find(s => s.id === 'index-kline').type, 'candlestick')
    } finally { chart.dispose() }
  }
})
