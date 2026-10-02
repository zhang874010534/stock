import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReviewSummary, validateReviewSummary, reviewMarkdown } from '../src/utils/reviewSummary.js'
import { reviewLedgerDetails, reviewTransactionLines } from '../src/utils/reviewLedger.js'
import { createReviewSummaries } from '../src/composables/useReviewSummaries.js'
import { createReviewPng } from '../src/utils/reviewExport.js'

const now = new Date('2026-10-02T08:00:00.000Z')
const stamp = now.toISOString()
const entry = (id, date, type, values = {}) => ({ id, instrument: '512890', type, date, sequence: 1, quantity: null, price: null, amount: null, fee: 0, ratio: null, note: '', createdAt: stamp, updatedAt: stamp, ...values })
const entries = () => [entry('old', '2026-08-28', 'buy', { quantity: 100, price: 1, fee: 1 }),
  entry('buy', '2026-09-01', 'buy', { quantity: 100, price: 2, fee: 2, note: '<img src=x> 买入原因\n完整备注' }),
  entry('sell', '2026-09-02', 'sell', { quantity: 50, price: 3, fee: 1 }),
  entry('div', '2026-09-26', 'dividend', { amount: 10, fee: 1 }), entry('fee', '2026-09-27', 'fee', { amount: 3 }),
  entry('later', '2026-10-02', 'buy', { quantity: 100, price: 9 })]
function market() {
  const history = [['2026-08-31', 2], ['2026-09-29', 2.8], ['2026-09-30', 3]].map(([date, close]) => ({ date, close, open: close, high: close, low: close }))
  return { code: '512890', source: 'eastmoney', interval: '1d', backfill: { completed: false }, history, latest: history.at(-1), updatedAt: stamp }
}
const build = overrides => buildReviewSummary({ instrument: '512890', type: 'month', anchor: '2026-09-01', market: market(), ledgerEntries: entries(), now, ...overrides })
const details = report => reviewLedgerDetails(report.portfolio, report.period, report.notes)
const amount = (data, label) => data.cards.find(card => card.label.startsWith(label)).value
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const note = (id, date, instrument = '512890', values = {}) => ({ id, instrument, date, price: 2, text: '观察全文\n第二行', createdAt: stamp, updatedAt: stamp, ...values })

test('月复盘核算历史成本、买卖现金流、分红与费用，盈亏不重复扣费，不纳入期后交易', () => {
  const report = build(), data = details(report)
  assert.equal(report.portfolio.entries.length, 5); assert.equal(data.transactions.length, 4)
  assert.deepEqual(report.portfolio.quotes.map(quote => quote.date), ['2026-08-31', '2026-09-30'])
  near(data.start.totalProfit, 99); near(data.end.totalProfit, 302)
  near(amount(data, '买入支出'), 202); near(amount(data, '卖出回款'), 149)
  near(amount(data, '本期全部费用'), 7); near(amount(data, '到账分红'), 9)
  near(amount(data, '已实现交易'), 73.25); near(amount(data, '浮动盈亏'), 123.75)
  near(amount(data, '其他费用'), 3); near(amount(data, '个人累计盈亏'), 203)
  const md = reviewMarkdown(report)
  assert.match(md, /个人累计盈亏变化：203/); assert.match(md, /&lt;img src=x&gt;/)
  assert.match(md, /完整备注/); assert.ok(!md.includes('2026\\-08\\-28 /')); assert.ok(!md.includes('2026\\-10\\-02 /'))
})

test('首次买入基线为零；清仓和现金记录无需行情；无账本提示空缺而不伪造账户收益', () => {
  const first = details(build({ ledgerEntries: [entry('first', '2026-09-01', 'buy', { quantity: 100, price: 1, fee: 1 })] }))
  assert.equal(first.start.totalProfit, 0); assert.equal(amount(first, '个人累计盈亏'), 199)
  const closed = details(build({ market: null, ledgerEntries: [entry('first', '2026-09-01', 'buy', { quantity: 100, price: 1, fee: 1 }), entry('end', '2026-09-02', 'sell', { quantity: 100, price: 2, fee: 1 })] }))
  assert.equal(closed.end.totalProfit, 98); assert.equal(amount(closed, '个人累计盈亏'), 98)
  const cash = details(build({ market: null, ledgerEntries: [entry('div', '2026-09-26', 'dividend', { amount: 10, fee: 1 }), entry('fee', '2026-09-27', 'fee', { amount: 3 })] }))
  assert.equal(amount(cash, '个人累计盈亏'), 6)
  const empty = build({ ledgerEntries: [] })
  assert.match(reviewMarkdown(empty), /没有可用账本记录/); assert.ok(!reviewMarkdown(empty).includes('个人累计盈亏变化：0'))
})

test('缺估值端点不缩短或沿用价格，成交仍能汇总；当日未收盘和休市后持仓改变不可用旧价格估值', () => {
  const missing = market(); missing.history.shift()
  const data = details(build({ market: missing }))
  assert.equal(data.start.totalProfit, null); assert.equal(amount(data, '个人累计盈亏'), null)
  assert.equal(amount(data, '卖出回款'), 149); assert.match(data.start.reason, /缺少 2026-08-31/)
  const intraday = details(build({ now: new Date('2026-09-30T06:00:00Z'), ledgerEntries: [entry('today', '2026-09-30', 'buy', { quantity: 100, price: 1 })] }))
  assert.equal(intraday.end.date, '2026-09-29'); assert.equal(intraday.end.totalProfit, null); assert.match(intraday.end.reason, /晚于估值/)
  const holiday = details(build({ anchor: '2026-10-01', ledgerEntries: [entries()[0], entry('fee', '2026-10-02', 'fee', { amount: 3 })] }))
  assert.equal(holiday.end.date, '2026-09-30'); assert.equal(amount(holiday, '个人累计盈亏'), -3)
  const changed = details(build({ anchor: '2026-10-01', ledgerEntries: [entries()[0], entries().at(-1)] }))
  assert.equal(changed.end.totalProfit, null)
})

test('周复盘、无交易持仓及份额调整使用完整历史成本，端点跨休市而现金记录仍按自然日期', () => {
  const weekly = details(build({ type: 'week', anchor: '2026-09-30', ledgerEntries: entries().slice(0, 5) }))
  assert.equal(weekly.transactions.length, 0); assert.equal(weekly.start.totalProfit, null)
  const unchanged = details(build({ ledgerEntries: [entries()[0]] }))
  assert.equal(unchanged.transactions.length, 0); assert.equal(amount(unchanged, '个人累计盈亏'), 100)
  const splitMarket = market(); Object.assign(splitMarket.history.at(-1), { close: 1.5, open: 1.5, high: 1.5, low: 1.5 })
  const split = details(build({ market: splitMarket, ledgerEntries: [...entries().slice(0, 5), entry('split', '2026-09-29', 'split', { ratio: 2 })] }))
  assert.equal(split.end.shares, 300); assert.equal(amount(split, '个人累计盈亏'), 203)
  assert.match(reviewTransactionLines(split.transactions.at(-1)).join(' '), /份额调整 ×2/)
})

test('只关联同证券同日买卖观察，保留全文、创建更新时间和补记／修改提示；缺笔记不猜交易原因', () => {
  const createdAt = '2026-09-01T01:00:00.000Z'
  const report = build({ notes: [note('match', '2026-09-01'), note('edited', '2026-09-01', '512890', { createdAt }), note('other', '2026-09-01', 'H30269'), note('previous', '2026-08-31'), note('after', '2026-10-02'), note('different', '2026-09-03')] })
  const rows = details(report).transactions
  assert.deepEqual(rows[0].notes.map(item => item.id).sort(), ['edited', 'match']); assert.equal(rows[1].notes.length, 0)
  const linked = reviewTransactionLines(rows[0]).join('\n')
  assert.match(linked, /后来补记/); assert.match(linked, /已修改，原始判断未保存/); assert.match(linked, /观察全文\n第二行/)
  assert.match(reviewTransactionLines(rows[1]).join(' '), /没有匹配的笔记/)
  assert.match(reviewMarkdown(report), /不能确认笔记在成交前/)
})

test('账本与笔记快照在保存、刷新、删除撤销后保持原值，旧版摘要兼容且两证券隔离', () => {
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  const store = createReviewSummaries({ storage, id: () => 'saved' }), report = build({ notes: [note('match', '2026-09-01')] })
  store.save(report); report.portfolio.entries[1].price = 100; report.notes[0].text = '新内容'
  const read = createReviewSummaries({ storage }); near(amount(details(read.reviews.value[0]), '个人累计盈亏'), 203)
  assert.equal(details(read.reviews.value[0]).transactions[0].notes[0].text, '观察全文\n第二行')
  read.remove('saved'); read.undoRemove(); assert.equal(read.reviews.value.length, 1)
  const legacy = build(); delete legacy.portfolio
  assert.equal(validateReviewSummary(legacy).portfolio, null); assert.match(reviewMarkdown(legacy), /未包含账本快照/)
  const index = build({ instrument: 'H30269' }); assert.equal(index.portfolio, null); assert.ok(!reviewMarkdown(index).includes('我的账本与盈亏'))
  index.portfolio = build().portfolio; assert.throws(() => validateReviewSummary(index), /不能包含/)
})

test('损坏快照拒绝期后交易、端点错日、价格和跨证券记录，读取异常写入导出状态而不是假报账本完整', () => {
  for (const corrupt of [report => report.portfolio.entries.push(entries().at(-1)), report => report.portfolio.quotes[1].date = '2026-09-29', report => report.portfolio.quotes[1].close = NaN, report => report.portfolio.entries[0].instrument = 'H30269']) {
    const report = build(); corrupt(report); assert.throws(() => validateReviewSummary(report))
  }
  assert.match(reviewMarkdown(build({ ledgerEntries: [], ledgerNotice: '本机账本读取失败，不能确认完整。' })), /本机账本读取失败/)
})

test('PNG导出包含账本金额、备注、关联笔记全文和会计口径', async () => {
  const drawn = [], canvas = { getContext: () => ({ measureText: text => ({ width: text.length * 8 }), fillRect() {}, fillText: text => drawn.push(text) }), toBlob: done => done(new Blob(['png'], { type: 'image/png' })) }
  await createReviewPng(build({ notes: [note('match', '2026-09-01')] }), { createCanvas: () => canvas })
  assert.ok(drawn.includes('个人累计盈亏变化：203.00 元')); assert.ok(drawn.includes('完整备注')); assert.ok(drawn.includes('第二行'))
  assert.ok(drawn.some(line => line.includes('费用不重复扣除')))
})
