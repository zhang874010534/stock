import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { calculateDrawdown, formatDrawdown } from '../src/utils/drawdown.js'
import { drawdownTrendOption, drawdownWindow } from '../src/charts/drawdownTrend.js'
import { initDrawdown } from '../src/charts/drawdownRuntime.js'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

const rows = prices => prices.map((close, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), close }))
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)

test('回撤逐日对比此前最高收盘价；最大回撤未恢复时保留高点、低点及截止时长', () => {
  const history = rows([100, 120, 90, 96])
  const stats = calculateDrawdown(history)
  assert.equal(stats.count, 4)
  stats.points.forEach((point, i) => near(point.value, [0, 0, -.25, -.2][i]))
  near(stats.current.value, -.2)
  assert.equal(stats.current.peakDate, '2026-01-02')
  assert.equal(stats.current.days, 2)
  assert.deepEqual(stats.maximum, { value: -.25, peakDate: '2026-01-02', peakClose: 120,
    troughDate: '2026-01-03', troughClose: 90, recoveryDate: null, days: 2 })
  assert.equal(stats.startDate, '2026-01-01')
  assert.equal(stats.endDate, '2026-01-04')
  assert.deepEqual(history, rows([100, 120, 90, 96]))
})

test('达到原高点即恢复；历史最大回撤已恢复与当前再次下跌分别记录', () => {
  const stats = calculateDrawdown(rows([100, 80, 90, 100, 110, 105]))
  near(stats.maximum.value, -.2)
  assert.equal(stats.maximum.recoveryDate, '2026-01-04')
  assert.equal(stats.maximum.days, 3)
  assert.equal(stats.current.peakDate, '2026-01-05')
  near(stats.current.value, 105 / 110 - 1)
  assert.equal(stats.current.days, 1)
})

test('相同高点取下跌前最近一次，同深度保留首次最大事件；更深谷底更新恢复区间', () => {
  const tied = calculateDrawdown(rows([100, 100, 80, 100, 80]))
  assert.equal(tied.maximum.peakDate, '2026-01-02')
  assert.equal(tied.maximum.troughDate, '2026-01-03')
  assert.equal(tied.maximum.recoveryDate, '2026-01-04')
  assert.equal(tied.current.peakDate, '2026-01-04')
  const deeper = calculateDrawdown(rows([100, 90, 95, 75, 100, 110, 70]))
  assert.equal(deeper.maximum.peakDate, '2026-01-06')
  assert.equal(deeper.maximum.troughDate, '2026-01-07')
  assert.equal(deeper.maximum.recoveryDate, null)
  near(deeper.maximum.value, 70 / 110 - 1)
})

test('单样本和空数据不假报零回撤；持续上涨或平价为零、无需恢复', () => {
  for (const history of [[], rows([100])]) {
    const stats = calculateDrawdown(history)
    assert.equal(stats.current, null)
    assert.equal(stats.maximum, null)
    assert.equal(stats.points.length, 0)
  }
  for (const prices of [[1, 2, 3], [1, 1, 1]]) {
    const stats = calculateDrawdown(rows(prices))
    assert.equal(stats.current.value, 0)
    assert.equal(stats.maximum, null)
    assert.equal(stats.current.days, 0)
  }
  assert.equal(formatDrawdown(-.0000001), '0.00%')
  assert.equal(formatDrawdown(-.125), '-12.50%')
  assert.equal(formatDrawdown(null), '—')
})

test('自然日时长跨闰年和日期空档，不推断缺失日恢复；拒绝无效、重复或乱序输入', () => {
  const stats = calculateDrawdown([{ date: '2024-02-28', close: 100 }, { date: '2024-03-01', close: 80 }, { date: '2024-03-10', close: 100 }])
  assert.equal(stats.maximum.days, 11)
  assert.equal(stats.maximum.recoveryDate, '2024-03-10')
  for (const history of [null, [{ date: '2026-02-30', close: 1 }], rows([1, 2]).reverse(),
    [rows([1])[0], rows([1])[0]], ...[NaN, Infinity, 0, -1, '100'].map(close => [{ date: '2026-01-01', close }])]) {
    assert.throws(() => calculateDrawdown(history))
  }
})

test('真实两只证券序列使用全部已同步范围，逐点回撤与独立极值计算一致', async () => {
  for (const name of ['512890', 'h30269']) {
    const { history } = JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
    const stats = calculateDrawdown(history)
    const independent = history.map((row, index) => row.close / Math.max(...history.slice(0, index + 1).map(item => item.close)) - 1)
    stats.points.forEach((point, i) => near(point.value, independent[i]))
    near(stats.maximum.value, Math.min(...independent))
    assert.equal(stats.startDate, history[0].date)
    assert.equal(stats.endDate, history.at(-1).date)
    assert.equal(stats.count, history.length)
  }
})

test('缩放窗口按日期保留，回补和追加不改变历史查看区间；全范围随新数据扩展', () => {
  const previous = rows([100, 90, 80, 95, 100]), points = [{ date: '2025-12-31', close: 95 }, ...previous, { date: '2026-01-06', close: 90 }]
  assert.deepEqual(drawdownWindow(previous, points, { start: 25, end: 75 }), { startIndex: 2, endIndex: 4 })
  assert.deepEqual(drawdownWindow(previous, points, { start: 0, end: 100 }), { startIndex: 0, endIndex: 6 })
  assert.deepEqual(drawdownWindow([], previous), { startIndex: 0, endIndex: 4 })
})

// Register only the new production runtime plus SVG for a real SSR rendering.
use([SVGRenderer])
test('按需图表实际渲染负百分比、最大区间标注和缩放，零回撤无伪造极值标注', () => {
  const stats = calculateDrawdown(rows([100, 80, 95, 100]))
  const chart = initDrawdown(null, { renderer: 'svg', ssr: true, width: 800, height: 320 })
  try {
    chart.setOption(drawdownTrendOption(stats, '512890'), { notMerge: true })
    const option = chart.getOption()
    option.series[0].data.forEach((value, i) => near(value, [0, -20, -5, 0][i]))
    assert.equal(option.yAxis[0].max, 0)
    assert.ok(chart.getModel().getComponent('markArea'))
    assert.ok(chart.getModel().getComponent('markPoint'))
    assert.match(chart.renderToSVGString(), /最大回撤区间/)
    assert.match(chart.renderToSVGString(), /-20.00%/)
    const tooltip = drawdownTrendOption(stats, '512890').tooltip.formatter([{ dataIndex: 1 }])
    assert.match(tooltip, /80.000 元/)
    assert.match(tooltip, /2026-01-01/)
    chart.dispatchAction({ type: 'dataZoom', start: 20, end: 80 })
    assert.equal(chart.getOption().dataZoom[0].start, 20)
    const flat = calculateDrawdown(rows([100, 100]))
    chart.setOption(drawdownTrendOption(flat, 'H30269'), { notMerge: true })
    assert.deepEqual(chart.getOption().series[0].markArea.data, [])
    assert.deepEqual(chart.getOption().series[0].markPoint.data, [])
    assert.match(chart.renderToSVGString(), /<path/)
  } finally { chart.dispose() }
})
