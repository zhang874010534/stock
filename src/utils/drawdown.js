const DAY = 86_400_000

function timestamp(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('回撤行情日期无效')
  const value = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('回撤行情日期无效')
  return value
}

// Only observed daily closes count. Do not fill missing sessions or infer a
// recovery between samples. An equal high ends a drawdown and anchors the next.
export function calculateDrawdown(history) {
  if (!Array.isArray(history)) throw new Error('回撤行情格式异常')
  let previous = ''
  for (const row of history) {
    timestamp(row?.date)
    if (row.date <= previous) throw new Error('回撤行情日期必须递增且不重复')
    if (!Number.isFinite(row.close) || row.close <= 0) throw new Error('回撤收盘价必须为正数')
    previous = row.date
  }
  const result = { count: history.length, startDate: history[0]?.date ?? null, endDate: history.at(-1)?.date ?? null,
    points: [], current: null, maximum: null }
  if (history.length < 2) return result
  let peak = history[0]
  for (const row of history) {
    if (row.close >= peak.close) {
      if (result.maximum && !result.maximum.recoveryDate) result.maximum.recoveryDate = row.date
      peak = row
    }
    const value = row.close / peak.close - 1
    result.points.push({ date: row.date, close: row.close, value, peakDate: peak.date, peakClose: peak.close })
    // Equal depths keep the first maximum event; a deeper trough replaces it.
    if (value < (result.maximum?.value ?? 0)) result.maximum = {
      value, peakDate: peak.date, peakClose: peak.close,
      troughDate: row.date, troughClose: row.close, recoveryDate: null,
    }
  }
  result.current = { ...result.points.at(-1), days: (timestamp(result.endDate) - timestamp(peak.date)) / DAY }
  if (result.maximum) result.maximum.days =
    (timestamp(result.maximum.recoveryDate ?? result.endDate) - timestamp(result.maximum.peakDate)) / DAY
  return result
}

export function formatDrawdown(value) {
  if (!Number.isFinite(value)) return '—'
  const percentage = value * 100
  return `${(Math.abs(percentage) < .005 ? 0 : percentage).toFixed(2)}%`
}
