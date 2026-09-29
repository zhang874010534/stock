import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, ref, nextTick } from 'vue'

test('行情刷新保留自选窗口及预设范围，切换周期才重置', async () => {
  const file = new URL('../src/components/kline/useKlineChart.js', import.meta.url)
  // Run the real Vue watchers and lifecycle with a chart adapter; actual ECharts
  // options/rendering are covered separately by klineViewport.test.js.
  const source = (await readFile(file, 'utf8'))
    .replace("import('../../charts/indexTrend.js')", `Promise.resolve({
      initIndexTrend: element => element.chart,
      createIndexTrendOption: (history, window) => ({ window: { ...window } }),
    })`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const { useKlineChart } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const previousObserver = globalThis.ResizeObserver
  const previousCancel = globalThis.cancelAnimationFrame
  const history = ref(Array.from({ length: 200 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), close: 10 })))
  const period = ref('day')
  let api, option, app, disposed = false
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.cancelAnimationFrame = () => {}
  const chart = {
    on() {}, getZr: () => ({ on() {} }), resize() {}, clear() {}, dispatchAction() {},
    setOption(value) { option = value }, dispose() { disposed = true },
  }
  const renderer = createRenderer({
    createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {},
  })
  try {
    app = renderer.createApp({ setup() {
      api = useKlineChart({ element: ref({ clientWidth: 1000, clientHeight: 500, chart }), history, period,
        movingAverages: ref([]), mainIndicators: ref([]), subIndicator: ref({ key: 'kdj' }),
        chartType: ref('candlestick'), compact: ref(false), pricePrecision: ref(2),
      })
      return () => null
    } })
    app.mount({})
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(api.range.value, 'recent')
    api.zoomToWindow(20, 60)
    const startDate = history.value[20].date, endDate = history.value[60].date
    history.value = [{ date: '2024-12-31', close: 10 }, ...history.value.map(row => ({ ...row })), { date: '2025-07-20', close: 11 }]
    await nextTick()
    assert.equal(api.range.value, 'custom')
    assert.deepEqual(option.window, { startIndex: 21, endIndex: 61 })
    assert.equal(history.value[option.window.startIndex].date, startDate)
    assert.equal(history.value[option.window.endIndex].date, endDate)
    // Retrying chart rendering must also preserve the custom window.
    await api.load()
    assert.deepEqual(option.window, { startIndex: 21, endIndex: 61 })
    api.selectRange('all')
    history.value = [...history.value, { date: '2025-07-21', close: 11 }]
    await nextTick()
    assert.equal(api.range.value, 'all')
    assert.deepEqual(option.window, { startIndex: 0, endIndex: history.value.length - 1 })
    api.zoomToWindow(10, 30)
    period.value = 'week'
    await nextTick()
    assert.equal(api.range.value, 'recent')
    assert.equal(option.window.endIndex, history.value.length - 1)
  } finally {
    app?.unmount()
    globalThis.ResizeObserver = previousObserver
    globalThis.cancelAnimationFrame = previousCancel
  }
  assert.equal(disposed, true)
})
