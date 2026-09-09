import test from 'node:test'
import assert from 'node:assert/strict'
import { getKlineRangeStats } from '../src/utils/klineRange.js'
import { aggregateKlines } from '../src/utils/kline.js'

const history = [
  { date: '2026-04-01', open: 9, close: 10, high: 11, low: 8, volume: 100, amount: 1000, turnover: 1 },
  { date: '2026-04-02', open: 10, close: 8, high: 12, low: 7, volume: 200, amount: 1600, turnover: 2 },
  { date: '2026-04-06', open: 9, close: 9, high: 10, low: 8, volume: 300, amount: 2700, turnover: 3 },
]
test('区间首尾均包含；反向框选结果一致，涨跌以起始收盘价为基准', () => {
  const s = getKlineRangeStats(history, 0, 2)
  assert.deepEqual(s, getKlineRangeStats(history, 2, 0))
  assert.equal(s.count, 3)
  assert.equal(s.change, -1)
  assert.ok(Math.abs(s.changePercent + 10) < 1e-10)
  assert.equal(s.amplitude, 50)
  assert.equal(s.average, 9)
  assert.equal(s.volume, 600)
  assert.equal(s.amount, 5300)
  assert.equal(s.turnover, 6)
  assert.deepEqual([s.bullish, s.bearish, s.flat], [1, 1, 1])
})
test('单根、越界、空数据及缺失字段不伪造统计', () => {
  assert.equal(getKlineRangeStats(history, 1, 1).change, 0)
  assert.equal(getKlineRangeStats(history, -100, 100).count, 3)
  assert.equal(getKlineRangeStats([], 0, 1), null)
  assert.equal(getKlineRangeStats(history, null, 1), null)
  const missing = history.map((p, i) => i === 1 ? { ...p, turnover: undefined, amount: undefined } : p)
  assert.equal(getKlineRangeStats(missing, 0, 2).turnover, null)
  assert.equal(getKlineRangeStats(missing, 0, 2).amount, null)
})
test('周线统计使用聚合后的周期数量和真实起始日期', () => {
  const s = getKlineRangeStats(aggregateKlines(history, 'week'), 0, 1)
  assert.equal(s.count, 2)
  assert.equal(s.startDate, '2026-04-01')
  assert.equal(s.endDate, '2026-04-06')
  assert.equal(s.startPrice, 8)
  assert.equal(s.volume, 600)
})
