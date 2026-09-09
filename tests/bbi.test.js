import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBBI } from '../src/utils/indicators.js'
import { buildMainIndicator } from '../src/charts/kline/mainIndicators.js'
import { buildSubIndicator } from '../src/charts/kline/subIndicators.js'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'
import { createKlineSeries } from '../src/charts/kline/series.js'

const bars = Array.from({ length: 30 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, open: i + 1, close: i + 1, high: i + 2, low: i + .5, volume: 100 }))
test('BBI默认四周期等权平均，完整24根后才出值；支持自定义周期', () => {
  const result = calculateBBI(bars).BBI
  assert.deepEqual(result.slice(0, 23), Array(23).fill(null))
  assert.equal(result[23], 18.875)
  assert.equal(calculateBBI(bars, { period1: 1, period2: 2, period3: 3, period4: 4 }).BBI[3], 3.25)
  assert.deepEqual(calculateBBI([]), { BBI: [] })
  assert.throws(() => calculateBBI(bars, { period1: 0 }), RangeError)
  assert.throws(() => calculateBBI(bars, { period4: 2.5 }), RangeError)
})
test('BBI可叠加BOLL并兼容K线/折线，关闭后移除且保留缩放', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 1000, height: 600 })
  const main = ['boll', 'bbi'].map(key => buildMainIndicator(bars, key))
  const sub = buildSubIndicator(bars)
  try {
    chart.setOption(createIndexTrendOption(bars, { startIndex: 15, endIndex: 29 }, { height: 600, movingAverages: [], mainIndicators: main, subIndicator: sub }))
    assert.equal(chart.getOption().series.find(s => s.id === 'bbi-BBI').xAxisIndex, 0)
    assert.match(chart.renderToSVGString(), /<svg/)
    for (const type of ['line', 'candlestick']) {
      chart.setOption({ series: createKlineSeries(bars, [], main, sub, type) }, { replaceMerge: ['series'] })
      assert.ok(chart.getOption().series.some(s => s.id === 'bbi-BBI'))
      assert.ok(chart.getOption().series.some(s => s.id === 'boll-BOLL'))
    }
    chart.setOption({ series: createKlineSeries(bars, [], [], sub) }, { replaceMerge: ['series'] })
    assert.ok(!chart.getOption().series.some(s => s?.id === 'bbi-BBI'))
    assert.equal(chart.getOption().dataZoom[0].startValue, 15)
  } finally { chart.dispose() }
})
