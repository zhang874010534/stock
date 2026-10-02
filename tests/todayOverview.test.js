import test from 'node:test'
import assert from 'node:assert/strict'
import { todayOverview } from '../src/utils/todayOverview.js'
import { CONSTITUENTS_SOURCE } from '../src/api/constituents.js'
import { INDUSTRY_SOURCE, INDUSTRY_BASIS } from '../src/utils/constituentStructure.js'

const now = new Date('2026-10-02T08:00:00Z')
const state = (data, extra = {}) => ({ data, loading: false, error: '', attempted: true, ...extra })
const market = (code = '512890', dates = ['2026-09-29', '2026-09-30'], prices = [1, 1.2]) => {
  const history = dates.map((date, i) => ({ date, open: prices[i], close: prices[i], high: prices[i], low: prices[i] }))
  return { code, source: 'eastmoney', interval: '1d', history, latest: history.at(-1), updatedAt: now.toISOString(), backfill: { completed: true } }
}
const entry = (id, type, date, fields = {}) => ({ id, instrument: '512890', type, date, sequence: 1,
  quantity: ['buy', 'sell'].includes(type) ? 100 : null, price: ['buy', 'sell'].includes(type) ? 1 : null,
  amount: ['dividend', 'fee'].includes(type) ? 10 : null, ratio: type === 'split' ? 2 : null, fee: 0,
  createdAt: now.toISOString(), updatedAt: now.toISOString(), note: '', ...fields })
const inputs = (extra = {}) => ({ instrument: '512890', states: { '512890': state(market()), collection: state({ sources: { '512890': { status: 'ok' } } }) }, now, ...extra })
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} != ${expected}`)
function historyFixture() {
  const members = Array.from({ length: 50 }, (_, i) => ({ code: String(i + 1).padStart(6, '0'), name: `股票${i + 1}`, exchange: 'SZSE',
    industry: '金融', industryStatus: 'ok', industryDate: '2026-09-24', industrySourceIndex: '932083', industryObservedAt: '2026-09-24T10:00:00Z' }))
  const snapshots = [{ date: '2026-09-24', observedAt: '2026-09-24T10:00:00Z', members },
    { date: '2026-09-28', observedAt: '2026-09-28T10:00:00Z', members: structuredClone(members) }]
  return { schemaVersion: 1, code: 'H30269', source: CONSTITUENTS_SOURCE, industrySource: INDUSTRY_SOURCE, industryBasis: INDUSTRY_BASIS,
    membershipStatus: 'ok', membershipReason: null, industryStatus: 'ok', industryReason: null, lastAttemptAt: snapshots.at(-1).observedAt, snapshots }
}

test('概览保留真实日期，休市日不冒充今日涨跌，ETF 与指数独立', () => {
  const data = inputs(), overview = todayOverview(data)
  assert.equal(overview.today, '2026-10-02'); assert.equal(overview.price.date, '2026-09-30')
  assert.equal(overview.price.previousDate, '2026-09-29'); near(overview.price.changePercent, 20)
  assert.equal(overview.issues.length, 0); assert.equal(overview.portfolio.hasEntries, false)
  data.states.H30269 = state(market('H30269', undefined, [100, 99]))
  data.states.collection.data.sources.H30269 = { status: 'ok' }
  data.instrument = 'H30269'; data.states['512890'].error = 'ETF失败'
  const index = todayOverview(data)
  near(index.price.changePercent, -1); assert.equal(index.portfolio.applicable, false)
  assert.ok(!index.issues.some(issue => issue.messages.join('').includes('ETF失败')))
})

test('持仓变动包含买入、卖出、到账分红与费用，清仓后仍保留已实现收益', () => {
  const entries = [entry('buy', 'buy', '2026-09-29', { fee: 1 }),
    entry('sell', 'sell', '2026-09-30', { quantity: 40, price: 1.3, fee: 1 }),
    entry('dividend', 'dividend', '2026-09-30', { amount: 10, fee: 1, sequence: 2 }),
    entry('fee', 'fee', '2026-09-30', { amount: 2, sequence: 3 })]
  let result = todayOverview(inputs({ entries })).portfolio
  // Sep 29: -1. Sep 30: 72 + 51 + 9 - 101 - 2 = 29.
  near(result.totalProfit, 29); near(result.change, 30)
  entries.push(entry('close', 'sell', '2026-09-30', { quantity: 60, price: 1.2, fee: 1, sequence: 4 }))
  result = todayOverview(inputs({ entries })).portfolio
  near(result.totalProfit, 28); near(result.change, 29)
})

test('首次买入基准为零，拆分使用当日账本份额，晚于行情的交易暂停比较', () => {
  let data = inputs({ entries: [entry('buy', 'buy', '2026-09-30', { price: 1.1, fee: 1 })] })
  near(todayOverview(data).portfolio.change, 9)
  data = inputs({ entries: [entry('buy', 'buy', '2026-09-29'), entry('split', 'split', '2026-09-30')],
    states: { '512890': state(market('512890', undefined, [1, .5])) } })
  near(todayOverview(data).portfolio.change, 0)
  data.entries.push(entry('div', 'dividend', '2026-10-01'))
  const result = todayOverview(data)
  assert.equal(result.portfolio.change, null); assert.equal(result.portfolio.totalProfit, null)
  assert.match(result.portfolio.reason, /晚于行情/)
})

test('缺少准确上一交易日不能跨日计算，日历外和不合法行情明确待核验', () => {
  const data = inputs({ entries: [entry('buy', 'buy', '2026-09-28')] })
  data.states['512890'].data = market('512890', ['2026-09-28', '2026-09-30'])
  let result = todayOverview(data)
  assert.equal(result.price.change, null); assert.equal(result.portfolio.change, null)
  assert.match(result.portfolio.reason, /上一交易日/); near(result.portfolio.totalProfit, 20)
  result = todayOverview({ ...data, calendar: { start: '2026-10-01', end: '2026-12-31', closures: [] } })
  assert.equal(result.price.change, null); assert.match(result.price.reason, /日历/)
  data.states['512890'].data.latest = { ...data.states['512890'].data.latest, close: 4 }
  result = todayOverview(data)
  assert.equal(result.price.close, null); assert.equal(result.portfolio.totalProfit, null)
  assert.match(result.price.reason, /不一致/)
})

test('盘中只使用此前已收盘行情，未来行情拒绝展示', () => {
  const data = inputs({ now: new Date('2026-09-30T04:00:00Z') })
  const result = todayOverview(data)
  assert.equal(result.price.date, '2026-09-29'); assert.equal(result.price.close, 1)
  data.now = new Date('2026-09-28T04:00:00Z')
  assert.equal(todayOverview(data).price.close, null)
  assert.match(todayOverview(data).price.reason, /日期异常/)
})

test('最近两次成分观察包含同源日期修订，最新无变化不回显更早调样', () => {
  const data = inputs(), history = historyFixture()
  data.states.constituentHistory = state(history)
  history.snapshots[1].members[0].code = '000099'
  let result = todayOverview(data).constituents
  assert.equal(result.added, 1); assert.equal(result.removed, 1)
  const last = structuredClone(history.snapshots[1]); last.observedAt = '2026-09-29T10:00:00Z'
  history.snapshots.push(last); history.lastAttemptAt = last.observedAt
  result = todayOverview(data).constituents
  assert.equal(result.added, 0); assert.equal(result.removed, 0)
  assert.equal(result.date, result.fromDate); assert.equal(result.observedAt, last.observedAt)
  history.snapshots = history.snapshots.slice(0, 1)
  assert.equal(todayOverview(data).constituents.added, null)
})

test('成分刷新失败沿用详细模块保留的整组观察，不拼接半次更新', () => {
  const history = historyFixture(), saved = structuredClone(history), data = inputs()
  history.snapshots[1].members[0].code = '000099'
  data.states.constituentHistory = state(history)
  data.states.constituents = state(null, { error: '失败' })
  const result = todayOverview({ ...data, constituentInputs: { history: saved, current: null } })
  assert.equal(result.constituents.added, 0)
  assert.ok(result.issues.some(issue => issue.target === '#constituent-structure' && issue.messages.some(text => /读取失败/.test(text))))
})

test('异常按模块去重，区分读取失败、后台失败、旧数据、状态未知和加载中', () => {
  const data = inputs()
  data.now = new Date('2026-10-14T12:00:00Z')
  data.states['512890'].error = '失败'
  data.states.collection.data.sources['512890'] = { status: 'error' }
  data.states.valuation = state({ date: '2026-09-30' })
  data.states.constituentHistory = state(historyFixture())
  data.moduleWarnings = [{ active: true, target: '#market-chart', label: '行情', message: '历史覆盖不足' }]
  let result = todayOverview(data), issue = result.issues.find(item => item.target === '#market-chart')
  assert.equal(result.issues.filter(item => item.target === '#market-chart').length, 1)
  assert.match(issue.messages.join('；'), /读取失败.*后台更新失败.*数据较旧.*历史覆盖不足/)
  assert.ok(result.issues.find(item => item.target === '#valuation-analysis').messages.some(text => /状态未知/.test(text)))
  data.states.collection.error = '状态读取失败'
  result = todayOverview(data)
  assert.ok(result.issues.some(item => item.target === '#data-source-status'))
  assert.match(result.issues.find(item => item.target === '#market-chart').messages.join('；'), /未能重新核验/)
  const loading = todayOverview(inputs({ states: { '512890': state(null, { loading: true }), collection: state(null, { loading: true }) } }))
  assert.equal(loading.loading, true); assert.equal(loading.issues.length, 0)
})

test('收益率历史分别核对两条序列，收益风险时效取计算截止日期', () => {
  const data = inputs()
  data.states.yieldHistory = state({ series: { dividend: { history: [{ date: '2026-09-30' }] }, treasury: { history: [{ date: '2026-09-30' }] } } })
  data.states.collection.data.sources.yieldHistory = { status: 'ok' }
  assert.ok(!todayOverview(data).issues.some(issue => issue.target === '#yield-spread'))
  data.states.yieldHistory.data.series.treasury.history = [{ date: '2026-09-17' }]
  data.states.latestMetrics = state({ calculation: { windowEnd: '2026-09-17' } })
  const result = todayOverview(data)
  assert.match(result.issues.find(issue => issue.target === '#yield-spread').messages.join('；'), /历史国债收益率：数据较旧.*2026-09-17/)
  assert.match(result.issues.find(issue => issue.target === '#performance-metrics').messages.join('；'), /数据较旧.*2026-09-17/)
})
