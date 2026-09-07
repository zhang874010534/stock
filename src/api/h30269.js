import { validateMarketData } from '../utils/kline.js'

const DATA_URLS = { H30269: '/data/h30269.json', '512890': '/data/512890.json' }

export async function getMarketData(code, { fetcher = fetch, cacheKey = Date.now() } = {}) {
  if (!DATA_URLS[code]) throw new Error('不支持的证券代码')
  const response = await fetcher(`${DATA_URLS[code]}?t=${encodeURIComponent(cacheKey)}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`静态行情文件读取失败（HTTP ${response.status}）`)
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('静态行情文件 JSON 格式异常')
  }
  return validateMarketData(data, code)
}

export function getH30269(options) { return getMarketData('H30269', options) }
