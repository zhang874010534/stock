import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateMA, calculateKDJ } from '../src/utils/indicators.js'
import { aggregateKlines } from '../src/utils/kline.js'
import { buildSubIndicator } from '../src/charts/kline/subIndicators.js'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('MA 使用完整 N 根收盘价，前 N-1 根为空，未提前四舍五入', () => {
  const history = [1, 2, 4, 8, 16].map((close) => ({ close }))
  const result = calculateMA(history, 3)
  assert.deepEqual(result.slice(0, 2), [null, null])
  near(result[2], 7 / 3)
  near(result[3], 14 / 3)
  near(result[4], 28 / 3)
  assert.deepEqual(calculateMA(history, 1), [1, 2, 4, 8, 16])
  assert.deepEqual(calculateMA(history, 60), Array(5).fill(null))
  assert.deepEqual(calculateMA([], 5), [])
  for (const period of [0, -1, 1.5, NaN]) assert.throws(() => calculateMA(history, period), RangeError)
})

test('MA 随周期重新计算，不把日均线结果聚合为周均线', () => {
  const history = [
    { date: '2026-08-03', open: 10, close: 10, high: 20, low: 5 },
    { date: '2026-08-04', open: 10, close: 20, high: 20, low: 5 },
    { date: '2026-08-10', open: 20, close: 30, high: 30, low: 5 },
    { date: '2026-08-11', open: 30, close: 40, high: 40, low: 5 },
  ]
  assert.deepEqual(calculateMA(aggregateKlines(history, 'week'), 2), [null, 30])
  assert.equal(calculateMA(history, 2).at(-1), 35)
})

test('KDJ(9,3,3) 从50开始递推，保留完整浮点精度', () => {
  const result = calculateKDJ([{ high: 100, low: 0, close: 75 }])
  near(result.K[0], 175 / 3)
  near(result.D[0], 475 / 9)
  near(result.J[0], 625 / 9)
  assert.deepEqual(calculateKDJ([]), { K: [], D: [], J: [] })
})

test('KDJ 平滑参数独立且 J 不截断到 0–100', () => {
  const history = [100, 100, 0].map((close) => ({ high: 100, low: 0, close }))
  const original = structuredClone(history)
  assert.deepEqual(calculateKDJ(history, { kSmoothing: 2, dSmoothing: 2 }), {
    K: [75, 87.5, 43.75], D: [62.5, 75, 59.375], J: [100, 112.5, 12.5],
  })
  assert.deepEqual(history, original)
  for (const key of ['rsvPeriod', 'kSmoothing', 'dSmoothing']) assert.throws(() => calculateKDJ(history, { [key]: 0 }), RangeError)
})

test('RSV 使用最近 N 根高低价，平价窗口避免除零', () => {
  const history = [{ high: 100, low: 0, close: 100 }, { high: 30, low: 10, close: 20 }, { high: 25, low: 15, close: 20 }]
  assert.deepEqual(calculateKDJ(history, { rsvPeriod: 2, kSmoothing: 1, dSmoothing: 1 }).K, [100, 20, 50])
  assert.deepEqual(calculateKDJ(Array(12).fill({ high: 10, low: 10, close: 10 })), {
    K: Array(12).fill(50), D: Array(12).fill(50), J: Array(12).fill(50),
  })
})

test('副图注册项同时提供参数、行情读数和图表序列，配置互不污染', () => {
  const history = [{ high: 100, low: 0, close: 75 }]
  const indicator = buildSubIndicator(history)
  assert.equal(indicator.title, 'KDJ(9,3,3)')
  assert.deepEqual(indicator.lines.map((line) => line.name), ['K', 'D', 'J'])
  assert.ok(indicator.createSeries(2).every((series) => series.xAxisIndex === 2 && series.yAxisIndex === 2))
  assert.equal(buildSubIndicator(history, 'kdj', { rsvPeriod: 5 }).title, 'KDJ(5,3,3)')
  assert.equal(buildSubIndicator(history).title, 'KDJ(9,3,3)')
})
