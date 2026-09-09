import test from 'node:test'
import assert from 'node:assert/strict'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'

const history = [
  { date: '2026-09-01', open: 7, close: 9, high: 15, low: 1, volume: 100 },
  { date: '2026-09-02', open: 6, close: 7, high: 8, low: 5, volume: 100 },
  { date: '2026-09-03', open: 6, close: 5, high: 7, low: 4, volume: 100 },
]

test('极值标记随可见区间缩放更新，预览/完整视图均支持ETF精度', () => {
  for (const compact of [true, false]) {
    const chart = initIndexTrend(null, { ssr: true, width: 800, height: 600 })
    try {
      chart.setOption(createIndexTrendOption(history, { startIndex: 0, endIndex: 2 }, { compact, pricePrecision: 3, movingAverages: [] }))
      let svg = chart.renderToSVGString()
      assert.ok(svg.includes('← 15.000'))
      assert.ok(svg.includes('← 1.000'))
      chart.dispatchAction({ type: 'dataZoom', startValue: 1, endValue: 2 })
      svg = chart.renderToSVGString()
      assert.ok(svg.includes('← 8.000'))
      assert.ok(svg.includes('← 4.000'))
      assert.ok(!svg.includes('← 15.000'))
      assert.ok(!svg.includes('← 1.000'))
    } finally { chart.dispose() }
  }
})

test('折线标记收盘价极值，单根K线标记最高和最低价', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 800, height: 600 })
  try {
    chart.setOption(createIndexTrendOption(history, { startIndex: 0, endIndex: 2 }, { chartType: 'line', movingAverages: [] }))
    let svg = chart.renderToSVGString()
    assert.ok(svg.includes('← 9.00'))
    assert.ok(svg.includes('← 5.00'))
    chart.setOption(createIndexTrendOption(history.slice(0, 1), { startIndex: 0, endIndex: 0 }, { movingAverages: [] }), { notMerge: true })
    svg = chart.renderToSVGString()
    assert.ok(svg.includes('← 15.00'))
    assert.ok(svg.includes('← 1.00'))
  } finally { chart.dispose() }
})

test('极值箭头左端精确锚定影线端点，缩放和尺寸变化不产生文字居中偏移', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 800, height: 600 })
  try {
    for (const compact of [true, false]) {
      chart.setOption(createIndexTrendOption(history, { startIndex: 0, endIndex: 2 }, { compact, movingAverages: [] }), { notMerge: true })
      for (const start of [0, 1]) {
        chart.dispatchAction({ type: 'dataZoom', startValue: start, endValue: 2 })
        chart.resize({ width: start ? 1100 : 800, height: 600 })
        const svg = chart.renderToSVGString()
        for (const [index, price] of start ? [[1, 8], [2, 4]] : [[0, 15], [0, 1]]) {
          const label = [...svg.matchAll(/<text\b([^>]*)>← ([^<]+)<\/text>/g)].find(match => match[2] === price.toFixed(2))
          assert.ok(label)
          assert.match(label[1], /text-anchor="start"/)
          assert.match(label[1], /dominant-baseline="central"/)
          const position = label[1].match(/transform="translate\(([-\d.]+) ([-\d.]+)\)"/)
          const expected = chart.convertToPixel({ seriesIndex: 0 }, [index, price])
          assert.ok(Math.abs(Number(position[1]) - expected[0]) < .01)
          assert.ok(Math.abs(Number(position[2]) - expected[1]) < .01)
        }
      }
    }
  } finally { chart.dispose() }
})
