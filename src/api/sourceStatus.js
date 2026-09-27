import { validateSourceStatus } from '../utils/sourceStatus.js'

export async function getSourceStatus({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/dashboard-source-status.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('无法读取后台采集状态')
  return validateSourceStatus(await response.json())
}
