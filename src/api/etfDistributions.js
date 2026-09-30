import { validateEtfDistributions } from '../utils/etfDistributions.js'

export async function getEtfDistributions({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/distributions-512890.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('ETF 分红记录读取失败')
  return validateEtfDistributions(await response.json())
}
