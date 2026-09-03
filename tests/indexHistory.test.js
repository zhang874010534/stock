import test from 'node:test'
import assert from 'node:assert/strict'
import { h30269DemoHistory } from '../src/data/h30269.mock.js'
import { INDEX_RANGES, normalizeHistory, getRangeWindow, getZoomWindow, getWindowSummary, formatIndexValue } from '../src/utils/indexHistory.js'
import { initIndexTrend, createIndexTrendOption } from '../src/charts/indexTrend.js'

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

test('ECharts 能渲染走势，预设窗口与缩放事件保持一致', () => {
  const chart = initIndexTrend(null, { ssr: true, width: 430, height: 230 })
  try {
    const history = h30269DemoHistory
    chart.setOption(createIndexTrendOption(history, getRangeWindow(history, '1y'), true))
    const svg = chart.renderToSVGString()
    assert.match(svg, /<svg/)
    assert.match(svg, /9,852.36/)
    assert.doesNotMatch(svg, /NaN/)
    let zoomEvents = 0
    chart.on('datazoom', () => zoomEvents++)
    for (const { key } of INDEX_RANGES) {
      const expected = getRangeWindow(history, key)
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: expected.startIndex, endValue: expected.endIndex })
      const zoom = chart.getOption().dataZoom[0]
      assert.deepEqual(getZoomWindow(history.length, zoom.start, zoom.end), expected)
    }
    assert.equal(zoomEvents, INDEX_RANGES.length)
    chart.dispatchAction({ type: 'dataZoom', start: 25, end: 50 })
    const zoom = chart.getOption().dataZoom[0]
    assert.deepEqual(getZoomWindow(history.length, zoom.start, zoom.end), getZoomWindow(history.length, 25, 50))
    chart.resize({ width: 320, height: 213 })
    assert.doesNotMatch(chart.renderToSVGString(), /NaN/)
  } finally {
    chart.dispose()
  }
})

test('少量数据也可绘图，提示文本明确说明模拟状态', () => {
  const history = [{ date: '2026-08-31', close: 100 }]
  const option = createIndexTrendOption(history, getRangeWindow(history, '1y'), true)
  assert.match(option.tooltip.formatter([{ axisValue: '2026-08-31', value: 100 }]), /模拟数据/)
  const chart = initIndexTrend(null, { ssr: true, width: 320, height: 213 })
  try {
    chart.setOption(option)
    assert.doesNotMatch(chart.renderToSVGString(), /NaN/)
  } finally {
    chart.dispose()
  }
})
