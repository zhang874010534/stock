export const VALUATION_RANGES = { all: '全部已积累', '1y': '近1年', '3y': '近3年', '5y': '近5年' }
export const MIN_VALUATION_SAMPLES = 20

export function valuationCoverage(stats) {
  const firstDate = stats.points[0]?.date ?? null
  const lastDate = stats.latest?.date ?? null
  return {
    firstDate, lastDate,
    calendarDays: firstDate && lastDate ? Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86400_000) + 1 : 0,
    remaining: Math.max(0, MIN_VALUATION_SAMPLES - stats.count),
    progress: Math.min(MIN_VALUATION_SAMPLES, stats.count),
  }
}

export function quantile(sorted, probability) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * probability
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

export function valuationStats(history, metric = 'pe', range = '1y') {
  if (!['pe', 'pb'].includes(metric) || !Object.hasOwn(VALUATION_RANGES, range)) throw new Error('无效估值选项')
  const end = history.at(-1)?.date
  if (!end) return { points: [], count: 0, latest: null, rank: null, low: null, high: null, partial: false }
  const cutoff = new Date(`${end}T00:00:00Z`)
  if (range !== 'all') {
    const month = cutoff.getUTCMonth()
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(range[0]))
    if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0)
  }
  const start = range === 'all' ? history[0].date : cutoff.toISOString().slice(0, 10)
  const points = history.filter(p => p.date >= start && Number.isFinite(p[metric]) && p[metric] > 0)
    .map(p => ({ date: p.date, value: p[metric] }))
  const values = points.map(p => p.value).sort((a, b) => a - b)
  const latest = points.at(-1) ?? null
  // Small snapshot collections should not imply a meaningful historical distribution.
  const sufficient = values.length >= MIN_VALUATION_SAMPLES
  return {
    points, latest, count: values.length,
    partial: range !== 'all' && history[0].date > start,
    low: sufficient ? quantile(values, .3) : null,
    high: sufficient ? quantile(values, .7) : null,
    rank: sufficient ? values.reduce((n, v) => n + (v < latest.value ? 1 : v === latest.value ? .5 : 0), 0) / values.length * 100 : null,
  }
}
