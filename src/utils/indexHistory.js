export const INDEX_RANGES = [
  { key: '1m', label: '近1月', months: 1 },
  { key: '3m', label: '近3月', months: 3 },
  { key: '6m', label: '近6月', months: 6 },
  { key: '1y', label: '近1年', months: 12 },
  { key: '3y', label: '近3年', months: 36 },
  { key: '5y', label: '近5年', months: 60 },
  { key: 'all', label: '全部', months: null },
]

const numberFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatIndexValue(value, decimals = 2) {
  if (!Number.isFinite(value)) return '—'
  return decimals === 2 ? numberFormatter.format(value) : value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// 图表数据约定：[{ date: 'YYYY-MM-DD', close: 9852.36 }]。
// 清理无效值、按日期排序；重复日期保留最后一条。
export function normalizeHistory(history) {
  const byDate = new Map()
  for (const point of Array.isArray(history) ? history : []) {
    if (!point || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)) continue
    const timestamp = Date.parse(`${point.date}T00:00:00Z`)
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== point.date) continue
    if (!Number.isFinite(point.close) || point.close <= 0) continue
    byDate.set(point.date, { date: point.date, close: point.close })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// 以数据的最新日期为锚点，按日历月回退；月末夹到目标月份的最后一天。
export function getRangeWindow(history, rangeKey) {
  if (!history.length) return { startIndex: 0, endIndex: 0 }
  const endIndex = history.length - 1
  const range = INDEX_RANGES.find((item) => item.key === rangeKey) ?? INDEX_RANGES[3]
  if (range.months === null) return { startIndex: 0, endIndex }

  const end = new Date(`${history[endIndex].date}T00:00:00Z`)
  const target = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - range.months, 1))
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(end.getUTCDate(), daysInMonth))
  const cutoff = target.toISOString().slice(0, 10)
  const first = history.findIndex((point) => point.date >= cutoff)
  return { startIndex: first < 0 ? endIndex : first, endIndex }
}

export function getZoomWindow(length, start = 0, end = 100) {
  const last = Math.max(0, length - 1)
  const clamp = (value, fallback) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback
  const firstPercent = clamp(start, 0)
  const lastPercent = clamp(end, 100)
  return {
    startIndex: Math.round(Math.min(firstPercent, lastPercent) / 100 * last),
    endIndex: Math.round(Math.max(firstPercent, lastPercent) / 100 * last),
  }
}

export function getWindowSummary(history, window) {
  const first = history[window.startIndex]
  const last = history[window.endIndex]
  if (!first || !last) return null
  return {
    startDate: first.date,
    endDate: last.date,
    close: last.close,
    changePercent: (last.close / first.close - 1) * 100,
  }
}
