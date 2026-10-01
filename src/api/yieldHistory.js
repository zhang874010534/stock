import { validateYieldHistory } from '../utils/yieldSpread.js'

export async function getYieldHistory({ fetcher = fetch, now = new Date() } = {}) {
  const response = await fetcher(`/data/yield-history-h30269-cn10y.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取收益率历史，稍后重试')
  return validateYieldHistory(await response.json(), { now })
}
