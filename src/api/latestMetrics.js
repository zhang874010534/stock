import { validateLatestMetrics } from '../utils/latestMetrics.js'

export async function getLatestMetrics({ fetcher = fetch, cacheKey = Date.now() } = {}) {
  const response = await fetcher(`/data/latest-metrics-h30269.json?t=${cacheKey}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('暂时无法读取最新指标')
  return validateLatestMetrics(await response.json())
}
