const SOURCE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'

// 东方财富的市场编号不能仅凭代码前缀推断；逐个确认后加入。
export const INSTRUMENTS = new Map([
  ['H30269', { code: 'H30269', name: '中证红利低波动指数', secid: '2.H30269', startDate: '2005-12-30' }],
])
export const RANGES = new Map([
  ['1m', 1], ['3m', 3], ['6m', 6], ['1y', 12], ['3y', 36], ['5y', 60], ['all', null],
])

export class MarketDataError extends Error {
  constructor(message, cooldownSeconds = 0, options) {
    super(message, options)
    this.name = 'MarketDataError'
    this.cooldownSeconds = cooldownSeconds
    this.upstreamStatus = options?.upstreamStatus
  }
}

export function dateBounds(instrument, range, now) {
  const end = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  const months = RANGES.get(range)
  if (months === undefined) throw new Error('Unsupported range')
  if (months === null) return { start: instrument.startDate, end }
  const today = new Date(`${end}T00:00:00Z`)
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1))
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
  start.setUTCDate(Math.min(today.getUTCDate(), lastDay))
  // 留出休市缓冲，图表再按最新交易日截取所选区间。
  start.setUTCDate(start.getUTCDate() - 10)
  return { start: [instrument.startDate, start.toISOString().slice(0, 10)].sort().at(-1), end }
}

function retryDelay(value, now) {
  if (!value) return 300
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now.getTime()) / 1000)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 300
}

export async function fetchHistory(instrument, range, { fetcher = fetch, now = new Date(), timeoutMs = 12_000 } = {}) {
  const bounds = dateBounds(instrument, range, now)
  const url = new URL(SOURCE_URL)
  url.search = new URLSearchParams({
    secid: instrument.secid,
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101', fqt: '0',
    beg: bounds.start.replaceAll('-', ''), end: bounds.end.replaceAll('-', ''),
  }).toString()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'stock-dashboard/0.0.0' },
      signal: controller.signal, redirect: 'manual',
    })
    const status = { upstreamStatus: response.status }
    if (response.status === 403) throw new MarketDataError('东方财富暂时拒绝访问，请稍后再试', 900, status)
    if (response.status === 429) throw new MarketDataError('东方财富请求受限，请稍后再试', retryDelay(response.headers.get('Retry-After'), now), status)
    if (!response.ok) throw new MarketDataError('东方财富行情暂时不可用，请稍后再试', 0, status)
    const payload = await response.json()
    const source = payload?.data
    if (payload?.rc !== 0 || source?.code !== instrument.code || String(source?.market) !== instrument.secid.split('.')[0] || !Array.isArray(source?.klines)) {
      throw new MarketDataError('东方财富返回的行情格式异常，请稍后再试')
    }
    const points = new Map()
    for (const line of source.klines) {
      const [date, , closeText] = typeof line === 'string' ? line.split(',') : []
      const close = Number(closeText)
      const time = Date.parse(`${date}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || !Number.isFinite(close) || close <= 0) {
        throw new MarketDataError('东方财富返回的日线数据异常，请稍后再试')
      }
      if (date >= bounds.start && date <= bounds.end) points.set(date, { date, close })
    }
    const history = [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
    if (!history.length) throw new MarketDataError('东方财富暂未返回该区间的日线数据')
    return {
      code: instrument.code, name: instrument.name, status: 'ok', source: '东方财富',
      interval: '1d', range, history, latest: history.at(-1), updatedAt: now.toISOString(),
    }
  } catch (error) {
    if (error instanceof MarketDataError) throw error
    throw new MarketDataError(controller.signal.aborted ? '东方财富行情请求超时，请稍后再试' : '东方财富行情连接失败，请稍后再试', 0, { cause: error })
  } finally {
    clearTimeout(timer)
  }
}
