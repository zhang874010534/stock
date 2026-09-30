import { ETF_DISTRIBUTION_SOURCE, validateEtfDistributions, chinaDate } from '../../src/utils/etfDistributions.js'

function text(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim()
}
function rowsOf(html, className, header) {
  const tables = [...html.matchAll(/<table\b[^>]*class=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/table>/gi)].filter(match => match[1].split(/\s+/).includes(className))
  if (tables.length !== 1) throw new Error('分红页面表格缺失或结构变更')
  const rows = [...tables[0][2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1])))
  if (JSON.stringify(rows.shift()) !== JSON.stringify(header) || !rows.length) throw new Error('分红页面字段或记录缺失')
  return rows
}
export function parseEtfDistributions(html, now = new Date()) {
  if (typeof html !== 'string' || !/<title>[^<]*\(512890\)[^<]*基金分红送配/i.test(html)) throw new Error('分红页面证券身份异常')
  const cashRows = rowsOf(html, 'cfxq', ['年份', '权益登记日', '除息日', '每10份分红', '分红发放日'])
  const splitRows = rowsOf(html, 'fhxq', ['年份', '拆分折算日', '拆分类型', '拆分折算比例'])
  const dividends = cashRows.length === 1 && cashRows[0].length === 1 && cashRows[0][0] === '暂无分红信息!' ? [] : cashRows.map(row => {
    const amount = row[3]?.match(/^每10份派现金(\d+(?:\.\d+)?)元$/)
    if (row.length !== 5 || !/^\d{4}年$/.test(row[0]) || !amount) throw new Error('未知分红金额单位或方案')
    return { recordDate: row[1], exDate: row[2], cashPerShare: Number(amount[1]) / 10, payDate: row[4] }
  })
  const splits = splitRows.length === 1 && splitRows[0].length === 1 && splitRows[0][0] === '暂无拆分信息!' ? [] : splitRows.map(row => {
    const ratio = row[3]?.match(/^1:(\d+(?:\.\d+)?)$/)
    if (row.length !== 4 || !/^\d{4}年$/.test(row[0]) || !['份额分拆', '份额折算'].includes(row[2]) || !ratio) throw new Error('未知份额拆分或折算方案')
    return { date: row[1], ratio: Number(ratio[1]) }
  })
  const sort = (a, b) => (a.exDate ?? a.date).localeCompare(b.exDate ?? b.date)
  return validateEtfDistributions({ schemaVersion: 1, code: '512890', unit: 'CNY_per_share', source: ETF_DISTRIBUTION_SOURCE,
    coverage: { start: '2018-12-19', end: chinaDate(now) }, checkedAt: now.toISOString(), status: 'ok', reason: null,
    dividends: dividends.sort(sort), splits: splits.sort(sort) }, { now })
}
