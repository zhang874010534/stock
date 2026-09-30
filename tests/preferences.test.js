import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createPreferences } from '../src/composables/usePreferences.js'
import { defaultPreferences, normalizePreferences, PREFERENCES_KEY } from '../src/utils/preferences.js'

function memoryStorage(initial = []) {
  const entries = new Map(initial)
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}

test('两只证券独立保存周期、图形、主副图选择及所有指标参数，重新创建后恢复', async () => {
  const storage = memoryStorage()
  const preferences = createPreferences({ storage })
  let reopened
  try {
    preferences.state.instrument = 'H30269'
    const index = preferences.state.charts.H30269, etf = preferences.state.charts['512890']
    Object.assign(index, { period: 'week', chartType: 'line', subIndicatorKey: 'macd', bollEnabled: true, bbiEnabled: false })
    Object.assign(index.maOptions[0], { period: 7, enabled: true, color: '#ABCDEF', width: 2.5 })
    Object.assign(index.indicatorSettings.boll, { period: 25, multiplier: 2.5 })
    Object.assign(index.indicatorSettings.bbi, { period1: 4, period2: 8, period3: 16, period4: 32, showBelowTwo: false })
    Object.assign(index.indicatorSettings.kdj, { rsvPeriod: 12, kSmoothing: 4, dSmoothing: 5 })
    Object.assign(index.indicatorSettings.macd, { fastPeriod: 8, slowPeriod: 18, signalPeriod: 6 })
    Object.assign(index.indicatorSettings.rsi, { shortPeriod: 5, mediumPeriod: 10, longPeriod: 20 })
    Object.assign(etf, { period: 'month', subIndicatorKey: 'wave' })
    Object.assign(etf.indicatorSettings.wave, { zigPercent: 15, sellPeriod: 8 })
    await nextTick()
    reopened = createPreferences({ storage })
    assert.deepEqual(reopened.state, preferences.state)
    assert.equal(reopened.message.value, '')
    assert.equal(reopened.state.charts['512890'].chartType, 'candlestick')
    assert.notEqual(reopened.state.charts.H30269.maOptions, reopened.state.charts['512890'].maOptions)
  } finally { preferences.stop(); reopened?.stop() }
})

test('未设置、损坏 JSON、未知版本和非对象输入回退默认，之后仍可保存', async () => {
  for (const raw of [null, '{bad', 'null', '[]', '{"schemaVersion":2,"instrument":"H30269"}']) {
    const storage = memoryStorage(raw === null ? [] : [[PREFERENCES_KEY, raw]])
    const preferences = createPreferences({ storage })
    try {
      assert.deepEqual(preferences.state, defaultPreferences())
      if (raw !== null) assert.match(preferences.message.value, /默认设置/)
      preferences.state.charts['512890'].period = 'quarter'
      await nextTick()
      assert.equal(JSON.parse(storage.getItem(PREFERENCES_KEY)).charts['512890'].period, 'quarter')
      assert.equal(preferences.message.value, '')
    } finally { preferences.stop() }
  }
})

test('按组校验保存值，拒绝越界、字符串、非法颜色、重复均线及不正确周期顺序', () => {
  const defaults = defaultPreferences()
  const mutations = [
    chart => { chart.period = 'year' },
    chart => { chart.chartType = 'unknown' },
    chart => { chart.subIndicatorKey = 'wave' }, // Only available on ETF.
    chart => { chart.subIndicatorKey = { toString: null } },
    chart => { chart.bollEnabled = 'true' },
    chart => { chart.maOptions[0].period = 0 },
    chart => { chart.maOptions[0].period = 5.5 },
    chart => { chart.maOptions[0].period = chart.maOptions[1].period },
    chart => { chart.maOptions[0].color = 'red' },
    chart => { chart.maOptions[0].width = 6 },
    chart => { chart.maOptions[0].enabled = 1 },
    chart => { chart.maOptions.pop() },
    chart => { chart.indicatorSettings.kdj.rsvPeriod = '9' },
    chart => { chart.indicatorSettings.kdj.kSmoothing = 51 },
    chart => { chart.indicatorSettings.macd.fastPeriod = chart.indicatorSettings.macd.slowPeriod },
    chart => { chart.indicatorSettings.rsi.mediumPeriod = chart.indicatorSettings.rsi.longPeriod },
    chart => { chart.indicatorSettings.boll.multiplier = Infinity },
    chart => { chart.indicatorSettings.bbi.showBelowTwo = 'false' },
    chart => { chart.indicatorSettings.wave.sellPeriod = 0 },
  ]
  for (const mutate of mutations) {
    const input = defaultPreferences()
    input.instrument = 'unknown'
    input.charts['512890'].period = 'week'
    mutate(input.charts.H30269)
    const result = normalizePreferences(input)
    assert.deepEqual(result.charts.H30269, defaults.charts.H30269)
    assert.equal(result.instrument, '512890')
    assert.equal(result.charts['512890'].period, 'week')
  }
  assert.deepEqual(normalizePreferences({ schemaVersion: 1, charts: { H30269: [] } }), defaults)
})

test('忽略未知字段、保留其他合法参数，返回值与输入不共享可修改对象', () => {
  const input = defaultPreferences()
  input.extra = 'ignored'
  input.charts.UNKNOWN = input.charts.H30269
  const chart = input.charts.H30269
  chart.extra = 'ignored'
  chart.period = 'month'
  chart.indicatorSettings.macd.fastPeriod = -1
  chart.indicatorSettings.kdj.rsvPeriod = 15
  chart.indicatorSettings.kdj.extra = 1
  chart.maOptions[0].extra = 1
  const result = normalizePreferences(input)
  assert.equal(result.extra, undefined)
  assert.equal(result.charts.UNKNOWN, undefined)
  assert.equal(result.charts.H30269.extra, undefined)
  assert.equal(result.charts.H30269.indicatorSettings.kdj.extra, undefined)
  assert.equal(result.charts.H30269.maOptions[0].extra, undefined)
  assert.equal(result.charts.H30269.period, 'month')
  assert.deepEqual(result.charts.H30269.indicatorSettings.macd, defaultPreferences().charts.H30269.indicatorSettings.macd)
  assert.equal(result.charts.H30269.indicatorSettings.kdj.rsvPeriod, 15)
  result.charts.H30269.indicatorSettings.kdj.rsvPeriod = 20
  result.charts.H30269.maOptions[0].period = 7
  assert.equal(chart.indicatorSettings.kdj.rsvPeriod, 15)
  assert.equal(chart.maOptions[0].period, 5)
})

test('恢复默认实时重置两只证券及选择，重新打开仍为默认；保留画线和其他存储', async () => {
  const drawingKey = 'stock:parallel-lines:v1:H30269:day'
  const storage = memoryStorage([[drawingKey, '[{"type":"horizontal"}]'], ['unrelated', 'keep']])
  const preferences = createPreferences({ storage })
  let reopened
  try {
    preferences.state.instrument = 'H30269'
    preferences.state.charts.H30269.period = 'week'
    preferences.state.charts['512890'].indicatorSettings.kdj.rsvPeriod = 18
    await nextTick()
    await preferences.reset()
    assert.deepEqual(preferences.state, defaultPreferences())
    assert.match(preferences.message.value, /已恢复默认/)
    reopened = createPreferences({ storage })
    assert.deepEqual(reopened.state, defaultPreferences())
    assert.equal(storage.entries.get(drawingKey), '[{"type":"horizontal"}]')
    assert.equal(storage.entries.get('unrelated'), 'keep')
  } finally { preferences.stop(); reopened?.stop() }
})

test('存储读取和写入失败不阻止内存中的切换或重置，并显示保存失败原因', async () => {
  let fail = true
  const backing = memoryStorage()
  const storage = {
    getItem() { if (fail) throw new Error('denied'); return backing.getItem(PREFERENCES_KEY) },
    setItem(key, value) { if (fail) throw new Error('quota'); backing.setItem(key, value) },
  }
  const preferences = createPreferences({ storage })
  try {
    assert.match(preferences.message.value, /无法读取/)
    preferences.state.instrument = 'H30269'
    preferences.state.charts.H30269.period = 'week'
    await nextTick()
    assert.equal(preferences.state.instrument, 'H30269')
    assert.equal(preferences.state.charts.H30269.period, 'week')
    assert.match(preferences.message.value, /保存失败/)
    await preferences.reset()
    assert.deepEqual(preferences.state, defaultPreferences())
    assert.match(preferences.message.value, /保存失败/)
    fail = false
    preferences.state.charts['512890'].chartType = 'line'
    await nextTick()
    assert.equal(preferences.message.value, '')
    assert.equal(JSON.parse(backing.getItem(PREFERENCES_KEY)).charts['512890'].chartType, 'line')
  } finally { preferences.stop() }
})

test('停止监听后不再保存', async () => {
  const storage = memoryStorage()
  const preferences = createPreferences({ storage })
  preferences.stop()
  preferences.state.instrument = 'H30269'
  await nextTick()
  assert.equal(storage.getItem(PREFERENCES_KEY), null)
})
