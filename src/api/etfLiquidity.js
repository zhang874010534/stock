import { validateEtfFees, validateEtfSize } from '../utils/etfLiquidity.js'
async function read(name, validate, fetcher) {
  const response = await fetcher(`/data/${name}-512890.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`ETF ${name === 'size' ? '规模' : '费率'}读取失败`)
  return validate(await response.json())
}
export const getEtfSize = ({ fetcher = fetch } = {}) => read('size', validateEtfSize, fetcher)
export const getEtfFees = ({ fetcher = fetch } = {}) => read('fees', validateEtfFees, fetcher)
