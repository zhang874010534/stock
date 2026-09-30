import { inject, provide, reactive, ref } from 'vue'
import { getMarketData } from '../api/h30269.js'
import { getYield } from '../api/yields.js'
import { getValuation, getValuationHistory } from '../api/valuations.js'
import { getLatestMetrics } from '../api/latestMetrics.js'
import { getSourceStatus } from '../api/sourceStatus.js'
import { getCsiValuationHistory, getCsiValuationStatus } from '../api/csiValuations.js'
import { getEtfDistributions } from '../api/etfDistributions.js'

const dashboardKey = Symbol('dashboard-data')
const metricKeys = ['latestMetrics', 'valuation', 'dividend']

export function createDashboardData(overrides = {}) {
  const loaders = {
    H30269: () => getMarketData('H30269'),
    '512890': () => getMarketData('512890'),
    dividend: () => getYield('dividend'), treasury: () => getYield('treasury'),
    valuation: getValuation, latestMetrics: getLatestMetrics, collection: getSourceStatus,
    eastmoneyHistory: getValuationHistory, csiHistory: getCsiValuationHistory, csiStatus: getCsiValuationStatus,
    etfDistributions: getEtfDistributions,
    ...overrides,
  }
  const states = reactive(Object.fromEntries(Object.keys(loaders).map(key => [key, {
    data: null, loading: false, error: '', attempted: false,
  }])))
  const checkedAt = ref(new Date())
  const pending = new Map()

  function load(key, force = false) {
    if (!(key in loaders)) throw new Error(`未知数据来源：${key}`)
    if (pending.has(key)) return pending.get(key)
    const state = states[key]
    if (!force && state.attempted) return Promise.resolve()
    state.loading = true
    state.error = ''
    state.attempted = true
    if (key === 'collection') checkedAt.value = new Date()
    const request = Promise.resolve().then(() => loaders[key]()).then(data => {
      state.data = data
    }).catch(error => {
      state.error = error?.message || '数据读取失败'
    }).finally(() => {
      state.loading = false
      pending.delete(key)
    })
    pending.set(key, request)
    return request
  }

  function refresh(keys) {
    const selected = new Set(keys)
    // Raw cards and calculated metrics have different files, but refresh together
    // once used on this page. Each retains its own date and failure state.
    if (keys.some(key => metricKeys.includes(key))) {
      for (const key of metricKeys) if (states[key].attempted) selected.add(key)
    }
    return Promise.all([...selected].map(key => load(key, true)))
  }
  return { states, checkedAt, ensure: key => load(key), refresh }
}

export function provideDashboardData(data = createDashboardData()) {
  provide(dashboardKey, data)
  return data
}

export function useDashboardData() {
  // Standalone components receive an isolated store, never a module singleton.
  return inject(dashboardKey, null) ?? createDashboardData()
}
