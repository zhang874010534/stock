import { validateEtfNav } from '../utils/etfNav.js'

export async function getEtfNav({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/nav-512890.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('ETF 净值历史读取失败')
  return validateEtfNav(await response.json())
}
