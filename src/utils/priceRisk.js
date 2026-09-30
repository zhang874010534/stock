// Shared daily-price statistics. Never treat a return across a missing session
// as a one-day observation, and never shorten a rolling window to fill blanks.
export const ANNUAL_SESSIONS = 252
export const DAY = 86_400_000
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export function dateTimestamp(day) {
  const time = Date.parse(`${day}T00:00:00Z`)
  requireValue(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day, '分析日期无效')
  return time
}
export const shiftDay = (day, count) => new Date(dateTimestamp(day) + count * DAY).toISOString().slice(0, 10)
export function isSession(day, calendar) {
  requireValue(day >= calendar.start && day <= calendar.end, '交易日历未覆盖分析日期')
  const weekday = new Date(dateTimestamp(day)).getUTCDay()
  return weekday !== 0 && weekday !== 6 && !calendar.closures.some(([start, end]) => day >= start && day <= end)
}
export function tradingDate(day, direction, calendar) {
  requireValue(direction === 1 || direction === -1, '交易日调整方向无效')
  while (!isSession(day, calendar)) day = shiftDay(day, direction)
  return day
}
export function tradingSessions(start, end, calendar) {
  const days = []
  for (let day = start; day <= end; day = shiftDay(day, 1)) if (isSession(day, calendar)) days.push(day)
  return days
}
export function anniversary(day, years) {
  const year = Number(day.slice(0, 4)) - years
  const candidate = `${year}${day.slice(4)}`
  return new Date(Date.parse(`${candidate}T00:00:00Z`)).toISOString().slice(0, 10) === candidate ? candidate : `${year}-02-28`
}
export function validatedWindow(history, start, end, calendar, label) {
  const expected = tradingSessions(start, end, calendar), expectedSet = new Set(expected)
  const rows = history.filter(row => row.date >= start && row.date <= end)
  const dates = new Set(rows.map(row => row.date)), missing = expected.filter(day => !dates.has(day))
  requireValue(!missing.length, `${label} 缺少 ${missing.length} 个交易日：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}`)
  requireValue(rows.every(row => expectedSet.has(row.date)), `${label} 区间内含非交易日行情`)
  return { rows, expected }
}
export function annualizedVolatility(returns) {
  if (returns.length < 2) return null
  requireValue(returns.every(Number.isFinite), '日收益无效')
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
  const value = Math.sqrt(variance * ANNUAL_SESSIONS)
  requireValue(Number.isFinite(value), '波动率计算结果非有限数值')
  return value < 1e-12 ? 0 : value
}
// Target semideviation, sample convention: all N returns form the denominator
// N-1. Positive returns contribute zero; the daily target is fixed at zero.
export function annualizedDownsideDeviation(returns) {
  if (returns.length < 2) return null
  requireValue(returns.every(Number.isFinite), '日收益无效')
  const value = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / (returns.length - 1) * ANNUAL_SESSIONS)
  requireValue(Number.isFinite(value), '下行波动率计算结果非有限数值')
  return value < 1e-12 ? 0 : value
}
export function rollingVolatility(market, start, end, calendar, period = 60, statistic = annualizedVolatility) {
  requireValue(Number.isInteger(period) && period >= 2, '滚动窗口无效')
  let warmupStart = start, remaining = period
  while (remaining && warmupStart > calendar.start) {
    warmupStart = shiftDay(warmupStart, -1)
    if (isSession(warmupStart, calendar)) remaining--
  }
  const prices = new Map(market.history.map(row => [row.date, row.close]))
  const result = new Map(), returns = []
  let previous
  for (const day of tradingSessions(warmupStart, end, calendar)) {
    const close = prices.get(day)
    if (close !== undefined && previous !== undefined) returns.push(close / previous - 1)
    else returns.length = 0
    if (returns.length > period) returns.shift()
    result.set(day, returns.length === period ? statistic(returns) : null)
    previous = close
  }
  return result
}
export function riskPercent(value, signed = false) {
  if (!Number.isFinite(value)) return '—'
  const percentage = Math.abs(value * 100) < .005 ? 0 : value * 100
  return `${signed && percentage > 0 ? '+' : ''}${percentage.toFixed(2)}%`
}
