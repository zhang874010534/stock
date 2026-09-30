import test from 'node:test'
import assert from 'node:assert/strict'
import { marketSummary, signedValue } from '../src/utils/marketSummary.js'

const rows = (...pairs) => pairs.map(([date, close]) => ({ date, close }))

test('日涨跌与年初至今采用同一证券收盘价，跳过休市日和周末', () => {
  const history = rows(['2025-12-31', 100], ['2026-01-05', 110], ['2026-01-06', 99])
  const summary = marketSummary(history)
  assert.equal(summary.previousDate, '2026-01-05')
  assert.equal(summary.change, -11)
  assert.equal(summary.changePercent, -10)
  assert.ok(Math.abs(summary.ytdPercent + 1) < 1e-10)
  assert.equal(summary.baseDate, '2025-12-31')
  assert.equal(summary.year, '2026')
  assert.equal(summary.date, '2026-01-06')
  const firstSession = marketSummary(history.slice(0, 2))
  assert.equal(firstSession.previousDate, '2025-12-31')
  assert.equal(firstSession.changePercent, 10)
  assert.ok(Math.abs(firstSession.ytdPercent - 10) < 1e-10)
  assert.equal(summary.dailyReason, '')
  assert.equal(summary.ytdReason, '')
})

test('缺少准确基准时不以年内首条行情或更早交易日代替', () => {
  const summary = marketSummary(rows(['2025-12-30', 100], ['2026-01-05', 110], ['2026-01-07', 121]))
  assert.equal(summary.change, null)
  assert.equal(summary.changePercent, null)
  assert.match(summary.dailyReason, /缺少上一交易日/)
  assert.equal(summary.ytdPercent, null)
  assert.match(summary.ytdReason, /缺少上年末/)
  const partial = marketSummary(rows(['2026-01-05', 110], ['2026-01-06', 121]))
  assert.equal(partial.change, 11)
  assert.equal(partial.ytdPercent, null)
})

test('空数据、平价、坏值和日历边界都有明确处理', () => {
  assert.equal(marketSummary([]).ytdPercent, null)
  const flat = marketSummary(rows(['2025-12-31', 100], ['2026-01-05', 100]))
  assert.equal(flat.change, 0)
  assert.equal(flat.ytdPercent, 0)
  for (const close of [0, -1, NaN, Infinity, '100']) {
    assert.equal(marketSummary(rows(['2026-01-05', close])).change, null)
  }
  assert.match(marketSummary(rows(['2027-01-04', 100])).ytdReason, /待核验/)
  assert.match(marketSummary(rows(['2023-01-03', 100])).ytdReason, /未覆盖上年末/)
  assert.match(marketSummary(rows(['2026-01-03', 100])).dailyReason, /待核验/)
})

test('格式化区分ETF价格精度与指数点位，避免负零', () => {
  assert.equal(signedValue(.004, 3), '+0.004')
  assert.equal(signedValue(12.345, 2), '+12.35')
  assert.equal(signedValue(-.004, 2, '%'), '0.00%')
  assert.equal(signedValue(-1, 2, '%'), '-1.00%')
  assert.equal(signedValue(null), '—')
  assert.equal(signedValue(Infinity), '—')
})
