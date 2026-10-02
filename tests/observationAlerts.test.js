import test from 'node:test'
import assert from 'node:assert/strict'
import { createObservationAlerts } from '../src/composables/useObservationAlerts.js'
import { ALERTS_KEY, MAX_ALERT_EVENTS, alertConditionLabel, alertTriggerExplanation, evaluateAlertRule, observationAlertSamples, validateAlertRule, validateAlertsDocument } from '../src/utils/observationAlerts.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'
import { emptyYieldHistory, YIELD_SERIES } from '../src/utils/yieldSpread.js'
import { tradingCalendar } from '../src/data/tradingCalendar.js'
import { tradingSessions, annualizedVolatility } from '../src/utils/priceRisk.js'

const now = () => new Date('2026-10-01T08:00:00.000Z')
function storage(initial) {
  const entries = new Map(initial ? [[ALERTS_KEY, initial]] : [])
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}
function store(target = storage()) {
  let serial = 0
  return createObservationAlerts({ storage: target, now, id: () => `alert-${++serial}` })
}
const add = (alerts, overrides = {}) => alerts.upsert({ instrument: '512890', metric: 'price', operator: 'lte', threshold: 1.2, ...overrides })
function inputs(code = '512890') {
  const closes = code === '512890' ? [1, .9] : [100, 90]
  const history = closes.map((close, i) => ({ date: ['2026-09-29', '2026-09-30'][i], open: close, close, high: close, low: close, volume: 10 }))
  return {
    market: { data: { code, source: 'eastmoney', interval: '1d', updatedAt: '2026-09-30T10:00:00Z', backfill: { completed: false }, history, latest: history.at(-1) } },
    valuation: { data: { code: 'H30269', provider: 'Eastmoney', source: VALUATION_SOURCE, basis: 'provider_unspecified', unit: 'multiple', date: '2026-09-30', pe: 8, pb: .8 } },
    collection: { data: { sources: { [code]: { status: 'ok' }, valuation: { status: 'ok' } } } }, now: now(),
  }
}
const result = (rule, status = 'matched', date = '2026-09-30', value = .9) => ({ ruleId: rule.id, status, value, date })

test('四项指标使用各自证券与数据日期，ETF估值明确采用H30269，回撤以正数跌幅检查', () => {
  const samples = observationAlertSamples('512890', inputs())
  assert.equal(samples.price.value, .9); assert.ok(Math.abs(samples.drawdown.value - 10) < 1e-12)
  assert.equal(samples.pe.value, 8); assert.equal(samples.pb.value, .8)
  const index = observationAlertSamples('H30269', inputs('H30269'))
  assert.equal(index.price.value, 90); assert.equal(index.drawdown.value, 10)
  const alerts = store()
  const draw = add(alerts, { instrument: 'H30269', metric: 'drawdown', operator: 'gte', threshold: 10 })
  assert.equal(evaluateAlertRule(draw, index).status, 'matched')
  const valuation = inputs(); valuation.valuation.data.date = '2026-09-29'
  assert.equal(observationAlertSamples('512890', valuation).pe.date, '2026-09-29')
  assert.match(alertConditionLabel(add(alerts, { metric: 'pe', threshold: 8.12345 })), /标的指数 PE ≤ 8.12345 倍/)
})

test('阈值比较包含等号，不按显示舍入触发；暂停和日期倒退不改变检查状态', () => {
  const alerts = store(), rule = add(alerts)
  const sample = value => ({ price: { value, date: '2026-09-30', reason: '' } })
  assert.equal(evaluateAlertRule(rule, sample(1.2)).status, 'matched')
  assert.equal(evaluateAlertRule(rule, sample(1.20001)).status, 'unmatched')
  alerts.toggle(rule.id); assert.equal(evaluateAlertRule(rule, sample(1)).status, 'paused')
  alerts.toggle(rule.id); alerts.record([result(rule)])
  assert.equal(evaluateAlertRule(alerts.state.rules[0], { price: { value: 1, date: '2026-09-29', reason: '' } }).status, 'pending')
})

test('来源独立失败、时效过旧、日期与身份异常、缺少历史和日历越界均待核验', () => {
  for (const mutate of [d => { d.market.error = 'offline' }, d => { d.market.loading = true }, d => { d.collection.loading = true },
    d => { d.collection.error = 'offline' }, d => { delete d.collection.data.sources['512890'] }, d => { d.collection.data.sources['512890'].status = 'error' },
    d => { d.market.data.latest.date = '2026-10-02' }, d => { d.market.data.source = 'other' }, d => { d.market.data.code = 'H30269' },
    d => { d.market.data.latest.close = NaN }, d => { d.now = new Date('2027-01-01T08:00:00Z') }]) {
    const data = structuredClone(inputs()); mutate(data)
    assert.ok(observationAlertSamples('512890', data).price.reason)
  }
  const old = inputs(); old.market.data.history.forEach((row, i) => { row.date = ['2026-09-23', '2026-09-24'][i] })
  assert.match(observationAlertSamples('512890', old).price.reason, /数据较旧/)
  const holiday = inputs(); holiday.market.data.latest.date = '2026-10-01'
  assert.match(observationAlertSamples('512890', holiday).price.reason, /不是交易日/)
  const intraday = inputs(); intraday.now = new Date('2026-09-30T06:00:00Z')
  assert.match(observationAlertSamples('512890', intraday).price.reason, /尚未收盘/)
  const single = inputs(); single.market.data.history.shift()
  assert.ok(!observationAlertSamples('512890', single).price.reason)
  assert.match(observationAlertSamples('512890', single).drawdown.reason, /两个/)
  const failed = inputs(); failed.valuation.error = 'offline'
  assert.equal(observationAlertSamples('512890', failed).price.value, .9)
  assert.ok(observationAlertSamples('512890', failed).pe.reason)
  failed.valuation.error = ''; failed.valuation.data.code = '512890'
  assert.ok(observationAlertSamples('512890', failed).pb.reason)
})

test('持续满足和重新打开不重复触发，未知状态不解除，恢复后再次满足才新增', () => {
  const target = storage(), alerts = store(target), rule = add(alerts)
  alerts.record([result(rule)]); alerts.record([result(rule)])
  assert.equal(alerts.state.events.length, 1)
  alerts.record([result(rule, 'pending', null, null)])
  assert.equal(alerts.state.rules[0].lastMatched, true)
  const reopened = createObservationAlerts({ storage: target, now, id: () => 'second-event' })
  reopened.record([result(rule, 'matched', '2026-10-01')]); assert.equal(reopened.state.events.length, 1)
  reopened.record([result(rule, 'unmatched', '2026-10-01', 1.3)])
  reopened.record([result(rule, 'matched', '2026-10-01')]); assert.equal(reopened.state.events.length, 2)
  assert.equal(reopened.state.events[0].dataDate, '2026-10-01')
  reopened.record([result(rule, 'unmatched', '2026-09-29', 1.3)])
  assert.equal(reopened.state.rules[0].lastMatched, true)
})

test('两只证券独立，编辑保留历史条件，暂停不触发，删除可撤销并保留去重状态', () => {
  const alerts = store(), etf = add(alerts), index = add(alerts, { instrument: 'H30269', threshold: 100 })
  alerts.record([result(etf)]); assert.equal(alerts.state.events.length, 1)
  assert.equal(alerts.state.rules.find(rule => rule.id === index.id).lastMatched, null)
  alerts.toggle(etf.id); alerts.record([result(etf, 'unmatched', '2026-10-01', 1.3)])
  alerts.toggle(etf.id); alerts.record([result(etf)])
  assert.equal(alerts.state.events.length, 1)
  const edited = add(alerts, { id: etf.id, threshold: 1.1 })
  assert.equal(edited.lastMatched, null); alerts.record([result(edited)])
  assert.deepEqual(alerts.state.events.map(event => event.threshold), [1.1, 1.2])
  alerts.remove(etf.id); alerts.undoRemove(); alerts.record([result(edited)])
  assert.equal(alerts.state.events.length, 2)
  alerts.markRead('H30269'); assert.equal(alerts.state.events[0].read, false)
  alerts.markRead('512890'); assert.ok(alerts.state.events.every(event => event.read))
})

test('拒绝无效和重复条件，损坏或不支持的存储不被覆盖；写入失败仍可使用页面', () => {
  const alerts = store(), rule = add(alerts)
  for (const overrides of [{ threshold: NaN }, { threshold: 0 }, { threshold: '1' }, { metric: 'other' }, { operator: 'other' }, { instrument: '000300' }, { metric: 'drawdown', threshold: -1 }, { metric: 'drawdown', threshold: 101 }]) assert.throws(() => add(alerts, overrides))
  assert.throws(() => add(alerts), /已有/)
  assert.throws(() => validateAlertRule({ ...rule, lastDataDate: '2026-02-30', lastMatched: true }))
  for (const raw of ['{bad', '{"schemaVersion":2}', 'null']) {
    const target = storage(raw), broken = store(target)
    add(broken); assert.equal(target.getItem(ALERTS_KEY), raw); assert.match(broken.message.value, /保留原记录/)
  }
  const failing = store({ getItem() { return null }, setItem() { throw new Error('quota') } })
  const saved = add(failing); failing.record([result(saved)])
  assert.equal(failing.state.events.length, 1); assert.match(failing.message.value, /保存失败/)
  const invalid = JSON.parse(JSON.stringify(alerts.state)); invalid.events = [{ id: 'event', ruleId: rule.id, instrument: '512890', metric: 'price', operator: 'lte', threshold: 1, value: 2, read: false, dataDate: '2026-09-30', checkedAt: now().toISOString() }]
  assert.throws(() => validateAlertsDocument(invalid), /未满足/)
})

test('触发历史最多保留最近100条，同日数据修订解除再满足可以形成新记录', () => {
  const alerts = store(), rule = add(alerts)
  for (let i = 0; i <= MAX_ALERT_EVENTS; i++) {
    alerts.record([result(rule, 'unmatched', '2026-09-30', 1.3)])
    alerts.record([result(rule)])
  }
  assert.equal(alerts.state.events.length, MAX_ALERT_EVENTS)
  assert.equal(validateAlertsDocument(alerts.state).events.length, MAX_ALERT_EVENTS)
})

function yieldInputs() {
  const data = inputs()
  for (const [kind, value, source] of [['dividend', 4.5, 'dividend'], ['treasury', 2, 'bond']]) {
    data[kind] = { data: { ...YIELD_SERIES[kind], unit: 'percent', date: '2026-09-30', value } }
    data.collection.data.sources[source] = { status: 'ok' }
  }
  data.yieldHistory = { data: emptyYieldHistory() }
  data.collection.data.sources.yieldHistory = { status: 'ok' }
  for (const [kind, value] of [['dividend', 4.5], ['treasury', 2]]) data.yieldHistory.data.series[kind].history = ['2026-09-28', '2026-09-29', '2026-09-30'].map(date => ({ date, value }))
  return data
}
const condition = (metric, threshold, operator = 'gte') => ({ metric, operator, threshold })

test('复合条件使用 AND 和同日数据；利差用百分点，允许负阈值和零股息／零波动率', () => {
  const alerts = store(), rule = add(alerts, { conditions: [condition('dividend', 4), condition('spread', 2), condition('price', 1, 'lte')] })
  const data = yieldInputs(), samples = observationAlertSamples('512890', data)
  assert.equal(samples.dividend.value, 4.5); assert.equal(samples.spread.value, 2.5)
  assert.equal(evaluateAlertRule(rule, samples).status, 'matched')
  samples.spread.value = 1.9; assert.equal(evaluateAlertRule(rule, samples).status, 'unmatched')
  samples.spread.value = 2.5; samples.dividend.date = '2026-09-29'
  assert.match(evaluateAlertRule(rule, samples).reason, /日期不一致/)
  assert.match(alertConditionLabel(rule), /且.*个百分点/)
  assert.doesNotThrow(() => add(alerts, { conditions: [condition('spread', -2), condition('dividend', 0), condition('volatility', 0)] }))
  for (const metric of ['dividend', 'spread', 'volatility']) assert.throws(() => add(alerts, { conditions: [condition(metric, NaN)] }))
})

test('收益率来源和历史独立核验，日期错位不取旧的同日利差，读取失败不影响价格', () => {
  const data = yieldInputs()
  data.treasury.data.date = '2026-09-29'
  assert.match(observationAlertSamples('512890', data).spread.reason, /日期不一致/)
  data.treasury.data.date = '2026-09-30'; data.treasury.data.source = 'other'
  assert.match(observationAlertSamples('512890', data).spread.reason, /来源/)
  data.treasury.data.source = YIELD_SERIES.treasury.source; data.collection.data.sources.bond.status = 'error'
  assert.match(observationAlertSamples('512890', data).spread.reason, /后台采集/)
  data.yieldHistory.error = 'offline'
  const samples = observationAlertSamples('512890', data)
  assert.equal(samples.price.value, .9); assert.equal(samples.dividend.value, 4.5)
  const alerts = store(), rule = add(alerts, { metric: 'dividend', threshold: 4, operator: 'gte', consecutiveDays: 2 })
  assert.match(evaluateAlertRule(rule, samples).reason, /历史读取失败/)
  data.yieldHistory.error = ''; data.collection.data.sources.yieldHistory.status = 'error'
  assert.match(evaluateAlertRule(rule, observationAlertSamples('512890', data)).reason, /历史后台生成失败/)
})

test('连续交易日从真实历史检查，周末与休市不计，刷新不累计；缺日待核验且不解除旧状态', () => {
  const alerts = store(), rule = add(alerts, { consecutiveDays: 3 })
  const prices = ['2026-09-24', '2026-09-28', '2026-09-29', '2026-09-30'].map(date => ({ date, value: 1 }))
  const samples = { price: { value: 1, date: '2026-09-30', history: prices } }
  let checked = evaluateAlertRule(rule, samples)
  assert.equal(checked.status, 'matched'); assert.equal(checked.streakStart, '2026-09-28')
  alerts.record([checked]); alerts.record([evaluateAlertRule(alerts.state.rules[0], samples)])
  assert.equal(alerts.state.events.length, 1)
  prices.splice(2, 1); checked = evaluateAlertRule(alerts.state.rules[0], samples)
  assert.equal(checked.status, 'pending'); assert.match(checked.reason, /2026-09-29 缺少/)
  alerts.record([checked]); assert.equal(alerts.state.rules[0].lastMatched, true)
  prices.splice(2, 0, { date: '2026-09-29', value: 1.3 })
  checked = evaluateAlertRule(alerts.state.rules[0], samples)
  assert.equal(checked.status, 'unmatched'); assert.match(checked.reason, /连续 1\/3/)
  const fourDays = add(alerts, { consecutiveDays: 4 })
  prices[2].value = 1
  assert.equal(evaluateAlertRule(fourDays, samples).streakStart, '2026-09-24')
})

test('连续条件逐日同时满足；缺少某指标历史不借用当前值', () => {
  const alerts = store(), rule = add(alerts, { conditions: [condition('dividend', 4), condition('spread', 2)], consecutiveDays: 3 })
  const data = yieldInputs()
  assert.equal(evaluateAlertRule(rule, observationAlertSamples('512890', data)).status, 'matched')
  data.yieldHistory.data.series.treasury.history.splice(1, 1)
  assert.equal(evaluateAlertRule(rule, observationAlertSamples('512890', data)).status, 'pending')
  data.yieldHistory.data.series.treasury.history.splice(1, 0, { date: '2026-09-29', value: 3 })
  assert.equal(evaluateAlertRule(rule, observationAlertSamples('512890', data)).status, 'unmatched')
  const pe = add(alerts, { metric: 'pe', threshold: 9, consecutiveDays: 2 })
  assert.match(evaluateAlertRule(pe, observationAlertSamples('512890', inputs())).reason, /缺少同日历史/)
  const withHistory = inputs()
  withHistory.valuationHistory = { data: { ...withHistory.valuation.data, schemaVersion: 1, history: [{ date: '2026-09-29', pe: 8.1, pb: .81 }, { date: '2026-09-30', pe: 8, pb: .8 }] } }
  assert.equal(evaluateAlertRule(pe, observationAlertSamples('512890', withHistory)).status, 'matched')
  withHistory.valuationHistory.data.history[1].pe = 8.2
  assert.match(evaluateAlertRule(pe, observationAlertSamples('512890', withHistory)).reason, /不一致/)
})

test('60 日年化波动率复用简单收益率与样本标准差；窗口缺日不缩短，平价波动为零', () => {
  const data = inputs(), dates = tradingSessions('2026-05-01', '2026-09-30', tradingCalendar).slice(-61)
  const history = dates.map((date, i) => { const close = 1 + i % 4 * .01; return { date, open: close, close, high: close, low: close } })
  data.market.data.history = history; data.market.data.latest = history.at(-1)
  const expected = annualizedVolatility(history.slice(1).map((row, i) => row.close / history[i].close - 1)) * 100
  assert.ok(Math.abs(observationAlertSamples('512890', data).volatility.value - expected) < 1e-12)
  history.splice(30, 1)
  assert.match(observationAlertSamples('512890', data).volatility.reason, /样本不足或行情缺日/)
  assert.equal(observationAlertSamples('512890', data).price.value, history.at(-1).close)
  data.market.data.history = dates.map(date => ({ date, open: 1, close: 1, high: 1, low: 1 })); data.market.data.latest = data.market.data.history.at(-1)
  assert.equal(observationAlertSamples('512890', data).volatility.value, 0)
})

test('冷却期按数据日期的交易日计数，休市不消耗；再次满足等待到期，持续满足不重复', () => {
  const target = storage(), alerts = store(target), rule = add(alerts, { cooldownDays: 2 })
  const check = (date, value) => evaluateAlertRule(alerts.state.rules[0], { price: { date, value } })
  alerts.record([check('2026-09-30', 1)])
  alerts.record([check('2026-10-08', 1.3)])
  const cooling = check('2026-10-08', 1)
  assert.equal(cooling.cooldownRemaining, 1)
  alerts.record([cooling]); assert.equal(alerts.state.events.length, 1)
  const reopened = store(target), ready = evaluateAlertRule(reopened.state.rules[0], { price: { date: '2026-10-09', value: 1 } })
  assert.equal(ready.cooldownRemaining, 0)
  reopened.record([ready]); assert.equal(reopened.state.events.length, 2)
  reopened.record([ready]); assert.equal(reopened.state.events.length, 2)
  reopened.record([evaluateAlertRule(reopened.state.rules[0], { price: { date: '2026-10-12', value: 1 } })])
  assert.equal(reopened.state.events.length, 2)
  assert.equal(reopened.state.rules[0].lastTriggeredDate, '2026-10-09')
  assert.equal(rule.cooldownDays, 2)
})

test('未打开页面期间的历史解除可以开始新一轮；无法核验的缺日不解除去重状态', () => {
  const alerts = store(), rule = add(alerts)
  alerts.record([evaluateAlertRule(rule, { price: { date: '2026-09-28', value: 1 } })])
  const sample = history => ({ price: { date: '2026-09-30', value: 1, history } })
  const withoutBreak = evaluateAlertRule(alerts.state.rules[0], sample([]))
  assert.equal(withoutBreak.episodeReset, false)
  const withBreak = evaluateAlertRule(alerts.state.rules[0], sample([{ date: '2026-09-29', value: 1.3 }]))
  assert.equal(withBreak.episodeReset, true)
  alerts.record([withBreak]); assert.equal(alerts.state.events.length, 2)
})

test('复合记录保存全部阈值、原始值和连续区间，编辑不改历史；排序不同的重复规则仍拒绝', () => {
  const alerts = store(), conditions = [condition('dividend', 4), condition('spread', 2)]
  const rule = add(alerts, { conditions, consecutiveDays: 3, cooldownDays: 5 })
  alerts.record([evaluateAlertRule(rule, observationAlertSamples('512890', yieldInputs()))])
  const event = alerts.state.events[0]
  assert.equal(event.values.length, 2); assert.equal(event.streakStart, '2026-09-28')
  assert.match(alertTriggerExplanation(event), /4.5 % ≥ 4 %.*2.5 个百分点 ≥ 2 个百分点.*连续 3 个交易日.*冷却期 5/)
  assert.throws(() => add(alerts, { conditions: conditions.toReversed(), consecutiveDays: 3, cooldownDays: 5 }), /已有/)
  add(alerts, { id: rule.id, conditions: [condition('dividend', 4.1)], consecutiveDays: 2 })
  assert.equal(alerts.state.events[0].conditions[0].threshold, 4)
  assert.equal(alerts.state.rules[0].lastTriggeredDate, null)
  for (const overrides of [{ conditions: [] }, { conditions: [conditions[0], conditions[0]] }, { consecutiveDays: 0 }, { consecutiveDays: 1.5 }, { consecutiveDays: 31 }, { cooldownDays: -1 }, { cooldownDays: 251 }]) assert.throws(() => add(alerts, overrides))
  const broken = JSON.parse(JSON.stringify(alerts.state)); broken.events[0].values[1].date = '2026-09-29'
  assert.throws(() => validateAlertsDocument(broken), /日期异常/)
})

test('旧版单条件和触发记录自动迁移并保留暂停、已读和去重状态，损坏记录不覆盖', () => {
  const legacy = { schemaVersion: 1, kind: 'stock-observation-alerts', rules: [{ id: 'old-rule', instrument: '512890', metric: 'price', operator: 'lte', threshold: 1.2, enabled: false, createdAt: now().toISOString(), updatedAt: now().toISOString(), lastMatched: true, lastDataDate: '2026-09-30' }],
    events: [{ id: 'old-event', ruleId: 'old-rule', instrument: '512890', metric: 'price', operator: 'lte', threshold: 1.2, value: 1, dataDate: '2026-09-30', checkedAt: now().toISOString(), read: true }] }
  const target = storage(JSON.stringify(legacy)), alerts = store(target)
  assert.equal(alerts.state.schemaVersion, 2); assert.equal(alerts.state.rules[0].conditions.length, 1)
  assert.equal(alerts.state.rules[0].lastTriggeredDate, '2026-09-30'); assert.equal(alerts.state.events[0].read, true)
  alerts.toggle('old-rule'); alerts.record([evaluateAlertRule(alerts.state.rules[0], { price: { date: '2026-09-30', value: 1 } })])
  assert.equal(alerts.state.events.length, 1); assert.equal(JSON.parse(target.getItem(ALERTS_KEY)).schemaVersion, 2)
  const corrupt = JSON.stringify({ ...legacy, events: [{ ...legacy.events[0], value: 2 }] }), badStorage = storage(corrupt)
  const bad = store(badStorage); add(bad); assert.equal(badStorage.getItem(ALERTS_KEY), corrupt)
})
