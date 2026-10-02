import { validateConstituentWeights, validateEtfHoldings } from '../utils/constituentWeights.js'
async function load(name, validator, fetcher) {
  const response = await fetcher(`/data/${name}.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('成分权重／ETF 披露持仓读取失败')
  return validator(await response.json())
}
export const getConstituentWeights = ({ fetcher = fetch } = {}) => load('weights-h30269', validateConstituentWeights, fetcher)
export const getEtfHoldings = ({ fetcher = fetch } = {}) => load('holdings-512890', validateEtfHoldings, fetcher)
