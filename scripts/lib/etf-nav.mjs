import { ETF_NAV_SOURCE, ETF_NAV_DATA_SOURCE, validateEtfNav } from '../../src/utils/etfNav.js'

// Read JSON assignments only. Never execute provider JavaScript.
function assignment(source, name, pattern) {
  const matches = [...source.matchAll(new RegExp(`\\bvar\\s+${name}\\s*=\\s*(${pattern})\\s*;`, 'g'))]
  if (matches.length !== 1) throw new Error(`净值来源字段 ${name} 缺失或重复`)
  return JSON.parse(matches[0][1])
}
function sourceDate(time) {
  if (!Number.isSafeInteger(time)) throw new Error('净值时间戳异常')
  const local = new Date(time + 8 * 3600000)
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(11) !== '00:00:00.000Z') throw new Error('净值日期不是北京时间零点')
  return local.toISOString().slice(0, 10)
}
export function parseEtfNav(source, now = new Date()) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024) throw new Error('净值来源内容异常或超限')
  if (assignment(source, 'fS_code', '"[^"\\r\\n]*"') !== '512890') throw new Error('净值来源证券身份异常')
  const values = assignment(source, 'Data_netWorthTrend', '\\[[\\s\\S]*?\\]'), accumulated = assignment(source, 'Data_ACWorthTrend', '\\[[\\s\\S]*?\\]')
  if (!Array.isArray(values) || !Array.isArray(accumulated) || !values.length || values.length !== accumulated.length || values.length > 20000) throw new Error('单位／累计净值记录缺失或日期不匹配')
  const history = values.map((row, i) => {
    if (!Array.isArray(accumulated[i]) || accumulated[i].length !== 2 || row?.x !== accumulated[i][0]) throw new Error('单位／累计净值日期不匹配')
    return { date: sourceDate(row.x), nav: row.y, accumulatedNav: accumulated[i][1] }
  })
  return validateEtfNav({ schemaVersion: 1, code: '512890', provider: 'Eastmoney', source: ETF_NAV_SOURCE, dataSource: ETF_NAV_DATA_SOURCE, unit: 'CNY_per_share', basis: 'unit_nav', status: 'ok', reason: null,
    lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), date: history.at(-1).date, history }, { now })
}
