import { ETF_SIZE_SOURCE, ETF_SIZE_DATA_SOURCE, validateEtfSize } from '../../src/utils/etfLiquidity.js'
function assignment(source, name, pattern) {
  const matches = [...source.matchAll(new RegExp(`\\bvar\\s+${name}\\s*=\\s*(${pattern})\\s*;`, 'g'))]
  if (matches.length !== 1) throw new Error(`规模来源字段 ${name} 缺失或重复`)
  return JSON.parse(matches[0][1])
}
export function parseEtfSize(source, now = new Date()) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) throw new Error('规模来源内容异常或超限')
  if (assignment(source, 'fS_code', '"[^"\\r\\n]*"') !== '512890') throw new Error('规模来源证券身份异常')
  const values = assignment(source, 'Data_fluctuationScale', '\\{[\\s\\S]*?\\}')
  if (!Array.isArray(values.categories) || !Array.isArray(values.series) || !values.categories.length || values.categories.length !== values.series.length) throw new Error('规模日期与数值不匹配')
  // Provider scale series uses 亿元. Normalize once at ingestion.
  const history = values.categories.map((date, index) => {
    if (!Number.isFinite(values.series[index]?.y)) throw new Error('规模数值异常')
    return { date, netAssets: Math.round(values.series[index].y * 1e8 * 100) / 100 }
  })
  return validateEtfSize({ schemaVersion: 1, code: '512890', provider: 'Eastmoney', source: ETF_SIZE_SOURCE, dataSource: ETF_SIZE_DATA_SOURCE, unit: 'CNY', basis: 'reported_net_assets', status: 'ok', reason: null, lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), date: history.at(-1).date, history }, { now })
}
