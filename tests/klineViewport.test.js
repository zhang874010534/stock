import test from 'node:test'
import assert from 'node:assert/strict'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'
import { clampKlineViewport, getKlineTimelineLength } from '../src/utils/klineViewport.js'

test('可以平移到行情末尾之外，最新K线居中，副图同步且不生成未来行情', () => {
  const history = Array.from({ length: 100 }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`, open: 10, close: 11, high: 12, low: 9, volume: 100 }))
  for (const compact of [true, false]) {
    const chart = initIndexTrend(null, { ssr: true, width: 1000, height: 600 })
    try {
      const option = createIndexTrendOption(history, { startIndex: 50, endIndex: 99 }, { compact })
      chart.setOption(option)
      const before = chart.convertToPixel({ xAxisIndex: 0 }, 99)
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, startValue: 75, endValue: 124 })
      const after = chart.getOption()
      assert.equal(after.dataZoom[0].endValue, 124)
      assert.equal(after.dataZoom[1].endValue, 124)
      const x = chart.convertToPixel({ xAxisIndex: 0 }, 99)
      assert.ok(x < before - 300)
      assert.ok(Math.abs(x - (62 + (1000 - 62 - 48) / 2)) < 20)
      for (let axis = 0; axis < after.xAxis.length; axis++) {
        assert.equal(chart.convertToPixel({ xAxisIndex: axis }, 99), x)
      }
      assert.equal(after.series[0].data.length, 100)
      assert.equal(option.xAxis[0].axisLabel.formatter('empty:100'), '')
      assert.equal(option.xAxis[0].axisPointer.label.formatter({ value: 'empty:100' }), '')
      assert.doesNotMatch(chart.renderToSVGString(), /empty:|NaN/)
      chart.setOption(createIndexTrendOption(history, { startIndex: 75, endIndex: 124 }, { compact }), { notMerge: true })
      assert.equal(chart.getOption().dataZoom[0].endValue, 124)
      chart.dispatchAction({ type: 'dataZoom', startValue: 50, endValue: 99 })
      assert.equal(chart.getOption().dataZoom[0].endValue, 99)
    } finally { chart.dispose() }
  }
})

test('越界拖动保留至少一根真实K线和窗口跨度', () => {
  assert.equal(getKlineTimelineLength(0), 0)
  assert.deepEqual(clampKlineViewport(100, { startIndex: 120, endIndex: 169 }), { startIndex: 99, endIndex: 148 })
  assert.deepEqual(clampKlineViewport(100, { startIndex: 75, endIndex: 124 }), { startIndex: 75, endIndex: 124 })
})
