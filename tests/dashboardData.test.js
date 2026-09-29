import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, ref } from 'vue'
import { createDashboardData } from '../src/composables/useDashboardData.js'

test('concurrent reads share a request and remounts preserve errors until explicit retry', async () => {
  let resolve, calls = 0, fail = false
  const dashboard = createDashboardData({ treasury: () => {
    calls++
    if (fail) throw new Error('offline')
    return new Promise(done => { resolve = done })
  } })
  const first = dashboard.ensure('treasury')
  assert.equal(dashboard.ensure('treasury'), first)
  const refresh = dashboard.refresh(['treasury'])
  await Promise.resolve()
  assert.equal(calls, 1)
  resolve({ date: '2026-09-28', value: 2 })
  await Promise.all([first, refresh])
  fail = true
  await dashboard.refresh(['treasury'])
  assert.equal(dashboard.states.treasury.data.date, '2026-09-28')
  assert.equal(dashboard.states.treasury.error, 'offline')
  await dashboard.ensure('treasury')
  assert.equal(calls, 2)
  assert.equal(dashboard.states.treasury.error, 'offline')
  fail = false
  const retry = dashboard.refresh(['treasury'])
  await Promise.resolve()
  resolve({ date: '2026-09-29', value: 3 })
  await retry
  assert.equal(dashboard.states.treasury.error, '')
  assert.equal(dashboard.states.treasury.data.value, 3)
})

test('late market responses remain isolated by instrument and page instance', async () => {
  let resolveIndex
  const dashboard = createDashboardData({
    H30269: () => new Promise(resolve => { resolveIndex = resolve }),
    '512890': async () => ({ code: '512890' }),
  })
  const instrument = ref('H30269')
  const selected = computed(() => dashboard.states[instrument.value])
  const first = dashboard.ensure('H30269')
  instrument.value = '512890'
  await dashboard.ensure('512890')
  resolveIndex({ code: 'H30269' })
  await first
  assert.equal(selected.value.data.code, '512890')
  instrument.value = 'H30269'
  assert.equal(selected.value.data.code, 'H30269')
  assert.equal(createDashboardData().states.H30269.data, null)
})

test('related cards refresh together with independent failures and original dates', async () => {
  let version = 1
  const calls = {}
  const loaders = Object.fromEntries(['latestMetrics', 'valuation', 'dividend', 'csiHistory', 'csiStatus'].map(key => [key, async () => {
    calls[key] = (calls[key] ?? 0) + 1
    if (version === 2 && ['valuation', 'csiStatus'].includes(key)) throw new Error('offline')
    return { version, date: `2026-09-${27 + version}` }
  }]))
  const dashboard = createDashboardData(loaders)
  await Promise.all(Object.keys(loaders).map(dashboard.ensure))
  version = 2
  await dashboard.refresh(['latestMetrics', 'csiHistory', 'csiStatus'])
  assert.equal(dashboard.states.latestMetrics.data.version, 2)
  assert.equal(dashboard.states.dividend.data.version, 2)
  assert.equal(dashboard.states.valuation.data.version, 1)
  assert.equal(dashboard.states.valuation.data.date, '2026-09-28')
  assert.equal(dashboard.states.valuation.error, 'offline')
  assert.equal(dashboard.states.csiHistory.data.version, 2)
  assert.equal(dashboard.states.csiStatus.error, 'offline')
  assert.ok(Object.values(calls).every(count => count === 2))
  assert.equal(dashboard.states.treasury.attempted, false)
})
