import { tradingCalendar } from '../data/tradingCalendar.js'

export const SOURCE_KEYS = ['H30269', '512890', '000300', 'valuation', 'dividend', 'bond', 'csiValuation']
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
export function validateSourceStatus(data) {
  if (!data || data.schemaVersion !== 1 || !data.sources || typeof data.sources !== 'object' || Array.isArray(data.sources)) throw new Error('采集状态格式异常')
  for (const [key, entry] of Object.entries(data.sources)) {
    if (!SOURCE_KEYS.includes(key) || !entry || !['ok', 'error'].includes(entry.status) ||
        !(timestamp(entry.lastAttemptAt) || (entry.status === 'error' && entry.lastAttemptAt === null)) || (entry.lastSuccessAt !== null && !timestamp(entry.lastSuccessAt)) ||
        (entry.lastSuccessAt && Date.parse(entry.lastSuccessAt) > Date.parse(entry.lastAttemptAt)) ||
        (entry.lastAttemptAt === null && entry.lastSuccessAt !== null) ||
        (entry.status === 'ok' && (entry.lastSuccessAt !== entry.lastAttemptAt || entry.error !== null)) ||
        (entry.status === 'error' && (typeof entry.error !== 'string' || !entry.error))) throw new Error('采集状态记录异常')
  }
  return data
}

// A conservative freshness hint, independent of whether collection succeeded.
// Use the exchange calendar as an observation reference (also for bond data),
// not as an assertion about every provider's publication calendar.
export function dataFreshness(asOf, { now = new Date(), kind = 'market', calendar = tradingCalendar } = {}) {
  const local = new Date(now.getTime() + 8 * 3600_000)
  if (!Number.isFinite(local.getTime())) return { level: 'unknown', text: '时效待核验' }
  const today = local.toISOString().slice(0, 10)
  if (!asOf || asOf < calendar.start || today > calendar.end || today < calendar.start) return { level: 'unknown', text: '时效待核验（日期或交易日历未覆盖）' }
  const parsed = Date.parse(`${asOf}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== asOf || asOf > today) return { level: 'unknown', text: '时效待核验（数据日期异常）' }
  const cutoff = kind === 'market' ? 17 * 60 + 30 : 19 * 60 + 15
  let lag = 0
  for (let time = parsed + 86400_000; time <= Date.parse(`${today}T00:00:00Z`); time += 86400_000) {
    const date = new Date(time), day = date.toISOString().slice(0, 10)
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6 || calendar.closures.some(([start, end]) => day >= start && day <= end)) continue
    if (day === today && local.getUTCHours() * 60 + local.getUTCMinutes() < cutoff) continue
    lag++
  }
  return lag >= 2
    ? { level: 'old', lag, text: `数据较旧 · 按交易日历参考落后 ${lag} 个交易日` }
    : { level: 'current', lag, text: lag ? '日期存在发布间隔，尚未达到较旧提示阈值' : '' }
}

export function collectionNotice(entry, { unavailable = false, hasData = true } = {}) {
  if (entry?.status === 'error') return { warning: true, text: `后台更新失败${hasData ? '，显示已保存数据' : '，暂无可用数据'}${unavailable ? '；当前状态未能重新核验' : ''}` }
  if (unavailable || !entry) return { warning: false, text: '后台采集状态未知，文件读取成功不代表采集成功' }
  return { warning: false, text: '最近一次后台采集成功' }
}
