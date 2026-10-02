import { inject, provide, reactive, ref } from 'vue'
import { getMarketData } from '../api/h30269.js'
import { getYield } from '../api/yields.js'
import { getValuation, getValuationHistory } from '../api/valuations.js'
import { getLatestMetrics } from '../api/latestMetrics.js'
import { getSourceStatus } from '../api/sourceStatus.js'
import { getCsiValuationHistory, getCsiValuationStatus } from '../api/csiValuations.js'
import { getEtfDistributions } from '../api/etfDistributions.js'
import { getConstituents } from '../api/constituents.js'
import { getConstituentHistory } from '../api/constituentHistory.js'
import { getYieldHistory } from '../api/yieldHistory.js'
import { getEtfNav } from '../api/etfNav.js'
import { getFundamentals } from '../api/fundamentals.js'
import { getEtfSize, getEtfFees } from '../api/etfLiquidity.js'

const dashboardKey = Symbol('dashboard-data')
const metricKeys = ['latestMetrics', 'valuation', 'dividend']

export function createDashboardData(overrides = {}) {
  const loaders = {
    H30269: () => getMarketData('H30269'),
    '512890': () => getMarketData('512890'),
    '000300': () => getMarketData('000300'),
    dividend: () => getYield('dividend'), treasury: () => getYield('treasury'),
    valuation: getValuation, latestMetrics: getLatestMetrics, collection: getSourceStatus,
    eastmoneyHistory: getValuationHistory, csiHistory: getCsiValuationHistory, csiStatus: getCsiValuationStatus,
    etfDistributions: getEtfDistributions,
    etfNav: getEtfNav,
    etfSize: getEtfSize, etfFees: getEtfFees,
    fundamentals: getFundamentals,
    constituents: getConstituents, constituentHistory: getConstituentHistory,
    yieldHistory: getYieldHistory,
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
    if (states.fundamentals.attempted && keys.some(key => ['fundamentals', 'constituents', 'constituentHistory'].includes(key))) {
      selected.add('fundamentals'); selected.add('constituents')
      if (states.constituentHistory.attempted) selected.add('constituentHistory')
    }
    if (states.etfNav.attempted && keys.some(key => ['512890', 'etfNav', 'H30269', 'etfDistributions'].includes(key))) {
      for (const key of ['512890', 'etfNav', 'H30269', 'etfDistributions']) selected.add(key)
    }
    if (keys.some(key => ['constituents', 'constituentHistory'].includes(key))) {
      for (const key of ['constituents', 'constituentHistory']) if (states[key].attempted) selected.add(key)
    }
    // A used comparison refreshes both inputs as one group. Its view commits
    // the pair only after both requests finish successfully.
    if (states['000300'].attempted && [...selected].some(key => ['H30269', '000300'].includes(key))) {
      selected.add('H30269')
      selected.add('000300')
    }
    // Raw cards and calculated metrics have different files, but refresh together
    // once used on this page. Each retains its own date and failure state.
    if (keys.some(key => metricKeys.includes(key))) {
      for (const key of metricKeys) if (states[key].attempted) selected.add(key)
    }
    if (states.yieldHistory.attempted && [...selected].some(key => ['dividend', 'treasury', 'yieldHistory'].includes(key))) {
      for (const key of ['dividend', 'treasury', 'yieldHistory']) selected.add(key)
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
