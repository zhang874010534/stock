import { chinaDate } from './etfDistributions.js'
import { dateTimestamp } from './priceRisk.js'

export const WEIGHTS_SOURCE = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/H30269closeweight.xls'
export const HOLDINGS_DISCOVERY = 'https://www.sse.com.cn/disclosure/fund/announcement/'
const requireValue = (value, message = '权重或披露持仓格式异常') => { if (!value) throw new Error(message) }
const key = row => `${row.exchange}:${row.code}`
const sum = (rows, getter) => rows.reduce((total, row) => total + getter(row), 0)
function day(value, now) { dateTimestamp(value); requireValue(value <= chinaDate(now)) }
function status(data, now) {
  requireValue(data?.schemaVersion === 1 && ['ok', 'stale', 'unavailable'].includes(data.status) && Array.isArray(data.members))
  requireValue(data.status === 'ok' ? data.reason === null : typeof data.reason === 'string' && data.reason.trim())
  const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19) && Date.parse(value) <= now.getTime()
  requireValue(validTime(data.lastAttemptAt))
  if (data.status === 'unavailable') requireValue(!data.members.length && data.date === null && data.lastSuccessAt === null)
  else {
    requireValue(validTime(data.lastSuccessAt) && Date.parse(data.lastSuccessAt) <= Date.parse(data.lastAttemptAt))
    day(data.date, now); requireValue(data.date <= chinaDate(new Date(data.lastSuccessAt)))
  }
}
function members(rows) {
  const seen = new Set()
  for (const row of rows) {
    requireValue(/^\d{6}$/.test(row?.code) && ['SSE', 'SZSE'].includes(row.exchange) && typeof row.name === 'string' && row.name.trim() && !seen.has(key(row)))
    requireValue(row.exchange === (row.code.startsWith('6') ? 'SSE' : /^[03]/.test(row.code) ? 'SZSE' : null))
    seen.add(key(row))
  }
}
export function validateConstituentWeights(data, { now = new Date() } = {}) {
  status(data, now)
  requireValue(data.code === 'H30269' && data.source === WEIGHTS_SOURCE && data.unit === 'fraction' && data.scope === 'full_index')
  if (data.status !== 'unavailable') {
    members(data.members)
    requireValue(data.members.length === 50 && data.members.every(row => Number.isFinite(row.weight) && row.weight > 0 && row.weight <= 1))
    // The official XLS publishes percentages rounded to three decimals.
    requireValue(Math.abs(sum(data.members, row => row.weight) - 1) <= .000251)
  }
  return data
}
export function validateEtfHoldings(data, { now = new Date() } = {}) {
  status(data, now)
  requireValue(data.code === '512890' && data.discoverySource === HOLDINGS_DISCOVERY && data.unit === 'CNY' && data.scope === 'full_equity')
  if (data.status === 'unavailable') {
    requireValue(data.source === null && data.publishedDate === null && data.netAssets === null && data.equityValue === null)
    return data
  }
  day(data.publishedDate, now)
  requireValue(data.publishedDate >= data.date && data.publishedDate <= chinaDate(new Date(data.lastSuccessAt)))
  requireValue(typeof data.source === 'string' && new RegExp(`^https://www\\.sse\\.com\\.cn/disclosure/fund/announcement/c/new/${data.publishedDate}/512890_${data.publishedDate.replaceAll('-', '')}_[A-Z0-9]+\\.pdf$`).test(data.source))
  requireValue(Number.isFinite(data.netAssets) && data.netAssets > 0 && data.netAssets <= 1e14 && Number.isFinite(data.equityValue) && data.equityValue > 0 && data.equityValue <= data.netAssets * 1.1)
  requireValue(data.members.length > 0 && data.members.length <= 1000)
  members(data.members)
  requireValue(data.members.every(row => ['index', 'active'].includes(row.kind) && Number.isSafeInteger(row.shares) && row.shares > 0 && Number.isFinite(row.marketValue) && row.marketValue > 0 && Number.isFinite(row.reportedWeight) && row.reportedWeight >= 0 && Math.abs(row.reportedWeight - row.marketValue / data.netAssets) <= .00005001))
  requireValue(Math.abs(sum(data.members, row => row.marketValue) - data.equityValue) <= .02, 'ETF 全部持仓与报告股票资产合计不一致')
  return data
}
export function weightedMembers(data) {
  return data?.status === 'unavailable' || !data ? [] : data.members.map(row => ({ ...row, weight: data.code === '512890' ? row.marketValue / data.netAssets : row.weight })).sort((a, b) => b.weight - a.weight || key(a).localeCompare(key(b)))
}
export function weightSummary(data) {
  const rows = weightedMembers(data)
  return { rows, total: sum(rows, row => row.weight), topTen: rows.length ? sum(rows.slice(0, 10), row => row.weight) : null, topTenRows: rows.slice(0, 10) }
}
export function weightedIndustries(data, classification) {
  const lookup = new Map((classification?.members ?? []).map(row => [key(row), row]))
  const groups = new Map()
  let staleWeight = 0
  for (const row of weightedMembers(data)) {
    const reference = lookup.get(key(row)), industry = reference?.industry ?? null
    if (reference?.industryStatus === 'stale') staleWeight += row.weight
    if (!groups.has(industry)) groups.set(industry, { industry, label: industry ?? '未分类', weight: 0, count: 0 })
    const group = groups.get(industry); group.weight += row.weight; group.count++
  }
  const values = [...groups.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'zh-CN'))
  return { groups: values, unknownWeight: groups.get(null)?.weight ?? 0, staleWeight, classifiedWeight: sum(values.filter(row => row.industry !== null), row => row.weight) }
}
export function compareWeights(index, etf) {
  if (!index || !etf || index.status === 'unavailable' || etf.status === 'unavailable') return null
  const before = new Map(weightedMembers(index).map(row => [key(row), row])), after = new Map(weightedMembers(etf).map(row => [key(row), row]))
  const rows = [...new Set([...before.keys(), ...after.keys()])].map(id => {
    const a = before.get(id), b = after.get(id)
    return { ...(b ?? a), indexWeight: a?.weight ?? 0, etfWeight: b?.weight ?? 0, difference: (b?.weight ?? 0) - (a?.weight ?? 0), presence: a && b ? 'both' : a ? 'index' : 'etf' }
  }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.code.localeCompare(b.code))
  return { rows, sameDate: index.date === etf.date, matched: rows.filter(row => row.presence === 'both').length, indexOnly: rows.filter(row => row.presence === 'index').length, etfOnly: rows.filter(row => row.presence === 'etf').length }
}
