import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, reactive, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

async function mountChart(initiallyHidden = false) {
  const file = new URL('../src/components/ValuationTrend.vue', import.meta.url)
  const { descriptor } = parse(await readFile(file, 'utf8'))
  const script = compileScript(descriptor, { id: 'visibility-test', inlineTemplate: true }).content
    .replace(/import \{ initValuationTrend \} from ['"][^'"]+['"]/, 'const initValuationTrend = element => { element.initCount++; return element.chart }')
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, path) => `from '${path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)}'`)
  const component = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const options = []
  let resizeCount = 0, disposeCount = 0, notifyResize, disconnected = false
  const chart = { setOption: option => options.push(option), resize: () => resizeCount++, dispose: () => disposeCount++ }
  const element = { clientWidth: initiallyHidden ? 0 : 600, clientHeight: initiallyHidden ? 0 : 220, chart, initCount: 0 }
  const originalObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(callback) { notifyResize = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const props = reactive({ stats: stats(8), metric: 'pe', expanded: true })
  const renderer = createRenderer({
    createElement: () => element, insert() {}, remove() {}, patchProp() {},
    parentNode() {}, nextSibling() {},
  })
  const app = renderer.createApp({ render: () => h(component, props) })
  try { app.mount({}) } finally { globalThis.ResizeObserver = originalObserver }
  return { props, element, options, notifyResize: () => notifyResize(),
    counts: () => ({ resizeCount, disposeCount, disconnected }), unmount: () => app.unmount() }
}

function stats(value) {
  return { count: 1, points: [{ date: '2026-09-28', value }], latest: { value }, low: value - 1, high: value + 1 }
}

test('隐藏期间更新后，恢复可见只应用最新曲线、分位线和显示设置', async () => {
  const view = await mountChart()
  try {
    assert.equal(view.options.length, 1)
    view.element.clientWidth = view.element.clientHeight = 0
    view.notifyResize()
    view.props.stats = stats(9)
    await nextTick()
    view.props.stats = stats(12)
    view.props.metric = 'pb'
    view.props.expanded = false
    await nextTick()
    assert.equal(view.options.length, 1)
    assert.equal(view.counts().resizeCount, 1)
    view.element.clientWidth = 600; view.element.clientHeight = 220
    view.notifyResize()
    assert.equal(view.options.length, 2)
    const option = view.options.at(-1)
    assert.deepEqual(option.series[0].data, [12])
    assert.equal(option.series[0].name, '市净率 PB')
    assert.deepEqual(option.series[0].markLine.data.map(line => line.yAxis), [13, 11])
    assert.deepEqual(option.dataZoom, [])
    assert.equal(view.element.initCount, 1)
    // A size-only notification must not reset zoom by reapplying all options.
    view.notifyResize()
    assert.equal(view.options.length, 2)
    assert.equal(view.counts().resizeCount, 3)
  } finally { view.unmount() }
  view.notifyResize()
  assert.deepEqual(view.counts(), { resizeCount: 3, disposeCount: 1, disconnected: true })
})

test('首次隐藏不初始化图表，显示时绘制最新数据；可见时更新仍立即绘制', async () => {
  const view = await mountChart(true)
  try {
    view.props.stats = stats(10)
    await nextTick()
    assert.equal(view.element.initCount, 0)
    view.element.clientWidth = 600; view.element.clientHeight = 220
    view.notifyResize()
    assert.equal(view.element.initCount, 1)
    assert.deepEqual(view.options.at(-1).series[0].data, [10])
    view.props.stats = stats(11)
    await nextTick()
    assert.deepEqual(view.options.at(-1).series[0].data, [11])
    view.element.clientWidth = view.element.clientHeight = 0
    view.notifyResize()
    view.element.clientWidth = 600; view.element.clientHeight = 220
    view.notifyResize()
    assert.equal(view.options.length, 2)
  } finally { view.unmount() }
})
