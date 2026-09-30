import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { calculateIndexComparison, annualizedVolatility } from '../src/utils/indexComparison.js'
import { indexComparisonOption } from '../src/charts/indexComparison.js'
import { initIndexComparison } from '../src/charts/indexComparisonRuntime.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'

const calendar = { id: 'fixture', start: '2022-01-01', end: '2026-12-31', closures: [] }
const now = new Date('2026-09-30T10:00:00Z')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
function dates(start, count, cal = calendar) {
  const result = [], day = new Date(`${start}T00:00:00Z`)
  while (result.length < count) {
    const text = day.toISOString().slice(0, 10), weekday = day.getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !cal.closures.some(([s, e]) => text >= s && text <= e)) result.push(text)
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return result
}
function dataset(code, days, prices = days.map(() => 100)) {
  const history = days.map((date, i) => ({ date, close: prices[i], open: prices[i], high: prices[i], low: prices[i] }))
  return { code, name: code, interval: '1d', source: 'eastmoney', updatedAt: now.toISOString(),
    backfill: { completed: false }, history, latest: history.at(-1) }
}
function custom(a, b, start = a.history[0].date, end = [a.latest.date, b.latest.date].sort()[0], options = {}) {
  return calculateIndexComparison(a, b, { range: 'custom', start, end, calendar, now, ...options })
}

test('同一起点收益、区间回撤和样本波动率与手算一致；两点历史不伪造波动率', () => {
  const days = dates('2026-01-05', 4)
  const a = dataset('H30269', days, [100, 80, 100, 90]), b = dataset('000300', days, [200, 200, 200, 200])
  const result = custom(a, b)
  assert.equal(result.count, 4)
  near(result.series[0].cumulativeReturn, -.1)
  near(result.returnDifference, -.1)
  near(result.series[0].maxDrawdown, .2)
  assert.equal(result.series[0].drawdownPeakDate, days[0])
  const returns = [-.2, .25, -.1], mean = returns.reduce((sum, x) => sum + x, 0) / 3
  near(result.series[0].annualizedVolatility, Math.sqrt(returns.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 2) * Math.sqrt(252))
  assert.equal(result.series[1].annualizedVolatility, 0)
  assert.deepEqual(result.series[1].points.map(point => point.drawdown), [0, 0, 0, 0])
  assert.equal(custom(a, b, days[0], days[1]).series[0].annualizedVolatility, null)
  assert.throws(() => annualizedVolatility([1e308, -1e308]), /非有限/)
})

test('同一价格比例序列结果相同，取共同截止日，选区间会重置回撤高点', () => {
  const days = dates('2026-01-05', 5)
  const a = dataset('H30269', days, [100, 80, 90, 100, 200]), b = dataset('000300', days.slice(0, 4), [200, 160, 180, 200])
  const result = calculateIndexComparison(a, b, { range: 'all', calendar, now })
  assert.equal(result.endDate, days[3])
  assert.equal(result.series[0].sourceDate, days[4])
  assert.equal(result.returnDifference, 0)
  assert.deepEqual(result.series[0].points, result.series[1].points)
  const shorter = custom(a, b, days[1], days[3])
  assert.equal(shorter.series[0].maxDrawdown, 0)
  near(shorter.series[0].cumulativeReturn, .25)
})

test('年初至今用上年末基准；周末自定义日期按交易日调整，闰年周年回退正确', () => {
  const days = dates('2025-12-30', 6, tradingCalendar)
  const a = dataset('H30269', days), b = dataset('000300', days)
  assert.equal(calculateIndexComparison(a, b, { range: 'ytd', now }).startDate, '2025-12-31')
  const adjusted = custom(a, b, '2026-01-03', '2026-01-07', { calendar: tradingCalendar })
  assert.equal(adjusted.startDate, '2026-01-05')
  assert.equal(adjusted.endDate, '2026-01-07')
  const leapDays = dates('2023-02-28', 263).filter(day => day <= '2024-02-29')
  const leapA = dataset('H30269', leapDays), leapB = dataset('000300', leapDays)
  assert.equal(leapA.latest.date, '2024-02-29')
  assert.equal(calculateIndexComparison(leapA, leapB, { range: 'year', now, calendar }).startDate, '2023-02-28')
})

test('历史不足、缺日、非交易日、未来日期和日历越界均停止计算；全部历史受日历覆盖限制', () => {
  const days = dates('2026-01-05', 6)
  const a = dataset('H30269', days), b = dataset('000300', days)
  assert.throws(() => calculateIndexComparison(a, b, { range: 'year', calendar, now }), /共同历史不足/)
  assert.throws(() => custom(a, dataset('000300', days.filter(day => day !== days[2]))), /000300 缺少 1 个交易日：2026-01-07/)
  const weekend = [...days.slice(0, 5), '2026-01-10', days[5]]
  assert.throws(() => custom(a, dataset('000300', weekend)), /非交易日/)
  assert.throws(() => custom(a, b, days[0], '2026-01-15'), /共同截止日/)
  assert.throws(() => custom(a, b, days[3], days[0]), /开始日期/)
  assert.throws(() => custom(a, b, '2026-02-30', days[5]), /日期无效/)
  assert.throws(() => custom(a, b, days[0], days[5], { calendar: { ...calendar, end: '2025-12-31' } }), /日历未覆盖/)
  assert.throws(() => custom(a, b, days[0], days[5], { now: new Date('2026-01-05T00:00:00Z') }), /未来日期/)
  const older = dates('2022-12-28', 8, tradingCalendar)
  const all = calculateIndexComparison(dataset('H30269', older), dataset('000300', older), { range: 'all', now })
  assert.equal(all.startDate, '2023-01-03')
})

test('滚动波动率用61个连续收盘预热，历史空档不能跨日计算；积累完整窗口后恢复', () => {
  const days = dates('2026-01-05', 130), prices = days.map((_, i) => 100 + i % 7)
  const a = dataset('H30269', days, prices), b = dataset('000300', days, prices)
  const warm = custom(a, b, days[65])
  near(warm.series[0].points[0].rollingVolatility, annualizedVolatility(prices.slice(6, 66).map((price, i) => price / prices[i + 5] - 1)))
  assert.equal(custom(a, b).series[0].points[59].rollingVolatility, null)
  assert.ok(custom(a, b).series[0].points[60].rollingVolatility > 0)
  const gap = dataset('000300', days.filter((_, i) => i !== 40), prices.filter((_, i) => i !== 40))
  const result = custom(a, gap, days[65])
  assert.equal(result.series[1].points[0].rollingVolatility, null)
  assert.equal(result.series[1].points[35].rollingVolatility, null)
  assert.ok(result.series[1].points[36].rollingVolatility > 0)
})

use([SVGRenderer])
test('真实ECharts渲染三张图和六条曲线，共用缩放轴；滑块不改变计算摘要', () => {
  const days = dates('2026-01-05', 70)
  const stats = custom(dataset('H30269', days, days.map((_, i) => 100 + i % 5)), dataset('000300', days))
  const chart = initIndexComparison(null, { renderer: 'svg', ssr: true, width: 900, height: 700 })
  try {
    chart.setOption(indexComparisonOption(stats))
    const option = chart.getOption()
    assert.equal(option.series.length, 6)
    assert.equal(option.grid.length, 3)
    assert.deepEqual(option.dataZoom[0].xAxisIndex, [0, 1, 2])
    assert.equal(option.series[0].data[0], 0)
    assert.equal(option.series[4].data[59], null)
    assert.match(chart.renderToSVGString(), /累计价格收益/)
    assert.match(chart.renderToSVGString(), /区间收盘回撤/)
    assert.match(indexComparisonOption(stats).tooltip.formatter([{ dataIndex: 0 }]), /60日年化波动率 —/)
    chart.dispatchAction({ type: 'dataZoom', start: 20, end: 80 })
    assert.equal(chart.getOption().dataZoom[0].start, 20)
    near(stats.series[0].cumulativeReturn, 0.04)
  } finally { chart.dispose() }
})

test('本地真实快照各区间均同日对齐，历史回补不绕过日历验证', async () => {
  const [index, benchmark] = await Promise.all(['h30269', '000300'].map(async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))))
  for (const range of ['year', 'threeYears', 'ytd', 'all']) {
    const stats = calculateIndexComparison(index, benchmark, { range })
    assert.equal(stats.series[0].points[0].date, stats.series[1].points[0].date)
    assert.equal(stats.series[0].points.at(-1).date, stats.series[1].points.at(-1).date)
    assert.ok(stats.startDate >= tradingCalendar.start)
    assert.ok(stats.series.every(series => Number.isFinite(series.annualizedVolatility)))
  }
})
