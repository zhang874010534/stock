export const YIELD_SERIES = {
  dividend: { code: 'H30269', basis: 'total_share_capital', source: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls', filename: 'dividend-h30269.json' },
  treasury: { code: 'CN10Y', basis: 'government_bond_yield_curve_10y', source: 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc', filename: 'china-bond-10y.json' },
}
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export function validateYieldPoint(point, { now = new Date() } = {}) {
  const date = point?.date, day = Date.parse(`${date}T00:00:00Z`)
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  requireValue(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === date && date <= today, '收益率日期无效或晚于当前日期')
  requireValue(typeof point.value === 'number' && Number.isFinite(point.value) && point.value >= 0 && point.value <= 100, '收益率数值无效')
  return { date, value: point.value }
}
export function validateYieldSnapshot(kind, data, options) {
  const metadata = YIELD_SERIES[kind]
  requireValue(metadata && data && ['code', 'basis', 'source'].every(key => data[key] === metadata[key]) && data.unit === 'percent', '收益率来源、身份或单位不匹配')
  return validateYieldPoint(data, options)
}
export function emptyYieldHistory() {
  return { schemaVersion: 1, unit: 'percent', collection: 'saved_source_observations', series: Object.fromEntries(Object.entries(YIELD_SERIES).map(([kind, { filename, ...metadata }]) => [kind, { ...metadata, history: [] }])) }
}
export function validateYieldHistory(data, options) {
  requireValue(data?.schemaVersion === 1 && data.unit === 'percent' && data.collection === 'saved_source_observations' && data.series && Object.keys(data.series).length === 2, '收益率历史格式异常')
  for (const [kind, metadata] of Object.entries(YIELD_SERIES)) {
    const series = data.series[kind]
    requireValue(series && ['code', 'basis', 'source'].every(key => series[key] === metadata[key]) && Array.isArray(series.history), '收益率历史来源不匹配')
    let last = ''
    for (const point of series.history) {
      validateYieldPoint(point, options)
      requireValue(point.date > last, '收益率历史日期重复或未排序')
      last = point.date
    }
  }
  return data
}
export function mergeYieldHistory(previous, snapshots = {}, options) {
  const valid = validateYieldHistory(previous ?? emptyYieldHistory(), options)
  // Copy validated fields explicitly; dashboard inputs may be Vue proxies.
  const data = emptyYieldHistory()
  for (const kind of Object.keys(YIELD_SERIES)) data.series[kind].history = valid.series[kind].history.map(point => ({ date: point.date, value: point.value }))
  for (const [kind, snapshot] of Object.entries(snapshots)) {
    const point = validateYieldSnapshot(kind, snapshot, options)
    const rows = new Map(data.series[kind].history.map(row => [row.date, row]))
    rows.set(point.date, point)
    data.series[kind].history = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
  }
  return data
}
const clean = value => Math.abs(value) < 1e-12 ? 0 : value
export function analyzeYieldSpread(data, { start = '', end = '', ...options } = {}) {
  validateYieldHistory(data, options)
  const dividend = new Map(data.series.dividend.history.map(row => [row.date, row.value]))
  const treasury = new Map(data.series.treasury.history.map(row => [row.date, row.value]))
  const dates = [...new Set([...dividend.keys(), ...treasury.keys()])].sort().filter(date => (!start || date >= start) && (!end || date <= end))
  const points = dates.map(date => {
    const d = dividend.get(date) ?? null, t = treasury.get(date) ?? null
    return { date, dividend: d, treasury: t, spread: d === null || t === null ? null : clean(d - t) }
  })
  const paired = points.filter(point => point.spread !== null)
  const latest = paired.at(-1) ?? null, previous = paired.at(-2) ?? null
  const mean = paired.length ? paired.reduce((sum, point) => sum + point.spread / paired.length, 0) : null
  const min = paired.reduce((best, point) => !best || point.spread < best.spread ? point : best, null)
  const max = paired.reduce((best, point) => !best || point.spread > best.spread ? point : best, null)
  return { points, paired, count: paired.length, unpairedCount: points.length - paired.length, latest, previous, change: previous ? clean(latest.spread - previous.spread) : null, mean, min, max,
    latestDividend: data.series.dividend.history.at(-1) ?? null, latestTreasury: data.series.treasury.history.at(-1) ?? null }
}
export function formatSpread(value, { signed = false, digits = 4 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  return `${signed && rounded > 0 ? '+' : ''}${(Object.is(rounded, -0) ? 0 : rounded).toFixed(digits)} 个百分点`
}
