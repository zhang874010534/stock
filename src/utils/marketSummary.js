import { tradingCalendar } from '../data/tradingCalendar.js'
import { isTradingDay } from './latestMetrics.js'

function previousSession(date, calendar) {
  let time = Date.parse(`${date}T00:00:00Z`)
  for (;;) {
    time -= 86_400_000
    const day = new Date(time).toISOString().slice(0, 10)
    if (isTradingDay(day, calendar)) return day
  }
}

export function marketSummary(history, calendar = tradingCalendar) {
  const latest = history.at(-1)
  const result = { date: latest?.date, year: latest?.date?.slice(0, 4), change: null, changePercent: null,
    ytdPercent: null, previousDate: null, baseDate: null, dailyReason: '暂无行情', ytdReason: '暂无行情' }
  if (!latest) return result
  if (!Number.isFinite(latest.close) || latest.close <= 0) return { ...result, dailyReason: '收盘价无效', ytdReason: '收盘价无效' }
  try {
    if (!isTradingDay(latest.date, calendar)) throw new Error('非交易日')
  } catch { return { ...result, dailyReason: '行情日期或交易日历待核验', ytdReason: '行情日期或交易日历待核验' } }
  const rows = new Map(history.map(row => [row.date, row]))
  const valid = row => row && Number.isFinite(row.close) && row.close > 0
  try {
    result.previousDate = previousSession(latest.date, calendar)
    const previous = rows.get(result.previousDate)
    result.dailyReason = valid(previous) ? '' : '缺少上一交易日收盘价'
    if (valid(previous)) {
      result.change = latest.close - previous.close
      result.changePercent = result.change / previous.close * 100
    }
  } catch { result.dailyReason = '交易日历未覆盖上一交易日' }
  try {
    result.baseDate = previousSession(`${result.year}-01-01`, calendar)
    const base = rows.get(result.baseDate)
    result.ytdReason = valid(base) ? '' : '缺少上年末最后交易日收盘价'
    if (valid(base)) result.ytdPercent = (latest.close / base.close - 1) * 100
  } catch { result.ytdReason = '交易日历未覆盖上年末' }
  return result
}

export function signedValue(value, digits = 2, suffix = '') {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}${suffix}`
}
