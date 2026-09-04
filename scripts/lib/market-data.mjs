const EASTMONEY_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'

export const H30269 = {
  code: 'H30269',
  name: '中证红利低波动指数',
  secid: '2.H30269',
}

export class MarketDataError extends Error {
  constructor(message, { kind = 'upstream', upstreamStatus, retryAfterSeconds, cause } = {}) {
    super(message, { cause })
    this.name = 'MarketDataError'
    this.kind = kind
    this.upstreamStatus = upstreamStatus
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function shiftDate(value, days) {
  if (!isValidDate(value) || !Number.isInteger(days)) throw new Error('Invalid date shift')
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function shanghaiDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid current time')
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
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

function requiredNumber(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return NaN
  return Number(value)
}

function optionalNumber(value) {
  const number = requiredNumber(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function parseEastmoneyKline(line) {
  if (typeof line !== 'string') throw new MarketDataError('东方财富返回的日线数据异常', { kind: 'invalid_data' })
  const [date, openText, closeText, highText, lowText, volumeText, amountText] = line.split(',')
  const point = {
    date,
    open: requiredNumber(openText),
    close: requiredNumber(closeText),
    high: requiredNumber(highText),
    low: requiredNumber(lowText),
  }
  const volume = optionalNumber(volumeText)
  const amount = optionalNumber(amountText)
  if (volume !== undefined) point.volume = volume
  if (amount !== undefined) point.amount = amount
  if (!isValidKline(point)) throw new MarketDataError('东方财富返回的 OHLC 日线数据异常', { kind: 'invalid_data' })
  return point
}

export function validateHistory(history, { allowEmpty = false } = {}) {
  if (!Array.isArray(history) || (!allowEmpty && history.length === 0)) throw new Error('history must contain valid OHLC data')
  let previous = ''
  for (const point of history) {
    if (!isValidKline(point)) throw new Error(`Invalid OHLC data at ${point?.date ?? 'unknown date'}`)
    if (point.date <= previous) throw new Error('history must be strictly sorted and deduplicated')
    previous = point.date
  }
  return true
}

export function mergeHistory(...batches) {
  const byDate = new Map()
  for (const batch of batches) {
    if (!Array.isArray(batch)) throw new Error('History batch must be an array')
    for (const point of batch) {
      if (!isValidKline(point)) throw new Error(`Invalid OHLC data at ${point?.date ?? 'unknown date'}`)
      byDate.set(point.date, { ...point })
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function createEastmoneyUrl(instrument, start, end) {
  if (!isValidDate(start) || !isValidDate(end) || start > end) throw new Error('Invalid Eastmoney date range')
  const url = new URL(EASTMONEY_URL)
  url.search = new URLSearchParams({
    secid: instrument.secid,
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt: '0',
    beg: start.replaceAll('-', ''),
    end: end.replaceAll('-', ''),
  }).toString()
  return url
}

function retryDelay(value, now) {
  if (!value) return 300
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now.getTime()) / 1000)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 300
}

export async function fetchEastmoneyRange(instrument, { start, end }, {
  fetcher = fetch,
  now = new Date(),
  timeoutMs = 15_000,
} = {}) {
  const url = createEastmoneyUrl(instrument, start, end)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'stock-dashboard-data/1.0',
      },
      signal: controller.signal,
      redirect: 'manual',
    })
    const status = { upstreamStatus: response.status }
    if (response.status === 403) throw new MarketDataError('东方财富暂时拒绝访问', { ...status, kind: 'http' })
    if (response.status === 429) {
      throw new MarketDataError('东方财富请求受限', {
        ...status,
        kind: 'http',
        retryAfterSeconds: retryDelay(response.headers.get('Retry-After'), now),
      })
    }
    if (!response.ok) throw new MarketDataError(`东方财富行情请求失败（HTTP ${response.status}）`, { ...status, kind: 'http' })

    let payload
    try {
      payload = await response.json()
    } catch (cause) {
      throw new MarketDataError('东方财富返回的 JSON 格式异常', { kind: 'invalid_json', cause })
    }

    if (payload?.rc !== 0) throw new MarketDataError('东方财富返回的行情格式异常', { kind: 'invalid_response' })
    if (payload.data === null) return []
    const source = payload.data
    const expectedMarket = instrument.secid.split('.')[0]
    if (String(source?.code).toUpperCase() !== instrument.code || String(source?.market) !== expectedMarket || !Array.isArray(source?.klines)) {
      throw new MarketDataError('东方财富返回的行情格式异常', { kind: 'invalid_response' })
    }

    const points = new Map()
    for (const line of source.klines) {
      const point = parseEastmoneyKline(line)
      if (point.date >= start && point.date <= end) points.set(point.date, point)
    }
    return [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
  } catch (error) {
    if (error instanceof MarketDataError) throw error
    throw new MarketDataError(controller.signal.aborted ? '东方财富行情请求超时' : '东方财富行情网络请求失败', {
      kind: controller.signal.aborted ? 'timeout' : 'network',
      cause: error,
    })
  } finally {
    clearTimeout(timer)
  }
}
