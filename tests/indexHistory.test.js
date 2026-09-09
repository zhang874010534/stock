import { getKlineTimelineLength } from '../src/utils/klineViewport.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { h30269DemoHistory } from '../src/data/h30269.mock.js'
import { INDEX_RANGES, normalizeHistory, getRangeWindow, getZoomWindow, getWindowSummary, formatIndexValue } from '../src/utils/indexHistory.js'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'
import { createKlineSeries } from '../src/charts/kline/series.js'
import { MA_OPTIONS } from '../src/charts/kline/config.js'
import { buildSubIndicator } from '../src/charts/kline/subIndicators.js'
import { calculateMA } from '../src/utils/indicators.js'

const klineHistory = h30269DemoHistory.map(({ date, close }, index) => {
  const open = close + (index % 2 ? 3 : -3)
  return {
    date,
    open,
    close,
    high: Math.max(open, close) + 2,
    low: Math.min(open, close) - 2,
    volume: 10_000 + index,
    amount: 100_000 + index,
  }
})

test('模拟数据有序、有效且覆盖全部预设范围', () => {
  const normalized = normalizeHistory(h30269DemoHistory)
  assert.deepEqual(normalized, h30269DemoHistory)
  assert.ok(normalized.length > 1500)
  assert.equal(normalized[0].date, '2020-05-25')
  assert.equal(normalized.at(-1).date, '2026-08-31')
  assert.equal(normalized.at(-1).close, 9852.36)
  const starts = INDEX_RANGES.map(({ key }) => getRangeWindow(normalized, key).startIndex)
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] < starts[index - 1])
  assert.equal(starts.at(-1), 0)
})

test('清理无效日期与点位，排序并去重', () => {
  assert.deepEqual(normalizeHistory([
    { date: '2026-08-31', close: 100 },
    { date: '2026-08-28', close: 99 },
    { date: '2026-08-31', close: 101 },
    { date: '2026-02-30', close: 20 },
    { date: '2026-08-27', close: NaN },
    { date: '2026-08-26', close: 0 },
    { date: '2026-08-25', close: -1 },
    { date: '2026-08-24', close: '10' },
    null,
  ]), [{ date: '2026-08-28', close: 99 }, { date: '2026-08-31', close: 101 }])
  assert.deepEqual(normalizeHistory(null), [])
})

test('时间范围使用数据末日而不是当前日期，正确处理月末和闰年', () => {
  const points = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31'].map((date) => ({ date, close: 100 }))
  assert.deepEqual(getRangeWindow(points, '1m'), { startIndex: 1, endIndex: 3 })
  assert.deepEqual(getRangeWindow(points, '5y'), { startIndex: 0, endIndex: 3 })
  assert.deepEqual(getRangeWindow([], '1y'), { startIndex: 0, endIndex: 0 })
})

test('滑动窗口与区间变化计算正确，包括单点和空数据', () => {
  assert.deepEqual(getZoomWindow(101, 25, 75), { startIndex: 25, endIndex: 75 })
  assert.deepEqual(getZoomWindow(101, 120, -20), { startIndex: 0, endIndex: 100 })
  assert.deepEqual(getZoomWindow(1, 30, 50), { startIndex: 0, endIndex: 0 })
  const history = [{ date: '2026-01-01', close: 100 }, { date: '2026-01-02', close: 90 }]
  const summary = getWindowSummary(history, { startIndex: 0, endIndex: 1 })
  assert.ok(Math.abs(summary.changePercent + 10) < 0.00001)
  assert.equal(getWindowSummary(history, { startIndex: 1, endIndex: 1 }).changePercent, 0)
  assert.equal(getWindowSummary([], { startIndex: 0, endIndex: 0 }), null)
  assert.equal(formatIndexValue(9852.36), '9,852.36')
})

test('ECharts 能渲染 K 线、均线、成交量与 KDJ，三图共用缩放窗口', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 430, height: 300 })
  try {
    const history = klineHistory
    chart.setOption(createIndexTrendOption(history, getRangeWindow(history, '1y')))
    const svg = chart.renderToSVGString()
    assert.match(svg, /<svg/)
    assert.doesNotMatch(svg, /NaN/)
    const option = chart.getOption()
    assert.equal(option.series[0].type, 'candlestick')
    assert.equal(option.series[1].type, 'bar')
    assert.notEqual(option.series[1].data[0].itemStyle.color, option.series[1].data[1].itemStyle.color)
    assert.deepEqual(option.dataZoom[0].xAxisIndex, [0, 1, 2])
    assert.deepEqual(option.dataZoom[1].xAxisIndex, [0, 1, 2])
    assert.deepEqual(option.series.map((item) => item.id), ['index-kline', 'index-volume', 'ma-30', 'ma-60', 'kdj-K', 'kdj-D', 'kdj-J'])
    let zoomEvents = 0
    chart.on('datazoom', () => zoomEvents++)
    for (const { key } of INDEX_RANGES) {
      const expected = getRangeWindow(history, key)
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: expected.startIndex, endValue: expected.endIndex })
      const zoom = chart.getOption().dataZoom[0]
      assert.deepEqual(getZoomWindow(getKlineTimelineLength(history.length), zoom.start, zoom.end), expected)
    }
    assert.equal(zoomEvents, INDEX_RANGES.length)
    chart.dispatchAction({ type: 'dataZoom', start: 25, end: 50 })
    const zoom = chart.getOption().dataZoom[0]
    assert.deepEqual(getZoomWindow(getKlineTimelineLength(history.length), zoom.start, zoom.end), getZoomWindow(getKlineTimelineLength(history.length), 25, 50))
    chart.resize({ width: 320, height: 213 })
    assert.doesNotMatch(chart.renderToSVGString(), /NaN/)
  } finally {
    chart.dispose()
  }
})

test('单根行情也可绘制三联图，十字光标启用且不显示浮动卡片', () => {
  const history = [{ date: '2026-08-31', open: 99, close: 100, high: 102, low: 98, volume: 36_100_000, amount: 3_610_000_000 }]
  const option = createIndexTrendOption(history, getRangeWindow(history, '1y'))
  assert.equal(option.tooltip.showContent, false)
  assert.equal(option.tooltip.axisPointer.type, 'cross')
  assert.deepEqual(option.axisPointer.link, [{ xAxisIndex: 'all' }])
  const chart = initIndexTrend(null, { ssr: true, width: 320, height: 260 })
  try {
    chart.setOption(option)
    assert.doesNotMatch(chart.renderToSVGString(), /NaN/)
  } finally {
    chart.dispose()
  }
})

test('同一实例开关均线不会丢失缩放，副图触发的缩放同步到三个时间轴', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 1366, height: 580 })
  const history = klineHistory
  const movingAverages = MA_OPTIONS.map((item) => ({ ...item, data: calculateMA(history, item.period) }))
  const subIndicator = buildSubIndicator(history)
  try {
    chart.setOption(createIndexTrendOption(history, getRangeWindow(history, '1y'), { height: 580 }))
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 50, end: 75 })
    const before = chart.getOption().dataZoom.map(({ startValue, endValue }) => [startValue, endValue])
    const noMA = movingAverages.map((item) => ({ ...item, enabled: false }))
    chart.setOption({ series: createKlineSeries(history, noMA, subIndicator) }, { replaceMerge: ['series'] })
    assert.ok(chart.getOption().series.filter(Boolean).every((item) => !item.id.startsWith('ma-')))
    const allMA = movingAverages.map((item) => ({ ...item, enabled: true }))
    chart.setOption({ series: createKlineSeries(history, allMA, subIndicator) }, { replaceMerge: ['series'] })
    const after = chart.getOption()
    assert.deepEqual(after.dataZoom.map(({ startValue, endValue }) => [startValue, endValue]), before)
    const series = after.series.filter(Boolean)
    assert.equal(series.filter((item) => item.id.startsWith('ma-')).length, 5)
    assert.equal(new Set(series.map((item) => item.id)).size, series.length)
    assert.ok(after.xAxis.every((axis) => axis.data.length === getKlineTimelineLength(history.length)))
    assert.doesNotMatch(chart.renderToSVGString(), /NaN/)
  } finally {
    chart.dispose()
  }
})
