import { getRangeWindow } from './indexHistory.js'

export const KLINE_PERIODS = [
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
]

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function isValidKline(point) {
  if (!point || !isValidDate(point.date)) return false
  for (const key of ['open', 'close', 'high', 'low']) {
    if (!Number.isFinite(point[key]) || point[key] <= 0) return false
  }
  if (point.high < point.open || point.high < point.close) return false
  if (point.low > point.open || point.low > point.close || point.high < point.low) return false
  for (const key of ['volume', 'amount']) {
    if (key in point && (!Number.isFinite(point[key]) || point[key] < 0)) return false
  }
  return true
}

export function validateKlineData(history) {
  if (!Array.isArray(history) || !history.length) throw new Error('行情历史数据为空')
  let previousDate = ''
  for (const point of history) {
    if (!isValidKline(point)) throw new Error(`行情 OHLC 数据异常：${point?.date ?? '未知日期'}`)
    if (point.date <= previousDate) throw new Error('行情历史必须按日期升序且不能重复')
    previousDate = point.date
  }
  return history
}

export function validateMarketData(data) {
  if (!data || data.code !== 'H30269' || data.interval !== '1d') throw new Error('H30269 行情文件格式异常')
  validateKlineData(data.history)
  const latest = data.history.at(-1)
  const latestMatches = ['date', 'open', 'close', 'high', 'low', 'volume', 'amount'].every((key) => data.latest?.[key] === latest[key])
  if (!latestMatches || !isValidKline(data.latest)) {
    throw new Error('H30269 最新行情与历史数据不一致')
  }
  if (typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('H30269 更新时间异常')
  if (!data.backfill || typeof data.backfill.completed !== 'boolean') throw new Error('H30269 历史回补状态异常')
  return data
}

export function filterKlinesByRange(history, rangeKey) {
  if (!Array.isArray(history) || !history.length) return []
  const window = getRangeWindow(history, rangeKey)
  return history.slice(window.startIndex, window.endIndex + 1)
}

function mondayOf(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  return date.toISOString().slice(0, 10)
}

function aggregateBy(history, groupKey) {
  if (!Array.isArray(history) || !history.length) return []
  const groups = []
  for (const point of history) {
    const key = groupKey(point.date)
    const current = groups.at(-1)
    if (!current || current.key !== key) groups.push({ key, points: [point] })
    else current.points.push(point)
  }
  return groups.map(({ points }) => {
    const first = points[0]
    const last = points.at(-1)
    const aggregate = {
      date: last.date,
      startDate: first.date,
      endDate: last.date,
      open: first.open,
      close: last.close,
      high: Math.max(...points.map((point) => point.high)),
      low: Math.min(...points.map((point) => point.low)),
    }
    for (const key of ['volume', 'amount']) {
      if (points.every((point) => Number.isFinite(point[key]) && point[key] >= 0)) {
        aggregate[key] = points.reduce((total, point) => total + point[key], 0)
      }
    }
    return aggregate
  })
}

export function aggregateWeeklyKlines(history) {
  return aggregateBy(history, mondayOf)
}

export function aggregateMonthlyKlines(history) {
  return aggregateBy(history, (date) => date.slice(0, 7))
}

export function aggregateKlines(history, period) {
  if (period === 'week') return aggregateWeeklyKlines(history)
  if (period === 'month') return aggregateMonthlyKlines(history)
  return history.map((point) => ({ ...point }))
}

export function toCandlestickData(history) {
  return history.map(({ open, close, low, high }) => [open, close, low, high])
}

function formatLargeNumber(value) {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function formatVolume(value) {
  return formatLargeNumber(value)
}

export function formatAmount(value) {
  return formatLargeNumber(value)
}
