import test from 'node:test'
import assert from 'node:assert/strict'
import { getH30269 } from '../src/api/h30269.js'
import { INDEX_RANGES } from '../src/utils/indexHistory.js'
import {
  aggregateKlines,
  aggregateMonthlyKlines,
  aggregateWeeklyKlines,
  filterKlinesByRange,
  formatAmount,
  toCandlestickData,
  validateKlineData,
  validateMarketData,
} from '../src/utils/kline.js'

const point = (date, open, close, high, low, volume = 10, amount = 100) => ({ date, open, close, high, low, volume, amount })

function marketData(history) {
  return {
    code: 'H30269',
    name: '中证红利低波动指数',
    source: 'eastmoney',
    interval: '1d',
    updatedAt: '2026-09-04T08:30:00Z',
    backfill: { earliestDate: history[0].date, completed: false, nextEndDate: '2020-01-01', consecutiveEmptyRanges: 0 },
    latest: history.at(-1),
    history,
  }
}

test('JSON OHLC 校验拒绝错误价格关系和空 history', () => {
  const valid = [point('2026-09-04', 99, 100, 102, 98)]
  assert.equal(validateKlineData(valid), valid)
  assert.equal(validateMarketData(marketData(valid)).code, 'H30269')
  assert.throws(() => validateKlineData([]), /为空/)
  assert.throws(() => validateKlineData([point('2026-09-04', 100, 99, 99, 98)]), /OHLC/)
  assert.throws(() => validateKlineData([point('2026-09-04', 99, 100, 101, 101)]), /OHLC/)
})

test('所有时间范围都在本地过滤，历史不足时返回已有数据', () => {
  const history = [
    point('2026-01-02', 90, 91, 92, 89),
    point('2026-08-03', 98, 99, 100, 97),
    point('2026-09-04', 99, 100, 101, 98),
  ]
  for (const { key } of INDEX_RANGES) {
    const filtered = filterKlinesByRange(history, key)
    assert.ok(filtered.length > 0, `${key} should return available data`)
    assert.equal(filtered.at(-1).date, '2026-09-04')
  }
  assert.deepEqual(filterKlinesByRange(history, '5y'), history)
  assert.deepEqual(filterKlinesByRange(history, 'all'), history)
})

test('计算链先过滤 range 再聚合，周月边界不混入范围外日 K', () => {
  const history = [
    point('2026-08-03', 10, 11, 12, 9),
    point('2026-08-04', 20, 21, 22, 19),
    point('2026-09-04', 30, 31, 32, 29),
  ]
  const ranged = filterKlinesByRange(history, '1m')
  assert.equal(ranged[0].date, '2026-08-04')
  assert.equal(aggregateKlines(ranged, 'week')[0].open, 20)
  assert.equal(aggregateKlines(ranged, 'month')[0].open, 20)
})

test('周 K 按周一至周日的自然周聚合，覆盖五日、四日、跨月和跨年', () => {
  const normalWeek = [
    point('2026-08-17', 10, 11, 12, 9, 1, 10),
    point('2026-08-18', 11, 12, 13, 10, 2, 20),
    point('2026-08-19', 12, 11, 14, 8, 3, 30),
    point('2026-08-20', 11, 13, 15, 10, 4, 40),
    point('2026-08-21', 13, 14, 16, 12, 5, 50),
  ]
  assert.deepEqual(aggregateWeeklyKlines(normalWeek), [{
    date: '2026-08-21', startDate: '2026-08-17', endDate: '2026-08-21',
    open: 10, close: 14, high: 16, low: 8, volume: 15, amount: 150,
  }])

  const holidayWeek = normalWeek.slice(0, 4)
  assert.equal(aggregateWeeklyKlines(holidayWeek)[0].close, 13)
  assert.equal(aggregateWeeklyKlines(holidayWeek)[0].volume, 10)

  const crossMonth = [
    point('2026-08-31', 20, 21, 22, 19, 6, 60),
    point('2026-09-01', 21, 23, 24, 20, 7, 70),
  ]
  assert.equal(aggregateWeeklyKlines(crossMonth).length, 1)
  assert.equal(aggregateWeeklyKlines(crossMonth)[0].amount, 130)

  const crossYear = [
    point('2024-12-30', 30, 31, 32, 29, 8, 80),
    point('2025-01-03', 31, 33, 34, 30, 9, 90),
  ]
  const yearly = aggregateWeeklyKlines(crossYear)
  assert.equal(yearly.length, 1)
  assert.deepEqual({ open: yearly[0].open, close: yearly[0].close, high: yearly[0].high, low: yearly[0].low, volume: yearly[0].volume, amount: yearly[0].amount }, {
    open: 30, close: 33, high: 34, low: 29, volume: 17, amount: 170,
  })
})

test('月 K 使用当月首尾交易日并正确分隔月份', () => {
  const history = [
    point('2026-01-05', 10, 11, 12, 9, 1, 10),
    point('2026-01-30', 11, 13, 15, 10, 2, 20),
    point('2026-02-02', 20, 21, 22, 19, 3, 30),
    point('2026-02-27', 21, 23, 24, 18, 4, 40),
  ]
  assert.deepEqual(aggregateMonthlyKlines(history), [
    { date: '2026-01-30', startDate: '2026-01-05', endDate: '2026-01-30', open: 10, close: 13, high: 15, low: 9, volume: 3, amount: 30 },
    { date: '2026-02-27', startDate: '2026-02-02', endDate: '2026-02-27', open: 20, close: 23, high: 24, low: 18, volume: 7, amount: 70 },
  ])
})

test('K 线转换顺序为 open、close、low、high，大额数据友好格式化', () => {
  const history = [point('2026-09-04', 99, 100, 102, 98)]
  assert.deepEqual(toCandlestickData(history), [[99, 100, 98, 102]])
  assert.equal(formatAmount(3_610_000_000), '36.10亿')
})

test('首次加载只请求一次静态 JSON，本地切换 range 和 period 不增加请求，刷新才再请求', async () => {
  const history = [
    point('2026-08-31', 98, 99, 100, 97),
    point('2026-09-04', 99, 100, 102, 98),
  ]
  let requests = 0
  const fetcher = async (url, options) => {
    requests++
    assert.equal(url, '/data/h30269.json?t=123')
    assert.equal(options.cache, 'no-store')
    return Response.json(marketData(history))
  }
  const loaded = await getH30269({ fetcher, cacheKey: 123 })
  assert.equal(requests, 1)
  filterKlinesByRange(loaded.history, '1m')
  filterKlinesByRange(loaded.history, '1y')
  aggregateKlines(loaded.history, 'day')
  aggregateKlines(loaded.history, 'week')
  aggregateKlines(loaded.history, 'month')
  assert.equal(requests, 1)
  await getH30269({ fetcher, cacheKey: 123 })
  assert.equal(requests, 2)
})
