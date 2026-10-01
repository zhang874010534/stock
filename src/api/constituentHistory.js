import { validateConstituentHistory } from '../utils/constituentStructure.js'

export async function getConstituentHistory({ fetcher = fetch } = {}) {
  const response = await fetcher(`/data/constituents-history-h30269.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('成分股历史与行业分类读取失败')
  return validateConstituentHistory(await response.json())
}
