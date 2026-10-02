import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePortfolioHistory, selectPortfolioHistory, portfolioHistoryCsv } from '../src/utils/portfolioHistory.js'
import { portfolioSummary } from '../src/utils/portfolioLedger.js'
import { portfolioHistoryOption } from '../src/charts/portfolioHistory.js'
import { initPortfolioHistory } from '../src/charts/portfolioHistoryRuntime.js'
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

const now = new Date('2026-10-10T08:00:00Z'), time = now.toISOString()
const entry = (id, type, date, values = {}) => ({ id, instrument: '512890', type, date, sequence: 1,
  quantity: ['buy', 'sell'].includes(type) ? 100 : null, price: ['buy', 'sell'].includes(type) ? 1 : null,
  amount: ['dividend', 'fee'].includes(type) ? 10 : null, fee: 0, ratio: type === 'split' ? 2 : null,
  note: '', createdAt: time, updatedAt: time, ...values })
const market = history => ({ code: '512890', source: 'eastmoney', interval: '1d', history, latest: history.at(-1) })
const quotes = ['18', '21', '22', '23', '24', '28', '29', '30'].map((day, i) => ({ date: `2026-09-${day}`, close: [1.5, 2.5, 2.5, 2.5, 2.5, 1.25, 1.3, 2][i] }))
const entries = [entry('b1', 'buy', '2026-09-18', { fee: 1 }), entry('b2', 'buy', '2026-09-21', { price: 2, fee: 1 }),
  entry('sell', 'sell', '2026-09-22', { quantity: 50, price: 3, fee: 2 }), entry('div', 'dividend', '2026-09-23', { amount: 20, fee: 1 }),
  entry('fee', 'fee', '2026-09-24', { amount: 3 }), entry('split', 'split', '2026-09-28'),
  entry('close', 'sell', '2026-09-29', { quantity: 300, price: 1.3, fee: 2 }), entry('again', 'buy', '2026-09-30', { price: 2, fee: 1 })]
const analyze = (items = entries, data = market(quotes), options = {}) => calculatePortfolioHistory(items, data, { now, ...options })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('daily replay independently reconciles buys, partial sale, fees, net dividend, split, liquidation and reentry', () => {
  const stats = analyze([...entries].reverse())
  assert.equal(stats.points.length, 8); assert.equal(stats.missingCount, 0)
  assert.deepEqual(stats.points.map(point => point.totalProfit), [49, 198, 221, 240, 237, 237, 250, 249])
  assert.deepEqual(stats.points.map(point => point.invested), [101, 302, 302, 302, 302, 302, 302, 503])
  assert.deepEqual(stats.points.map(point => point.fees), [1, 2, 4, 5, 8, 8, 10, 11])
  near(stats.points[2].cost, 226.5); near(stats.points[2].realized, 72.5)
  assert.equal(stats.points[3].dividends, 19); assert.equal(stats.points[4].feeImpact, -8)
  assert.equal(stats.points[5].shares, 300); assert.equal(stats.points[5].marketValue, 375)
  assert.equal(stats.points[6].shares, 0); assert.equal(stats.points[6].cost, 0)
  const last = stats.points.at(-1), summary = portfolioSummary(entries, market(quotes).latest, { now })
  for (const key of ['shares', 'cost', 'marketValue', 'invested', 'realized', 'unrealized', 'totalProfit', 'fees', 'dividends']) near(last[key], summary[key])
  near(last.marketValue + last.proceeds + last.dividends - last.invested - last.otherFees, 249)
})

test('same-day explicit order, penny rounding and daily end-of-day holdings use exactly the existing cost method', () => {
  const buy = entry('buy', 'buy', '2026-09-18', { quantity: 101, price: 1.005 })
  const sell = entry('sell', 'sell', '2026-09-18', { sequence: 2, quantity: 50, price: 2, fee: 1 })
  const point = analyze([sell, buy], market(quotes.slice(0, 1))).points[0]
  assert.equal(point.entryCount, 2); assert.equal(point.shares, 51); assert.equal(point.invested, 101.51)
  near(point.totalProfit, 51 * 1.5 + 99 - 101.51)
  assert.throws(() => analyze([{ ...sell, sequence: 1 }, { ...buy, sequence: 2 }]), /超过当时持仓/)
})

test('missing sessions and non-trading ledger dates keep gaps without dropping the bookkeeping cash flows', () => {
  const items = [entry('buy', 'buy', '2026-09-18'), entry('div', 'dividend', '2026-09-26', { amount: 20 })]
  const stats = analyze(items, market([quotes[0], quotes[4], quotes[5]]))
  assert.deepEqual(stats.points.map(point => point.date), ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-26', '2026-09-28'])
  const missing = stats.points[1]
  assert.equal(missing.marketValue, null); assert.equal(missing.totalProfit, null); assert.equal(missing.invested, 100)
  assert.equal(stats.points[5].dividends, 20); assert.equal(stats.points[5].close, null)
  assert.equal(stats.points.at(-1).totalProfit, 45); assert.equal(stats.missingCount, 4)
  assert.match(stats.warnings.join(' '), /保留断点/)
})

test('records before market coverage or after latest quote remain dated honestly; zero holdings need no price', () => {
  const items = [entry('old', 'buy', '2026-09-17'), entry('sell', 'sell', '2026-09-29', { price: 2 }), entry('div', 'dividend', '2026-09-30', { amount: 10 })]
  const stats = analyze(items, market(quotes.slice(0, 6)))
  assert.equal(stats.points[0].date, '2026-09-17'); assert.equal(stats.points[0].marketValue, null)
  assert.equal(stats.points.at(-1).date, '2026-09-30'); assert.equal(stats.points.at(-1).marketValue, 0)
  assert.equal(stats.points.at(-1).totalProfit, 110)
  assert.match(stats.warnings.join(' '), /此前仅列实际记账日期/); assert.match(stats.warnings.join(' '), /晚于最后已收盘行情/)
  const pending = analyze([entry('buy', 'buy', '2026-10-09')], market(quotes))
  assert.equal(pending.points.length, 1); assert.equal(pending.points[0].marketValue, null)
  assert.equal(pending.points[0].invested, 100)
})

test('no quotes still permits closed-position earnings; invalid identity, date, price or latest disables all quotes', () => {
  const closed = [entry('buy', 'buy', '2026-09-18'), entry('sell', 'sell', '2026-09-21', { price: 2 })]
  const noQuotes = analyze(closed, null)
  assert.equal(noQuotes.points[0].marketValue, null); assert.equal(noQuotes.points[1].totalProfit, 100)
  const invalid = [
    { ...market(quotes), code: 'H30269' }, { ...market(quotes), latest: { ...quotes.at(-1), close: 99 } },
    market([quotes[0], quotes[0]]), market([{ ...quotes[0], close: NaN }]), market([{ date: '2026-10-12', close: 1 }]),
    market([{ date: '2026-09-26', close: 1 }]), market([quotes[1], quotes[0]]), market([{ date: '2026-02-30', close: 1 }]),
  ]
  for (const bad of invalid) {
    const stats = analyze([entries[0]], bad)
    assert.equal(stats.points[0].marketValue, null); assert.equal(stats.points[0].invested, 101)
    assert.ok(stats.warnings.some(message => message.includes('暂停估值')))
  }
  assert.deepEqual(analyze([], null).points, [])
})

test('current unclosed prices never enter the curve, and pre-calendar real history remains usable with a coverage notice', () => {
  const stats = analyze(entries, market(quotes), { now: new Date('2026-09-30T06:00:00Z') })
  assert.equal(stats.quoteEnd, '2026-09-29'); assert.equal(stats.points.at(-1).marketValue, null)
  assert.equal(stats.points.at(-1).invested, 503); assert.equal(stats.points.at(-1).valuationReason, '当日尚未收盘')
  const early = analyze([entry('old', 'buy', '2022-06-06')], market([{ date: '2022-06-06', close: 1.1 }, { date: '2022-06-08', close: 1.2 }]))
  assert.equal(early.points.length, 2); near(early.points[1].totalProfit, 20)
  assert.match(early.warnings.join(' '), /覆盖外仅使用真实行情与记账日期/)
  assert.throws(() => analyze([entry('future', 'buy', '2026-10-11')]), /未来交易/)
})

test('display ranges retain lifetime amounts, use the actual last date and clamp leap anniversaries', () => {
  const points = [{ date: '2023-02-28', invested: 100 }, { date: '2023-03-01', invested: 200 }, { date: '2024-01-02', invested: 300 }, { date: '2024-02-29', invested: 400 }]
  const stats = { points, startDate: points[0].date, endDate: points.at(-1).date, warnings: [], missingCount: 0 }
  assert.equal(selectPortfolioHistory(stats), stats)
  assert.equal(selectPortfolioHistory(stats, 'year').points[0].date, '2023-02-28')
  assert.equal(selectPortfolioHistory(stats, 'ytd').points[0].invested, 300)
  assert.equal(selectPortfolioHistory(stats, 'ytd').endDate, '2024-02-29')
  assert.throws(() => selectPortfolioHistory(stats, 'bad'), /区间无效/)
})

test('CSV leaves unknown valuation empty, exports net dividends and negative fee impact with explicit units', () => {
  const stats = analyze(entries, market(quotes.filter(point => point.date !== '2026-09-23')))
  const csv = portfolioHistoryCsv(stats)
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.match(csv, /累计买入支出含买入费（元）/)
  const cells = csv.split('\r\n').find(line => line.startsWith('"2026-09-23"')).split(',')
  assert.equal(cells[4], ''); assert.equal(cells[8], ''); assert.equal(cells[9], '19')
  assert.equal(cells[10], '5'); assert.equal(cells[11], '-5'); assert.match(cells[14], /缺少当日收盘价/)
  assert.ok(!csv.includes('NaN')); assert.ok(!csv.includes('null'))
})

test('ECharts renders two synced panels with all five lines and null gaps; tooltip explains fees without using user HTML', () => {
  const stats = analyze(entries, market(quotes.filter(point => point.date !== '2026-09-23')))
  const option = portfolioHistoryOption(stats)
  assert.equal(option.series.length, 5); assert.equal(option.grid.length, 2)
  assert.deepEqual(option.dataZoom[0].xAxisIndex, [0, 1])
  assert.equal(option.series[2].data[3], null); assert.ok(option.series.every(series => series.connectNulls === false))
  assert.match(option.tooltip.formatter([{ dataIndex: 3 }]), /累计盈亏：—/)
  assert.match(option.tooltip.formatter([{ dataIndex: 3 }]), /费用已计入成本／盈亏/)
  use([SVGRenderer])
  const chart = initPortfolioHistory(null, { renderer: 'svg', ssr: true, width: 800, height: 470 })
  try { chart.setOption(option); assert.equal(chart.getOption().series.length, 5); assert.ok(chart.renderToSVGString().includes('<svg')) }
  finally { chart.dispose() }
})
