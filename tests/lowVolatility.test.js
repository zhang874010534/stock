import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { calculateLowVolatility, monthlyPriceReturns, drawdownEvents } from '../src/utils/lowVolatility.js'
import { annualizedVolatility, annualizedDownsideDeviation, rollingVolatility, riskPercent } from '../src/utils/priceRisk.js'
import { calculateDrawdown } from '../src/utils/drawdown.js'
import { lowVolatilityOption } from '../src/charts/lowVolatility.js'
import { initLowVolatility } from '../src/charts/lowVolatilityRuntime.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'

const calendar = { id: 'fixture', start: '2022-01-01', end: '2026-12-31', closures: [] }
const now = new Date('2026-09-30T10:00:00Z')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
function daysBetween(start, end, cal = calendar) {
  const days = []
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86400_000) {
    const date = new Date(time), day = date.toISOString().slice(0, 10)
    if (![0, 6].includes(date.getUTCDay()) && !cal.closures.some(([s, e]) => day >= s && day <= e)) days.push(day)
  }
  return days
}
function market(days, prices = days.map(() => 100), code = 'H30269') {
  const history = days.map((date, i) => ({ date, close: prices[i], open: prices[i], high: prices[i], low: prices[i] }))
  return { code, name: code, interval: '1d', source: 'eastmoney', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
const analyze = (data, options = {}) => calculateLowVolatility(data, { calendar, now, ...options })

test('下行波动率以全部日收益 N−1 为分母，正收益计零；不是只取负收益的标准差', () => {
  near(annualizedDownsideDeviation([-.2, .25, -.1]), Math.sqrt((.04 + .01) / 2 * 252))
  assert.equal(annualizedDownsideDeviation([0, .1, .2]), 0)
  assert.equal(annualizedVolatility([-.01, -.01, -.01]), 0)
  near(annualizedDownsideDeviation([-.01, -.01, -.01]), Math.sqrt(.0003 / 2 * 252))
  assert.equal(annualizedDownsideDeviation([-.1]), null)
  assert.throws(() => annualizedDownsideDeviation([NaN, 0]), /日收益无效/)
  assert.throws(() => annualizedDownsideDeviation([-1e308, 0]), /非有限/)
  assert.equal(riskPercent(null), '—')
  assert.equal(riskPercent(-1e-8, true), '0.00%')
})

test('完整月以上月最后交易日为基准，周末月末与闰年正确；首月不伪造基准', () => {
  const days = daysBetween('2024-01-31', '2024-03-29')
  const data = market(days, days.map(day => day === '2024-01-31' ? 100 : day <= '2024-02-29' ? 80 : 88))
  const months = monthlyPriceReturns(data.history, days[0], days.at(-1), calendar)
  assert.deepEqual(months.map(m => [m.month, m.baseDate, m.endDate, m.status]), [
    ['2024-02', '2024-01-31', '2024-02-29', 'complete'], ['2024-03', '2024-02-29', '2024-03-29', 'complete'],
  ])
  near(months[0].value, -.2); near(months[1].value, .1)
  const clipped = monthlyPriceReturns(data.history, '2024-02-01', days.at(-1), calendar)
  assert.equal(clipped[0].value, null); assert.match(clipped[0].reason, /未覆盖上月末/)
  const missing = monthlyPriceReturns(data.history.slice(1), days[0], days.at(-1), calendar)
  assert.match(missing[0].reason, /缺少上月/)
})

test('月内跌幅不参与最差完整月份排名，年初至今不生成十二月；等收益按月份排序', () => {
  const days = daysBetween('2025-12-31', '2026-03-16')
  const prices = days.map(day => day <= '2026-02-27' ? 100 : 50)
  const stats = analyze(market(days, prices), { range: 'ytd' })
  assert.equal(stats.startDate, '2025-12-31')
  assert.deepEqual(stats.months.map(m => m.month), ['2026-01', '2026-02', '2026-03'])
  assert.equal(stats.months.at(-1).status, 'partial')
  near(stats.months.at(-1).value, -.5)
  assert.equal(stats.completeMonthCount, 2)
  assert.equal(stats.worstMonth.month, '2026-01')
  assert.deepEqual(stats.worstMonths.map(m => m.month), ['2026-01', '2026-02'])
})

test('回撤事件互不重叠，同价恢复采用最近高点，最低点相同保留首次；未恢复只计一轮', () => {
  const days = daysBetween('2026-01-02', '2026-01-15')
  const data = market(days, [100, 100, 80, 80, 90, 100, 100, 90, 70, 75])
  const events = drawdownEvents(data.history)
  assert.equal(events.length, 2)
  near(events[0].depth, .3)
  assert.equal(events[0].peakDate, days[6]); assert.equal(events[0].troughDate, days[8])
  assert.equal(events[0].recoveryDate, null); assert.equal(events[0].endDate, days[9])
  assert.equal(events[0].durationSessions, 3)
  assert.equal(events[1].peakDate, days[1]); assert.equal(events[1].troughDate, days[2])
  assert.equal(events[1].recoveryDate, days[5])
  assert.equal(events[1].durationDays, (Date.parse(days[5]) - Date.parse(days[1])) / 86400_000)
  near(events[0].depth, -calculateDrawdown(data.history).maximum.value)
  assert.deepEqual(drawdownEvents(market(days).history), [])
})

test('20／60／120日窗口要求完整日收益数，首个有值的位置为第窗口+1个收盘价', () => {
  const days = daysBetween('2026-01-05', '2026-08-31')
  const data = market(days, days.map((_, i) => 100 + i % 7))
  for (const rollingSessions of [20, 60, 120]) {
    const stats = analyze(data, { rollingSessions })
    assert.equal(stats.points[rollingSessions - 1].volatility, null)
    assert.equal(stats.points[rollingSessions - 1].downside, null)
    const returns = data.history.slice(1, rollingSessions + 1).map((r, i) => r.close / data.history[i].close - 1)
    near(stats.points[rollingSessions].volatility, annualizedVolatility(returns))
    near(stats.points[rollingSessions].downside, annualizedDownsideDeviation(returns))
  }
})

test('滚动预热使用区间前真实连续行情，历史空档打断窗口，重新积累完整窗口后恢复', () => {
  const days = daysBetween('2026-01-05', '2026-08-31')
  const data = market(days, days.map((_, i) => 100 + i % 7))
  const rolling = rollingVolatility(data, days[65], days.at(-1), calendar)
  const returns = data.history.slice(6, 66).map((r, i) => r.close / data.history[i + 5].close - 1)
  near(rolling.get(days[65]), annualizedVolatility(returns))
  data.history.splice(40, 1)
  const gap = rollingVolatility(data, days[65], days.at(-1), calendar)
  assert.equal(gap.get(days[100]), null)
  assert.ok(gap.get(days[101]) > 0)
})

test('样本不足显示空值，缺日、非交易日、历史不足、未来及证券身份异常停止分析', () => {
  const days = daysBetween('2026-01-05', '2026-01-12')
  const stats = analyze(market(days.slice(0, 2), [100, 90]))
  assert.equal(stats.annualizedVolatility, null); assert.equal(stats.annualizedDownsideDeviation, null)
  assert.equal(stats.worstMonth, null)
  assert.throws(() => analyze(market(days.slice(0, 1))), /至少需要两个/)
  assert.throws(() => analyze(market(days.filter((_, i) => i !== 2))), /缺少 1 个交易日：2026-01-07/)
  assert.throws(() => analyze(market([...days.slice(0, 5), '2026-01-10', days[5]])), /非交易日/)
  assert.throws(() => analyze(market(days), { range: 'year' }), /历史不足/)
  assert.throws(() => analyze(market(days), { rollingSessions: 30 }), /仅支持/)
  assert.throws(() => analyze(market(days), { now: new Date('2026-01-05') }), /未来日期/)
  assert.throws(() => analyze(market(days, undefined, '000300')), /身份无效/)
  const data = market(days); data.source = 'other'
  assert.throws(() => analyze(data), /来源异常/)
})

use([SVGRenderer])
test('真实ECharts渲染总与下行两条百分比曲线，保留不足窗口空值；缩放不改统计摘要', () => {
  const days = daysBetween('2026-01-05', '2026-05-29')
  const stats = analyze(market(days, days.map((_, i) => 100 + i % 7)))
  const chart = initLowVolatility(null, { renderer: 'svg', ssr: true, width: 900, height: 320 })
  try {
    chart.setOption(lowVolatilityOption(stats))
    const option = chart.getOption()
    assert.equal(option.series.length, 2)
    assert.equal(option.series[0].data[59], null)
    near(option.series[1].data[60], stats.points[60].downside * 100)
    assert.match(chart.renderToSVGString(), /总波动率/)
    assert.match(chart.renderToSVGString(), /下行波动率/)
    assert.match(lowVolatilityOption(stats).tooltip.formatter([{ dataIndex: 0 }]), /年化总波动率 —/)
    const before = stats.annualizedDownsideDeviation
    chart.dispatchAction({ type: 'dataZoom', start: 20, end: 80 })
    assert.equal(chart.getOption().dataZoom[0].start, 20)
    assert.equal(stats.annualizedDownsideDeviation, before)
  } finally { chart.dispose() }
})

test('真实快照四个区间可计算，ETF与指数身份和价格口径独立，日历覆盖限制正确', async () => {
  for (const name of ['h30269', '512890']) {
    const data = JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))
    for (const range of ['all', 'year', 'threeYears', 'ytd']) {
      const stats = calculateLowVolatility(data, { range, now })
      assert.ok(stats.startDate >= tradingCalendar.start)
      assert.equal(stats.endDate, data.latest.date)
      assert.equal(stats.code, data.code)
      assert.ok(Number.isFinite(stats.annualizedDownsideDeviation))
      assert.ok(stats.worstMonths.every(m => m.status === 'complete'))
      assert.ok(stats.events.length <= 5)
      assert.ok(stats.basis.startsWith(data.code === '512890' ? 'unadjusted_etf' : 'price_index'))
    }
  }
})
