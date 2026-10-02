import { validateFundamentals } from '../utils/dividendQuality.js'

export async function getFundamentals({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/fundamentals-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('分红与基本面快照读取失败')
  return validateFundamentals(await response.json())
}
