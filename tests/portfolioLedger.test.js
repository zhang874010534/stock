import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateXirr, ledgerAccounting, ledgerDocument, portfolioSummary, projectLedgerTrades, validateLedgerDocument, validateLedgerEntry, LEDGER_KEY, MAX_LEDGER_BACKUP_BYTES } from '../src/utils/portfolioLedger.js'
import { createPortfolioLedger } from '../src/composables/usePortfolioLedger.js'
import { aggregateKlines } from '../src/utils/kline.js'

const now = new Date('2026-10-01T04:00:00Z')
const time = '2026-10-01T04:00:00.000Z'
const entry = (id, type, date, values = {}) => ({ id, instrument: '512890', type, date, sequence: 1,
  quantity: ['buy', 'sell'].includes(type) ? 100 : null, price: ['buy', 'sell'].includes(type) ? 1 : null,
  amount: ['dividend', 'fee'].includes(type) ? 10 : null, fee: 0, ratio: type === 'split' ? 2 : null,
  note: '', createdAt: time, updatedAt: time, ...values })
const options = { now }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
function store(initial = null, fail = false) {
  const values = new Map(initial === null ? [] : [[LEDGER_KEY, initial]])
  let sequence = 0
  const storage = { getItem: key => values.get(key), setItem(key, value) { if (fail) throw new Error('Quota'); values.set(key, value) } }
  return { values, storage, ledger: createPortfolioLedger({ storage, now: () => now, id: () => `trade-${++sequence}` }) }
}

test('移动平均结转部分卖出；买卖费、到账分红和其他费用只记一次，累计盈亏与净现金流一致', () => {
  const entries = [entry('b1', 'buy', '2025-09-30', { fee: 1 }), entry('b2', 'buy', '2025-10-01', { price: 2, fee: 1 }),
    entry('s1', 'sell', '2026-09-28', { quantity: 50, price: 3, fee: 2 }), entry('d1', 'dividend', '2026-09-29', { amount: 20, fee: 1 }), entry('f1', 'fee', '2026-09-30', { amount: 3 })]
  const result = portfolioSummary(validateLedgerDocument(ledgerDocument(entries, options), options), { date: '2026-09-30', close: 2.5 }, options)
  assert.equal(result.shares, 150); near(result.cost, 226.5); near(result.averageCost, 1.51)
  near(result.realized, 72.5); near(result.unrealized, 148.5); near(result.dividends, 19)
  near(result.totalProfit, 237); near(result.totalReturn, 237 / 302); assert.equal(result.fees, 8)
  near(result.flows.reduce((sum, flow) => sum + flow.amount, 0) + result.marketValue, result.totalProfit)
  assert.equal(result.rows[2].profit, 72.5)
})

test('同日按显式顺序记账，禁止先卖后买、超卖、顺序重复及未来或畸形交易', () => {
  const buy = entry('buy', 'buy', '2026-09-30'), sell = entry('sell', 'sell', '2026-09-30', { sequence: 2 })
  assert.equal(ledgerAccounting([sell, buy]).shares, 0)
  assert.throws(() => ledgerDocument([buy, { ...sell, sequence: 1 }], options), /顺序不能重复/)
  assert.throws(() => ledgerDocument([{ ...buy, sequence: 2 }, { ...sell, sequence: 1 }], options), /超过当时持仓/)
  assert.throws(() => ledgerDocument([buy, { ...sell, quantity: 101 }], options), /超过当时持仓/)
  assert.throws(() => validateLedgerEntry({ ...buy, date: '2026-10-02' }, options), /未来/)
  assert.throws(() => validateLedgerEntry({ ...buy, date: '2026-02-30' }, options), /真实有效/)
  for (const changes of [{ quantity: 0 }, { quantity: 1.5 }, { price: NaN }, { fee: -1 }, { fee: 0.001 }, { instrument: 'H30269' }, { sequence: 0 }, { amount: 1 }, { note: 'a'.repeat(501) }]) assert.throws(() => validateLedgerEntry({ ...buy, ...changes }, options))
  assert.throws(() => validateLedgerEntry(entry('d', 'dividend', '2026-09-30', { amount: 10, fee: 11 }), options), /不能超过/)
  assert.throws(() => validateLedgerEntry(entry('f', 'fee', '2026-09-30', { fee: 1 }), options), /重复/)
})

test('清仓成本归零、重新买入不继承旧成本，拆分保持总成本，成交金额按分舍入', () => {
  const result = ledgerAccounting([entry('b', 'buy', '2025-09-30', { quantity: 101, price: 1.005 }),
    entry('split', 'split', '2025-10-01'), entry('s', 'sell', '2025-10-02', { quantity: 202, price: 0.7 }), entry('again', 'buy', '2026-09-30', { price: 2, fee: 1 })])
  assert.equal(result.rows[0].cashFlow, -101.51)
  assert.equal(result.rows[1].shares, 202); assert.equal(result.rows[1].cost, 101.51)
  assert.equal(result.rows[2].shares, 0); assert.equal(result.rows[2].cost, 0)
  assert.equal(result.cost, 201); assert.equal(result.averageCost, 2.01)
  assert.throws(() => ledgerDocument([entry('split', 'split', '2026-09-30')], options), /没有持仓/)
})

test('XIRR 使用 ACT/365 与期末市值；零收益、亏损、不规则日期和清仓现金流可计算', () => {
  const buy = entry('b', 'buy', '2025-09-30', { price: 10, fee: 5 })
  const open = portfolioSummary([buy], { date: '2026-09-30', close: 12 }, options)
  near(open.xirr.value, 1200 / 1005 - 1)
  const closed = portfolioSummary([buy, entry('s', 'sell', '2026-09-30', { price: 12, fee: 5 })], null, options)
  near(closed.xirr.value, 1195 / 1005 - 1); assert.equal(closed.marketValue, 0); assert.equal(closed.asOf, '2026-09-30')
  near(calculateXirr([{ date: '2025-09-30', amount: -1000 }, { date: '2026-09-30', amount: 1000 }]).value, 0)
  near(calculateXirr([{ date: '2025-09-30', amount: -1000 }, { date: '2026-09-30', amount: 800 }]).value, -0.2)
  const days = 183, annualRate = 0.1
  const irregular = calculateXirr([{ date: '2025-09-30', amount: -1000 }, { date: '2026-04-01', amount: 1000 * (1 + annualRate) ** (days / 365) }])
  near(irregular.value, annualRate)
  const multipleBuys = calculateXirr([{ date: '2025-09-30', amount: -1000 }, { date: '2026-03-31', amount: -1000 }, { date: '2026-09-30', amount: 2200 }])
  const npv = -1000 - 1000 / (1 + multipleBuys.value) ** (182 / 365) + 2200 / (1 + multipleBuys.value)
  near(npv, 0)
})

test('XIRR 合并同日现金流；不跨日、缺正负或可能多根不生成单一百分比', () => {
  for (const flows of [[], [{ date: '2026-09-30', amount: -100 }], [{ date: '2026-09-30', amount: 100 }], [{ date: '2026-09-30', amount: -100 }, { date: '2026-09-30', amount: 120 }]]) assert.equal(calculateXirr(flows).value, null)
  const multiple = calculateXirr([{ date: '2024-09-30', amount: -100 }, { date: '2025-09-30', amount: 230 }, { date: '2026-09-30', amount: -132 }])
  assert.equal(multiple.value, null); assert.match(multiple.reason, /多个/)
  near(calculateXirr([{ date: '2025-09-30', amount: -100 }, { date: '2025-09-30', amount: -100 }, { date: '2026-09-30', amount: 220 }]).value, 0.1)
  // Reinvestment after a distribution can have a unique root despite changes
  // in signs. A blanket rejection of nonconventional flows is too restrictive.
  near(calculateXirr([{ date: '2023-09-30', amount: -100 }, { date: '2024-09-30', amount: 1 }, { date: '2025-09-30', amount: -1 }, { date: '2026-09-30', amount: 100 }]).value, 0)
})

test('新交易晚于行情或当日未收盘时只展示记账成本和已实现收益，无行情也可清仓核算', () => {
  const buy = entry('b', 'buy', '2026-10-01')
  const pending = portfolioSummary([buy], { date: '2026-09-30', close: 2 }, options)
  assert.equal(pending.cost, 100); assert.equal(pending.marketValue, null); assert.equal(pending.unrealized, null); assert.equal(pending.totalProfit, null); assert.equal(pending.xirr.value, null)
  assert.match(pending.valuationReason, /晚于行情/)
  assert.match(portfolioSummary([buy], { date: '2026-10-01', close: 2 }, options).valuationReason, /尚未收盘/)
  assert.match(portfolioSummary([buy], { date: '2026-10-02', close: 2 }, options).valuationReason, /晚于今天/)
  assert.equal(portfolioSummary([buy], null, options).marketValue, null)
  assert.equal(portfolioSummary([], null, options).totalReturn, null)
  const closed = portfolioSummary([entry('old', 'buy', '2025-09-30'), entry('s', 'sell', '2026-09-30', { price: 2 })], null, options)
  assert.equal(closed.totalProfit, 100); near(closed.xirr.value, 1)
})

test('编辑、删除、合并和撤销都先校验后提交；重开恢复，损坏存储不被覆盖，写失败可以导出', () => {
  const { ledger, storage, values } = store()
  const buy = ledger.upsert(entry(undefined, 'buy', '2025-09-30'))
  const sell = ledger.upsert(entry(undefined, 'sell', '2026-09-30', { quantity: 50 }))
  const original = ledger.exportBackup(), persisted = values.get(LEDGER_KEY)
  assert.throws(() => ledger.upsert({ ...buy, quantity: 40 }), /超过当时持仓/)
  assert.throws(() => ledger.remove(buy.id), /超过当时持仓/)
  assert.equal(ledger.exportBackup(), original); assert.equal(values.get(LEDGER_KEY), persisted)
  ledger.remove(sell.id); assert.equal(ledger.entries.value.length, 1)
  ledger.undoRemove(); assert.equal(ledger.entries.value.length, 2)
  assert.equal(createPortfolioLedger({ storage, now: () => now }).entries.value.length, 2)
  ledger.importBackup(original); assert.equal(ledger.entries.value.length, 2)
  const replacement = JSON.parse(original)
  replacement.entries[0].quantity = 200; replacement.entries[0].updatedAt = '2026-10-01T04:00:01.000Z'
  ledger.importBackup(JSON.stringify(replacement)); assert.equal(ledger.entries.value[0].quantity, 200)
  const beforeBadImport = ledger.exportBackup()
  assert.throws(() => ledger.importBackup('{bad'))
  assert.throws(() => ledger.importBackup(JSON.stringify(ledgerDocument([entry('conflict', 'buy', '2025-09-30')], options))), /顺序不能重复/)
  assert.throws(() => ledger.importBackup('a'.repeat(MAX_LEDGER_BACKUP_BYTES + 1)), /4 MB/)
  assert.equal(ledger.exportBackup(), beforeBadImport)
  const broken = store('{corrupt')
  broken.ledger.upsert(entry(undefined, 'buy', '2026-09-30'))
  assert.equal(broken.values.get(LEDGER_KEY), '{corrupt'); assert.match(broken.ledger.message.value, /不会被覆盖/)
  const failed = store(null, true)
  failed.ledger.upsert(entry(undefined, 'buy', '2026-09-30'))
  assert.match(failed.ledger.message.value, /保存失败/); assert.equal(JSON.parse(failed.ledger.exportBackup()).entries.length, 1)
})

test('真实交易标记定位到所在日／周／月／季 K 线；缺行情不平移，同侧聚合保留实际价格明细', () => {
  const history = ['2026-09-28', '2026-09-29', '2026-09-30'].map((date, i) => ({ date, open: 1, close: 1.1, low: 0.9, high: 1.2, volume: 100, amount: 110, turnover: 1, changePercent: i }))
  const entries = [entry('b1', 'buy', '2026-09-28', { price: 1.025 }), entry('b2', 'buy', '2026-09-29'), entry('s', 'sell', '2026-09-30'), entry('missing', 'buy', '2026-09-27'), entry('d', 'dividend', '2026-09-30', { sequence: 2 })]
  const daily = projectLedgerTrades(entries, history, aggregateKlines(history, 'day'))
  assert.equal(daily.length, 3); assert.equal(daily[0].point.price, 0.9); assert.match(daily[0].title, /1.025元/)
  for (const period of ['week', 'month', 'quarter']) {
    const projected = projectLedgerTrades(entries, history, aggregateKlines(history, period))
    assert.equal(projected.length, 2); assert.equal(projected[0].label, '买×2'); assert.equal(projected[0].entries.length, 2)
    assert.equal(projected[0].point.date, aggregateKlines(history, period)[0].date)
    assert.equal(projected[1].point.price, 1.2); assert.ok(!projected.some(group => group.entries.some(item => item.id === 'missing')))
  }
})
