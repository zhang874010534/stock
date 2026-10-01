import test from 'node:test'
import assert from 'node:assert/strict'
import { createObservationAlerts } from '../src/composables/useObservationAlerts.js'
import { ALERTS_KEY, MAX_ALERT_EVENTS, alertConditionLabel, evaluateAlertRule, observationAlertSamples, validateAlertRule, validateAlertsDocument } from '../src/utils/observationAlerts.js'
import { VALUATION_SOURCE } from '../src/api/valuations.js'

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
