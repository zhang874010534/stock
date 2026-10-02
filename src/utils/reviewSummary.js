import { validateMarketData } from './kline.js'
import { calculateDrawdown } from './drawdown.js'
import { tradingCalendar } from '../data/tradingCalendar.js'
import { dateTimestamp, shiftDay, tradingDate, tradingSessions, validatedWindow, rollingVolatility } from './priceRisk.js'
import { validateValuationHistory, VALUATION_SOURCE } from '../api/valuations.js'
import { validateConstituentHistory, compareMembership } from './constituentStructure.js'
import { CONSTITUENTS_SOURCE } from '../api/constituents.js'
import { validateNote, validNoteDate } from './observationNotes.js'

export const REVIEWS_KEY = 'stock:review-summaries:v1'
export const MAX_REVIEWS = 50
export const MAX_REFLECTION_LENGTH = 4000
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
export const chinaReviewDate = (now = new Date()) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
const metricDefinitions = [
  ['return', '区间价格收益', '%'], ['drawdown', '回撤变化', '个百分点'],
  ['volatility', '60 日波动率变化', '个百分点'], ['pe', '指数 PE 变化', '倍'], ['pb', '指数 PB 变化', '倍'], ['maxDrawdown', '区间最大回撤', '%'],
]
export function reviewPeriod(type, anchor, { now = new Date() } = {}) {
  requireValue(['week', 'month'].includes(type) && validNoteDate(anchor), '请选择有效的复盘周期和日期')
  const time = dateTimestamp(anchor), today = chinaReviewDate(now)
  let start, end
  if (type === 'week') {
    start = shiftDay(anchor, -((new Date(time).getUTCDay() + 6) % 7)); end = shiftDay(start, 6)
  } else {
    start = `${anchor.slice(0, 7)}-01`
    end = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0)).toISOString().slice(0, 10)
  }
  requireValue(start <= today, '未来周期尚未开始，不能生成复盘')
  return { type, start, end, asOf: end < today ? end : today, ongoing: end >= today }
}
export const reviewTitle = report => `${report.instrument} · ${report.period.type === 'week' ? '每周' : '每月'}复盘 · ${report.period.start} — ${report.period.end}`
export function formatReviewMetric(metric) {
  if (metric.value === null) return '—'
  const value = Math.abs(metric.value) < .005 ? 0 : metric.value
  return `${metric.id !== 'maxDrawdown' && value > 0 ? '+' : ''}${value.toFixed(2)} ${metric.unit}`
}
const pct = value => `${value.toFixed(2)}%`

export function buildReviewSummary({ instrument, type, anchor, market, valuationHistory, constituentHistory, notes = [], reflection = '', warnings = [], now = new Date(), calendar = tradingCalendar }) {
  requireValue(['H30269', '512890'].includes(instrument), '复盘证券不受支持')
  const period = reviewPeriod(type, anchor, { now })
  const metrics = metricDefinitions.map(([id, label, unit]) => ({ id, label: ['pe', 'pb'].includes(id) && instrument === '512890' ? `标的${label}` : label, unit, value: null, detail: '暂无可核验数据' }))
  const metric = id => metrics.find(item => item.id === id)
  const notices = [...warnings]
  const localNow = new Date(now.getTime() + 8 * 3600_000).toISOString()
  const cutoff = period.asOf === chinaReviewDate(now) && localNow.slice(11, 16) < '15:00' ? shiftDay(period.asOf, -1) : period.asOf
  let baselineDate = shiftDay(period.start, -1), endDate = cutoff
  try {
    baselineDate = tradingDate(baselineDate, -1, calendar)
    const sessions = cutoff >= period.start ? tradingSessions(period.start, cutoff, calendar) : []
    requireValue(sessions.length, '本区间截至当前尚无已收盘交易日')
    endDate = sessions.at(-1)
    validateMarketData(market, instrument)
    requireValue(market.source === 'eastmoney' && market.latest.date <= chinaReviewDate(now), '行情来源或未来日期校验失败')
    const rows = validatedWindow(market.history, baselineDate, endDate, calendar, '复盘行情').rows
    const baseline = rows[0], last = rows.at(-1)
    metric('return').value = (last.close / baseline.close - 1) * 100
    metric('return').detail = `基准 ${baselineDate} 收盘 ${baseline.close} → ${endDate} 收盘 ${last.close}；${rows.length - 1} 个交易日，包含区间首日涨跌。`
    const drawdowns = calculateDrawdown(market.history.filter(row => row.date <= endDate)).points
    const firstDraw = drawdowns.find(row => row.date === baselineDate), lastDraw = drawdowns.at(-1)
    requireValue(firstDraw && lastDraw, '缺少回撤基准')
    const fromDraw = -firstDraw.value * 100, toDraw = -lastDraw.value * 100
    metric('drawdown').value = toDraw - fromDraw
    metric('drawdown').detail = `${baselineDate} 回撤跌幅 ${pct(fromDraw)} → ${endDate} ${pct(toDraw)}；负值表示回撤减轻，高点取截至各日全部已同步收盘。`
    metric('maxDrawdown').value = -(calculateDrawdown(rows).maximum?.value ?? 0) * 100
    metric('maxDrawdown').detail = `按 ${baselineDate} 至 ${endDate} 的收盘路径计算；高点限于该路径，不等同于全历史最大回撤。`
    try {
      const rolling = rollingVolatility(market, baselineDate, endDate, calendar, 60)
      const before = rolling.get(baselineDate), after = rolling.get(endDate)
      requireValue(before !== null && before !== undefined && after !== null && after !== undefined, '期初或期末缺少连续 61 个交易日收盘，60 日波动率变化不可计算')
      metric('volatility').value = (after - before) * 100
      metric('volatility').detail = `${baselineDate} 年化波动率 ${pct(before * 100)} → ${endDate} ${pct(after * 100)}；60 个简单日收益率的样本标准差 × √252。`
    } catch (error) { metric('volatility').detail = error.message }
  } catch (error) {
    for (const id of ['return', 'drawdown', 'volatility', 'maxDrawdown']) Object.assign(metric(id), { value: null, detail: error.message })
    notices.push(`行情区间未完整核验：${error.message}`)
  }
  // Valuation observations remain on their own dates; a missing beginning
  // observation must not turn a single endpoint into a zero change.
  try {
    validateValuationHistory(valuationHistory)
    const rows = valuationHistory.history.filter(row => row.date <= endDate)
    const before = rows.findLast(row => row.date <= baselineDate), after = rows.at(-1)
    requireValue(after && after.date >= period.start, '区间内没有可用的同口径估值观察')
    for (const id of ['pe', 'pb']) {
      metric(id).detail = `${after.date} ${id.toUpperCase()} ${after[id]} 倍；${before ? `基准 ${before.date} ${before[id]} 倍` : '缺少区间前估值观察，变化不可计算'}。东方财富 H30269 口径，保留实际观察日期。`
      if (before) metric(id).value = after[id] - before[id]
    }
  } catch (error) { for (const id of ['pe', 'pb']) metric(id).detail = error.message }
  const constituentLines = []
  try {
    validateConstituentHistory(constituentHistory)
    const rows = constituentHistory.snapshots.filter(row => row.date <= endDate && Date.parse(row.observedAt) <= now.getTime())
    const before = rows.findLast(row => row.date < period.start), after = rows.at(-1)
    const within = rows.filter(row => row.date >= period.start)
    requireValue(after && within.length, '区间内没有已保存的成分观察')
    constituentLines.push(`H30269 ${instrument === '512890' ? '标的指数成分（非 ETF 实际持仓）' : '指数成分'}；区间内 ${within.length} 次保存观察，最新源日期 ${after.date}，采集观察 ${after.observedAt}。`)
    if (before) {
      const change = compareMembership(before, after)
      constituentLines.push(`净变化：${before.date} → ${after.date}，新增 ${change.added.length} 只、移除 ${change.removed.length} 只、更名 ${change.renamed.length} 只。`)
      for (const [label, members] of [['新增', change.added], ['移除', change.removed]]) if (members.length) constituentLines.push(`${label}：${members.map(member => `${member.name} ${member.code}`).join('、')}`)
      if (change.renamed.length) constituentLines.push(`更名：${change.renamed.map(member => `${member.code} ${member.before} → ${member.after}`).join('、')}`)
      if (change.industryChanges.length) constituentLines.push(`已分类行业归属变化：${change.industryChanges.map(member => `${member.name} ${member.before} → ${member.after}`).join('、')}；可能包含分类修订。`)
      if (before.members.some(member => member.industry === null || member.industryStatus === 'stale') || after.members.some(member => member.industry === null || member.industryStatus === 'stale')) constituentLines.push('两端行业分类含缺失或保留值，不能把分类补充当作调样。')
    } else constituentLines.push('缺少区间前成分观察，净新增／移除不可核验；首次名单只作基线，不视为全部调入。')
    const chain = [...(before ? [before] : []), ...within]
    const events = chain.slice(1).map((row, i) => compareMembership(chain[i], row))
    constituentLines.push(`已观察路径：${events.reduce((n, event) => n + event.added.length, 0)} 次调入、${events.reduce((n, event) => n + event.removed.length, 0)} 次调出（同一股票可重复计数）；两次观察之间的变化未知，不能据此确认官方调样生效日。`)
    if (constituentHistory.membershipStatus !== 'ok') notices.push(`成分历史含保留数据：${constituentHistory.membershipReason}`)
  } catch (error) { constituentLines.push(error.message) }
  if (period.ongoing) notices.push(`本周期尚未结束；个人笔记截至 ${period.asOf}，行情仅使用已收盘交易日。`)
  if (market?.backfill?.completed === false) notices.push('行情历史仍在补充；回撤高点仅代表已同步样本。')
  const report = {
    schemaVersion: 1, kind: 'stock-review-summary', id: null, instrument, period, createdAt: now.toISOString(), metrics,
    constituents: constituentLines, notes: notes.filter(note => note.instrument === instrument && note.date >= period.start && note.date <= period.asOf).map(validateNote).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)), reflection,
    warnings: [...new Set(notices)],
    methodology: [`${instrument === '512890' ? 'ETF 未复权价格收益，不含实际现金分红；除息和份额拆分可能影响价格指标' : '价格指数收益，不含分红再投资'}。这不是个人账户收益。`, '收益以区间前一个交易日收盘为基准；完整核验基准至期末每个交易日，不填补缺失行情。回撤使用日收盘，波动率为固定 60 日年化窗口。', '估值和成分来自独立保存观察，展示真实日期，不插值、不使用区间之后的数据。已保存摘要与笔记为生成时快照，不随后续编辑或历史回补改变。'],
  }
  return validateReviewSummary(report)
}

export function validateReviewSummary(report) {
  requireValue(report?.schemaVersion === 1 && report.kind === 'stock-review-summary' && ['H30269', '512890'].includes(report.instrument), '复盘保存格式或证券异常')
  requireValue(report.id === null || typeof report.id === 'string' && /^[\w-]{1,80}$/.test(report.id), '复盘编号异常')
  requireValue(typeof report.createdAt === 'string' && Number.isFinite(Date.parse(report.createdAt)) && new Date(report.createdAt).toISOString() === report.createdAt, '复盘生成时间异常')
  const period = report.period
  requireValue(period && ['week', 'month'].includes(period.type) && [period.start, period.end, period.asOf].every(validNoteDate) && period.start <= period.asOf && period.asOf <= period.end && period.asOf <= chinaReviewDate(new Date(report.createdAt)) && typeof period.ongoing === 'boolean', '复盘区间异常')
  const expected = reviewPeriod(period.type, period.start, { now: new Date(report.createdAt) })
  requireValue(['start', 'end', 'asOf', 'ongoing'].every(key => period[key] === expected[key]), '复盘周期边界异常')
  requireValue(Array.isArray(report.metrics) && report.metrics.length === metricDefinitions.length, '复盘指标数量异常')
  const metrics = report.metrics.map((item, index) => {
    const [id, , unit] = metricDefinitions[index]
    requireValue(item?.id === id && item.unit === unit && (item.value === null || Number.isFinite(item.value)) && typeof item.label === 'string' && item.label.length <= 80 && typeof item.detail === 'string' && item.detail.length <= 2000, '复盘指标格式异常')
    return { id, label: item.label, unit, value: item.value, detail: item.detail }
  })
  const strings = (value, max = 1000) => {
    requireValue(Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.length <= 2000), '复盘说明格式异常')
    return [...value]
  }
  requireValue(Array.isArray(report.notes) && report.notes.length <= 1000, '复盘笔记数量异常')
  const notes = report.notes.map(validateNote)
  requireValue(new Set(notes.map(note => note.id)).size === notes.length && notes.every(note => note.instrument === report.instrument && note.date >= period.start && note.date <= period.asOf), '复盘笔记证券或日期异常')
  requireValue(typeof report.reflection === 'string' && report.reflection.length <= MAX_REFLECTION_LENGTH, `复盘感想最多 ${MAX_REFLECTION_LENGTH} 字`)
  return { schemaVersion: 1, kind: 'stock-review-summary', id: report.id, instrument: report.instrument, period: { ...expected }, createdAt: report.createdAt,
    metrics, constituents: strings(report.constituents), notes, reflection: report.reflection.trim(), warnings: strings(report.warnings, 30), methodology: strings(report.methodology, 10) }
}
export function validateReviewsDocument(document) {
  requireValue(document?.schemaVersion === 1 && document.kind === 'stock-review-history' && Array.isArray(document.reviews) && document.reviews.length <= MAX_REVIEWS, '复盘历史保存格式异常')
  const reviews = document.reviews.map(validateReviewSummary)
  requireValue(reviews.every(report => report.id !== null) && new Set(reviews.map(report => report.id)).size === reviews.length, '复盘历史编号重复或缺失')
  return { schemaVersion: 1, kind: 'stock-review-history', reviews }
}
// Encode all user text as literal Markdown text, including HTML and link syntax.
export const escapeReviewMarkdown = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
export function reviewMarkdown(input) {
  const report = validateReviewSummary(input), text = escapeReviewMarkdown
  const lines = [`# ${text(reviewTitle(report))}`, '', `生成时间：${text(report.createdAt)}；${report.period.ongoing ? '周期进行中' : '完整自然周期'}；汇总截至 ${report.period.asOf}。`, '', '## 区间指标', '']
  for (const metric of report.metrics) lines.push(`- **${text(metric.label)}：${text(formatReviewMetric(metric))}**`, `  ${text(metric.detail)}`)
  lines.push('', '## 成分变化', '', ...report.constituents.map(line => `- ${text(line)}`), '', `## 我的观察笔记（${report.notes.length} 条）`, '')
  if (!report.notes.length) lines.push('本区间没有该证券的观察笔记。')
  for (const note of report.notes) lines.push(`### ${note.date}${note.price === null ? '' : ` · 记录价格 ${note.price}`}`, '', ...note.text.split(/\r?\n/).map(line => text(line)), '')
  lines.push('', '## 我的复盘感想', '', ...(report.reflection || '暂无补充感想。').split(/\r?\n/).map(text), '', '## 数据状态与口径', '', ...[...report.warnings, ...report.methodology].map(line => `- ${text(line)}`), '', `数据来源：[东方财富估值](${VALUATION_SOURCE})；[中证成分](${CONSTITUENTS_SOURCE})。行情：东方财富已同步日线。`, '')
  return lines.join('\n')
}
export const reviewFilename = (report, extension) => `${report.instrument}_${report.period.type === 'week' ? '周' : '月'}复盘_${report.period.start}_${report.period.end}.${extension}`
