import { validateMarketData } from '../utils/kline.js'

const H30269_DATA_URL = '/data/h30269.json'

export async function getH30269({ fetcher = fetch, cacheKey = Date.now() } = {}) {
  const response = await fetcher(`${H30269_DATA_URL}?t=${encodeURIComponent(cacheKey)}`, {
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
  return validateMarketData(data)
}
