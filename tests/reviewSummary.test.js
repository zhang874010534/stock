import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildReviewSummary, reviewPeriod, reviewMarkdown, validateReviewSummary, validateReviewsDocument, REVIEWS_KEY, formatReviewMetric, MAX_REVIEWS } from '../src/utils/reviewSummary.js'
import { createReviewSummaries } from '../src/composables/useReviewSummaries.js'
import { createReviewPng } from '../src/utils/reviewExport.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { tradingSessions, annualizedVolatility } from '../src/utils/priceRisk.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'
import { CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS } from '../src/utils/constituentStructure.js'

const now = new Date('2026-10-02T08:00:00.000Z')
function market(code = '512890') {
  const history = tradingSessions('2026-04-01', '2026-09-30', tradingCalendar).map((date, i) => {
    const close = 1 + i % 7 * .01
    return { date, open: close, close, high: close, low: close }
  })
  return { code, source: 'eastmoney', interval: '1d', updatedAt: now.toISOString(), backfill: { completed: false }, history, latest: history.at(-1) }
}
function valuations() {
  return { schemaVersion: 1, code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-30',
    history: [{ date: '2026-08-28', pe: 8, pb: .8 }, { date: '2026-09-24', pe: 8.2, pb: .82 }, { date: '2026-09-30', pe: 8.5, pb: .85 }] }
}
function constituents() {
  const members = Array.from({ length: 50 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `股票${i + 1}`, exchange: 'SZSE', industry: null, industryStatus: 'unavailable', industryObservedAt: null, industryDate: null, industrySourceIndex: null }))
  const next = members.map(member => ({ ...member })); next[0] = { ...next[0], code: '600999', exchange: 'SSE', name: '新样本' }
  return { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS,
    membershipStatus: 'ok', membershipReason: null, industryStatus: 'unavailable', industryReason: '暂无分类', lastAttemptAt: '2026-09-30T09:00:00Z',
    snapshots: [{ date: '2026-08-28', observedAt: '2026-08-28T09:00:00Z', members }, { date: '2026-09-30', observedAt: '2026-09-30T09:00:00Z', members: next }] }
}
const note = (id, date, instrument = '512890', text = '自己的观察') => ({ id, date, instrument, price: null, text, createdAt: now.toISOString(), updatedAt: now.toISOString() })
const input = (overrides = {}) => ({ instrument: '512890', type: 'month', anchor: '2026-09-30', market: market(), valuationHistory: valuations(), constituentHistory: constituents(), now, ...overrides })
const find = (report, id) => report.metrics.find(metric => metric.id === id)
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)

test('自然周与月边界跨年、闰月正确，未完成周期截止北京今日，未来周期拒绝', () => {
  assert.deepEqual(reviewPeriod('week', '2026-09-30', { now }), { type: 'week', start: '2026-09-28', end: '2026-10-04', asOf: '2026-10-02', ongoing: true })
  assert.equal(reviewPeriod('month', '2024-02-29', { now }).end, '2024-02-29')
  assert.equal(reviewPeriod('week', '2024-01-01', { now }).start, '2024-01-01')
  assert.equal(reviewPeriod('week', '2025-01-01', { now }).start, '2024-12-30')
  assert.throws(() => reviewPeriod('month', '2026-11-01', { now }), /未来/)
  assert.throws(() => reviewPeriod('week', '2026-02-30', { now }), /有效/)
})

test('收益包含区间首日，回撤与完整60日波动率端点变化匹配独立计算，不使用区间后高点', () => {
  const data = input(), report = buildReviewSummary(data), rows = data.market.history
  const baselineIndex = rows.findIndex(row => row.date === '2026-08-31'), endIndex = rows.length - 1
  near(find(report, 'return').value, (rows[endIndex].close / rows[baselineIndex].close - 1) * 100)
  const drawAt = index => (1 - rows[index].close / Math.max(...rows.slice(0, index + 1).map(row => row.close))) * 100
  near(find(report, 'drawdown').value, drawAt(endIndex) - drawAt(baselineIndex))
  const volAt = index => annualizedVolatility(rows.slice(index - 59, index + 1).map((row, j) => row.close / rows[index - 60 + j].close - 1)) * 100
  near(find(report, 'volatility').value, volAt(endIndex) - volAt(baselineIndex))
  let peak = rows[baselineIndex].close, depth = 0
  for (const row of rows.slice(baselineIndex)) { peak = Math.max(peak, row.close); depth = Math.max(depth, (1 - row.close / peak) * 100) }
  near(find(report, 'maxDrawdown').value, depth)
  const original = buildReviewSummary(input({ anchor: '2026-08-31' }))
  rows.at(-1).close = rows.at(-1).open = rows.at(-1).high = rows.at(-1).low = 100
  near(find(buildReviewSummary({ ...data, anchor: '2026-08-31' }), 'drawdown').value, find(original, 'drawdown').value)
})

test('国庆周仅统计三个已收盘交易日，无交易区间、缺日、缺基准和未来行情说明原因而不缩短周期', () => {
  const data = input({ type: 'week' }), report = buildReviewSummary(data)
  assert.match(find(report, 'return').detail, /基准 2026-09-24.*3 个交易日/)
  const holiday = buildReviewSummary(input({ anchor: '2026-10-01' }))
  assert.equal(find(holiday, 'return').value, null); assert.match(find(holiday, 'return').detail, /尚无已收盘交易日/)
  data.market.history.splice(data.market.history.findIndex(row => row.date === '2026-09-29'), 1)
  assert.match(find(buildReviewSummary(data), 'return').detail, /缺少 1 个交易日.*2026-09-29/)
  const noBaseline = input(); noBaseline.market.history = noBaseline.market.history.filter(row => row.date >= '2026-09-01')
  assert.equal(find(buildReviewSummary(noBaseline), 'return').value, null)
  const future = input(); const last = { ...future.market.latest, date: '2026-10-08' }; future.market.history.push(last); future.market.latest = last
  assert.match(find(buildReviewSummary(future), 'return').detail, /未来日期/)
  const short = input(); short.market.history = short.market.history.filter(row => row.date >= '2026-08-31')
  const shortReport = buildReviewSummary(short)
  assert.notEqual(find(shortReport, 'return').value, null); assert.equal(find(shortReport, 'volatility').value, null)
  assert.match(find(shortReport, 'volatility').detail, /连续 61/)
})

test('当日15点前仅用前一交易日，缺失当日和早年日历不伪造完整结果', () => {
  const report = buildReviewSummary(input({ type: 'week', now: new Date('2026-09-30T06:00:00Z') }))
  assert.match(find(report, 'return').detail, /→ 2026-09-29/)
  const early = buildReviewSummary(input({ type: 'week', anchor: '2022-12-28' }))
  assert.match(find(early, 'return').detail, /交易日历未覆盖/)
})

test('估值变化按独立源日期，缺期初不假报零；损坏身份不阻塞价格或笔记', () => {
  const report = buildReviewSummary(input())
  near(find(report, 'pe').value, .5); near(find(report, 'pb').value, .05)
  assert.match(find(report, 'pe').detail, /2026-08-28/)
  const data = input(); data.valuationHistory.history.shift()
  const missing = buildReviewSummary(data)
  assert.equal(find(missing, 'pe').value, null); assert.match(find(missing, 'pe').detail, /2026-09-30.*缺少区间前/)
  data.valuationHistory.provider = 'CSI'
  const corrupt = buildReviewSummary({ ...data, notes: [note('one', '2026-09-30')] })
  assert.equal(find(corrupt, 'pe').value, null); assert.notEqual(find(corrupt, 'return').value, null); assert.equal(corrupt.notes.length, 1)
})

test('成分展示净增减和观察路径，首次名单不当全部调入，不能使用未来观察或ETF持仓身份', () => {
  const report = buildReviewSummary(input())
  assert.match(report.constituents.join(' '), /非 ETF 实际持仓.*新增 1 只、移除 1 只/)
  assert.match(report.constituents.join(' '), /新样本 600999/)
  assert.match(report.constituents.join(' '), /1 次调入、1 次调出/)
  const data = input(); data.constituentHistory.snapshots.shift()
  assert.match(buildReviewSummary(data).constituents.join(' '), /首次名单只作基线/)
  const historical = buildReviewSummary(input({ anchor: '2026-08-01' }))
  assert.ok(!historical.constituents.join(' ').includes('新样本'))
})

test('笔记按证券和自然日期筛选，含周末，感想和所有Markdown特殊文本完整保留且不执行HTML', () => {
  const text = '<img src=x onerror=bad> [链接](https://evil) **判断**\n第二行 | # 标题'
  const report = buildReviewSummary(input({ notes: [note('before', '2026-08-31'), note('after', '2026-10-01'), note('other', '2026-09-30', 'H30269'), note('mine', '2026-09-26', '512890', text)], reflection: '本月\n继续观察 **风险**' }))
  assert.deepEqual(report.notes.map(item => item.id), ['mine'])
  const markdown = reviewMarkdown(report)
  assert.match(markdown, /&lt;img src=x onerror=bad&gt;/); assert.ok(!markdown.includes('<img'))
  assert.ok(markdown.includes('\n第二行 \\| \\# 标题')); assert.ok(markdown.includes('\\[链接\\]'))
  assert.ok(markdown.includes('继续观察 \\*\\*风险\\*\\*'))
  assert.match(markdown, /我的观察笔记（1 条）/); assert.match(markdown, /数据状态与口径/)
})

test('历史保存完全复制快照，刷新读取、删除撤销、同周期新版本及两证券隔离可用', () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  let serial = 0
  const store = createReviewSummaries({ storage, id: () => `review-${++serial}` })
  const draft = buildReviewSummary(input({ notes: [note('mine', '2026-09-30')] })), saved = store.save(draft)
  draft.notes[0].text = '后来的编辑'; draft.metrics[0].value = 100; draft.period.start = '2026-09-02'
  assert.equal(saved.notes[0].text, '自己的观察'); assert.notEqual(saved.metrics[0].value, 100); assert.equal(saved.period.start, '2026-09-01')
  store.save(buildReviewSummary(input())); store.save(buildReviewSummary(input({ instrument: 'H30269', market: market('H30269') })))
  const reopened = createReviewSummaries({ storage })
  assert.equal(reopened.reviews.value.filter(report => report.instrument === '512890').length, 2)
  reopened.remove(saved.id); assert.equal(reopened.reviews.value.length, 2)
  reopened.undoRemove(); assert.equal(reopened.reviews.value.length, 3)
  assert.equal(validateReviewsDocument(JSON.parse(entries.get(REVIEWS_KEY))).reviews.length, 3)
})

test('损坏存储保护、写入失败提示、数量上限、损坏摘要和跨证券笔记拒绝', () => {
  for (const raw of ['{bad', '{"schemaVersion":2}', 'null']) {
    const storage = { getItem: () => raw, setItem() { throw new Error('must not overwrite') } }, store = createReviewSummaries({ storage, id: () => 'temp' })
    store.save(buildReviewSummary(input())); assert.equal(store.reviews.value.length, 1); assert.match(store.message.value, /保留原记录/)
  }
  let serial = 0
  const store = createReviewSummaries({ storage: { getItem: () => null, setItem() { throw new Error('quota') } }, id: () => `save-${++serial}` })
  for (let i = 0; i < MAX_REVIEWS; i++) store.save(buildReviewSummary(input()))
  assert.match(store.message.value, /保存失败/); assert.throws(() => store.save(buildReviewSummary(input())), /最多保存/)
  const invalid = buildReviewSummary(input()); invalid.metrics[0].value = NaN
  assert.throws(() => validateReviewSummary(invalid), /指标格式/)
  const mismatch = buildReviewSummary(input()); mismatch.notes = [note('other', '2026-09-30', 'H30269')]
  assert.throws(() => validateReviewSummary(mismatch), /证券或日期/)
  const wrongPeriod = buildReviewSummary(input()); wrongPeriod.period.end = '2026-10-01'
  assert.throws(() => validateReviewSummary(wrongPeriod), /周期边界/)
})

test('PNG包含指标、完整多行笔记与口径，超过安全尺寸拒绝且不截断；编码失败报错', async () => {
  const drawn = [], canvas = { getContext: () => ({ measureText: text => ({ width: text.length * 10 }), fillRect() {}, fillText: text => drawn.push(text) }), toBlob: done => done(new Blob(['png'], { type: 'image/png' })) }
  const report = buildReviewSummary(input({ notes: [note('mine', '2026-09-30', '512890', '完整第一行\n完整第二行')], reflection: '独立感想' }))
  assert.equal((await createReviewPng(report, { createCanvas: () => canvas })).type, 'image/png')
  assert.ok(drawn.includes('完整第二行')); assert.ok(drawn.includes('独立感想')); assert.ok(canvas.height > 1000)
  const long = buildReviewSummary(input({ notes: Array.from({ length: 100 }, (_, i) => note(`n${i}`, '2026-09-30', '512890', '内容'.repeat(900))) }))
  await assert.rejects(createReviewPng(long, { createCanvas: () => canvas }), /摘要过长.*Markdown/)
  await assert.rejects(createReviewPng(report, { createCanvas: () => ({ ...canvas, toBlob: done => done(null) }) }), /生成失败/)
  await assert.rejects(createReviewPng(report, { createCanvas: () => ({ getContext: () => null }) }), /无法生成/)
})

test('真实已部署数据可生成周月复盘，日期和基准收益正确，缺估值基准保持空值', async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url)))
  const m = await load('512890.json'), val = await load('valuation-history-h30269.json'), cons = await load('constituents-history-h30269.json')
  const report = buildReviewSummary(input({ market: m, valuationHistory: val, constituentHistory: cons }))
  const baseline = m.history.find(row => row.date === '2026-08-31')
  near(find(report, 'return').value, (m.history.find(row => row.date === '2026-09-30').close / baseline.close - 1) * 100)
  assert.equal(find(report, 'pe').value, null); assert.match(find(report, 'pe').detail, /缺少区间前/)
  const weekly = buildReviewSummary(input({ type: 'week', market: m, valuationHistory: val, constituentHistory: cons }))
  assert.notEqual(find(weekly, 'pe').value, null); assert.notEqual(formatReviewMetric(find(weekly, 'volatility')), '—')
})
