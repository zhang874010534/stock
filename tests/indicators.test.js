import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateBOLL, calculateKDJ, calculateMA, calculateMACD, calculateRSI } from '../src/utils/indicators.js'
import { aggregateKlines } from '../src/utils/kline.js'
import { buildMainIndicator } from '../src/charts/kline/mainIndicators.js'
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

test('MACD 使用 EMA 快慢线和 2 倍柱值，参数校验避免快线不小于慢线', () => {
  const history = [10, 11].map((close) => ({ close }))
  const result = calculateMACD(history)
  near(result.DIF[0], 0)
  near(result.DEA[0], 0)
  near(result.MACD[0], 0)
  near(result.DIF[1], 2 / 13 - 2 / 27)
  near(result.DEA[1], result.DIF[1] * 2 / 10)
  near(result.MACD[1], 2 * (result.DIF[1] - result.DEA[1]))
  assert.deepEqual(calculateMACD([]), { DIF: [], DEA: [], MACD: [] })
  assert.throws(() => calculateMACD(history, { fastPeriod: 26, slowPeriod: 12 }), /快线周期/)
})

test('RSI 使用 Wilder 平滑，完整周期前为空，单边上涨为100、横盘为50', () => {
  const rising = Array.from({ length: 10 }, (_, index) => ({ close: index + 1 }))
  const result = calculateRSI(rising, { shortPeriod: 2, mediumPeriod: 3, longPeriod: 4 })
  assert.deepEqual(result.RSI1.slice(0, 2), [null, null])
  assert.ok(result.RSI1.slice(2).every((value) => value === 100))
  assert.ok(result.RSI2.slice(3).every((value) => value === 100))
  assert.ok(result.RSI3.slice(4).every((value) => value === 100))

  const flat = Array(8).fill(null).map(() => ({ close: 10 }))
  assert.equal(calculateRSI(flat, { shortPeriod: 2, mediumPeriod: 3, longPeriod: 4 }).RSI1.at(-1), 50)
  assert.throws(() => calculateRSI(rising, { shortPeriod: 6, mediumPeriod: 5, longPeriod: 24 }), /N1|短周期|周期/)
})

test('BOLL 使用简单均线与总体标准差，不足周期时保持空值', () => {
  const history = [1, 2, 3, 4].map((close) => ({ close }))
  const result = calculateBOLL(history, { period: 3, multiplier: 2 })
  assert.deepEqual(result.BOLL.slice(0, 2), [null, null])
  near(result.BOLL[2], 2)
  near(result.UPPER[2], 2 + 2 * Math.sqrt(2 / 3))
  near(result.LOWER[2], 2 - 2 * Math.sqrt(2 / 3))
  near(result.BOLL[3], 3)
  assert.throws(() => calculateBOLL(history, { period: 0 }), RangeError)
  assert.throws(() => calculateBOLL(history, { multiplier: 0 }), RangeError)
})

test('副图注册 KDJ/MACD/RSI，参数和 series 工厂互不污染', () => {
  const history = Array.from({ length: 40 }, (_, index) => ({ high: 100 + index, low: 90 + index, close: 95 + index }))
  const kdj = buildSubIndicator(history)
  assert.equal(kdj.title, 'KDJ(9,3,3)')
  assert.deepEqual(kdj.lines.map((line) => line.name), ['K', 'D', 'J'])
  assert.ok(kdj.createSeries(2).every((series) => series.xAxisIndex === 2 && series.yAxisIndex === 2))
  assert.equal(buildSubIndicator(history, 'kdj', { rsvPeriod: 5 }).title, 'KDJ(5,3,3)')
  assert.equal(buildSubIndicator(history).title, 'KDJ(9,3,3)')

  const macd = buildSubIndicator(history, 'macd')
  assert.equal(macd.title, 'MACD(12,26,9)')
  assert.deepEqual(macd.createSeries(2).map((series) => series.type), ['line', 'line', 'bar'])

  const rsi = buildSubIndicator(history, 'rsi', { shortPeriod: 5, mediumPeriod: 10, longPeriod: 20 })
  assert.equal(rsi.title, 'RSI(5,10,20)')
  assert.deepEqual(rsi.lines.map((line) => line.name), ['RSI5', 'RSI10', 'RSI20'])
  assert.deepEqual(rsi.axis, { min: 0, max: 100, splitNumber: 4 })
})

test('BOLL 主图注册项提供标题、三条读数和主图坐标系 series', () => {
  const history = Array.from({ length: 25 }, (_, index) => ({ close: 100 + index }))
  const boll = buildMainIndicator(history, 'boll', { period: 10, multiplier: 2.5 })
  assert.equal(boll.title, 'BOLL(10,2.5)')
  assert.deepEqual(boll.lines.map((line) => line.name), ['BOLL', 'UPPER', 'LOWER'])
  assert.ok(boll.createSeries(0).every((series) => series.xAxisIndex === 0 && series.yAxisIndex === 0))
  assert.equal(buildMainIndicator(history).title, 'BOLL(20,2)')
})
